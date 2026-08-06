import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { cron, NonRetriableError } from "inngest";

import {
  companyNewsItems,
  companies,
  leadSignals,
  monitoringTargets,
  newsItems,
  signalScans,
  users,
  type Database,
  getDatabase,
} from "@/lib/db";
import { getAIProvider } from "@/lib/ai/server";
import { getFirecrawlClient, type FirecrawlScrapeResult } from "@/lib/firecrawl";
import { isAiActionsEnabled, isNewsScanEnabled } from "@/lib/runtime-controls";
import {
  OrganizationUsageLimitError,
  reserveOrganizationUsage,
  usageDateKey,
} from "@/lib/db/usage";
import {
  buildSignalQueries,
  canonicalizeNewsUrl,
  extractSignals,
  getGdeltClient,
  rankNewsCandidates,
  RssClient,
  toLeadSignalInsert,
  type NewsCandidate,
  type NewsArticle,
} from "@/lib/news";

import { inngest, newsScanRequested } from "@/inngest/client";

const DEFAULT_CRON = "TZ=UTC 0 7 * * 1";
const DEFAULT_LOOKBACK_DAYS = 8;
const DEFAULT_MAX_COMPANIES = 25;
const DEFAULT_MAX_ARTICLES_PER_COMPANY = 3;
const MAX_MARKDOWN_FOR_SIGNAL = 1_500;

type ScanTarget = Readonly<{
  targetId: string;
  organizationId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  rssFeedUrl: string | null;
  industry: string | null;
  priority: number;
  scanFrequencyDays: number;
  icpScore: number | null;
  lastScannedAt: Date | null;
}>;

type ScanCounts = Readonly<{
  candidatesFound: number;
  articlesFetched: number;
  signalsExtracted: number;
}>;

type ScanResult = ScanCounts & Readonly<{ warnings: string[] }>;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function scanEnabled(): boolean {
  // News discovery can consume provider/network budgets. Require an explicit
  // opt-in so an omitted environment variable never starts autonomous scans.
  return isNewsScanEnabled();
}

function maxCompanies(): number {
  return positiveInteger(process.env.NEWS_SCAN_MAX_COMPANIES, DEFAULT_MAX_COMPANIES, 100);
}

function maxArticlesPerCompany(): number {
  return positiveInteger(
    process.env.NEWS_SCAN_MAX_ARTICLES_PER_COMPANY,
    DEFAULT_MAX_ARTICLES_PER_COMPANY,
    10,
  );
}

function safeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 1_000);
  return "Unknown scan error";
}

function contentHash(article: NewsArticle): string {
  return createHash("sha256")
    .update(`${article.canonicalUrl}\n${article.title}\n${article.excerpt ?? ""}`)
    .digest("hex");
}

async function withSystemTenantContext<T>(
  organizationId: string,
  operation: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${actorUserId ?? ""}, true)`);
    await tx.execute(sql`select set_config('app.current_organization_id', ${organizationId}, true)`);
    return operation(tx);
  });
}

async function loadDueTargets(
  organizationId?: string,
): Promise<ScanTarget[]> {
  const db = getDatabase();
  const now = new Date();
  const rows = await db
    .select({
      targetId: monitoringTargets.id,
      organizationId: monitoringTargets.organizationId,
      companyId: monitoringTargets.companyId,
      companyName: companies.name,
      companyDomain: companies.domain,
      rssFeedUrl: monitoringTargets.rssFeedUrl,
      industry: companies.industry,
      priority: monitoringTargets.priority,
      scanFrequencyDays: monitoringTargets.scanFrequencyDays,
      icpScore: companies.icpScore,
      lastScannedAt: monitoringTargets.lastScannedAt,
    })
    .from(monitoringTargets)
    .innerJoin(
      companies,
      and(
        eq(companies.id, monitoringTargets.companyId),
        eq(companies.organizationId, monitoringTargets.organizationId),
      ),
    )
    .where(
      and(
        eq(monitoringTargets.enabled, true),
        organizationId ? eq(monitoringTargets.organizationId, organizationId) : undefined,
        or(isNull(monitoringTargets.nextScanAt), lte(monitoringTargets.nextScanAt, now)),
      ),
    )
    .orderBy(asc(monitoringTargets.nextScanAt), desc(monitoringTargets.priority))
    .limit(maxCompanies());

  return rows;
}

function toCandidate(
  article: NewsArticle,
  target: ScanTarget,
  signalType: NewsCandidate["matchedSignalType"],
): NewsCandidate {
  return {
    ...article,
    canonicalUrl: canonicalizeNewsUrl(article.canonicalUrl),
    organizationId: target.organizationId,
    companyId: target.companyId,
    companyName: target.companyName,
    companyDomain: target.companyDomain ?? undefined,
    matchedSignalType: signalType,
    // GDELT and RSS are discovery sources; publisher/source quality can be
    // tuned later without changing the ranking contract.
    sourceQuality: article.sourceType === "rss" ? 0.7 : 0.5,
  };
}

async function persistArticle(
  target: ScanTarget,
  candidate: NewsCandidate,
  relevanceScore: number,
  actorUserId?: string,
): Promise<string> {
  return withSystemTenantContext(target.organizationId, async (tx) => {
    const existing = await tx
      .select({ id: newsItems.id })
      .from(newsItems)
      .where(
        and(
          eq(newsItems.organizationId, target.organizationId),
          eq(newsItems.canonicalUrl, candidate.canonicalUrl),
        ),
      )
      .limit(1);
    const newsItemId = existing[0]?.id ?? (await tx
      .insert(newsItems)
      .values({
        organizationId: target.organizationId,
        canonicalUrl: candidate.canonicalUrl,
        title: candidate.title,
        publisher: candidate.publisher,
        sourceDomain: candidate.sourceDomain,
        sourceType: candidate.sourceType,
        publishedAt: candidate.publishedAt,
        discoveredAt: candidate.discoveredAt,
        excerpt: candidate.excerpt,
        contentHash: contentHash(candidate),
        rawMetadata: candidate.metadata,
      })
      .onConflictDoNothing({ target: [newsItems.organizationId, newsItems.canonicalUrl] })
      .returning({ id: newsItems.id }))[0]?.id;

    if (!newsItemId) {
      const resolved = await tx
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(
          and(
            eq(newsItems.organizationId, target.organizationId),
            eq(newsItems.canonicalUrl, candidate.canonicalUrl),
          ),
        )
        .limit(1);
      if (!resolved[0]) throw new Error("Unable to persist the discovered news item.");
      // Continue below so the company-to-article relationship is created even
      // when another retry won the insert race.
      await persistArticleRelationship(tx, target, resolved[0].id, relevanceScore);
      return resolved[0].id;
    }

    await persistArticleRelationship(tx, target, newsItemId, relevanceScore);
    return newsItemId;
  }, actorUserId);
}

async function persistArticleRelationship(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  target: ScanTarget,
  newsItemId: string,
  relevanceScore: number,
): Promise<void> {
  await tx
    .insert(companyNewsItems)
    .values({
      organizationId: target.organizationId,
      companyId: target.companyId,
      newsItemId,
      relevanceScore,
    })
    .onConflictDoUpdate({
      target: [companyNewsItems.organizationId, companyNewsItems.companyId, companyNewsItems.newsItemId],
      set: { relevanceScore },
    });
}

async function updateScan(
  scanId: string,
  organizationId: string,
  patch: Partial<ScanCounts> & { status: "completed" | "failed"; error?: string | null },
  actorUserId?: string,
): Promise<void> {
  await withSystemTenantContext(organizationId, async (tx) => {
    await tx
      .update(signalScans)
      .set({
        ...patch,
        completedAt: new Date(),
      })
      .where(and(eq(signalScans.id, scanId), eq(signalScans.organizationId, organizationId)));
  }, actorUserId);
}

async function scanTarget(target: ScanTarget, actorUserId?: string): Promise<ScanResult> {
  const now = new Date();
  const startDate = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
  const queries = buildSignalQueries(target.companyName, target.companyDomain ?? undefined);
  const candidates: NewsCandidate[] = [];
  const warnings: string[] = [];
  const gdelt = getGdeltClient();

  for (const query of queries) {
    try {
      const articles = await gdelt.search({ query: query.query, maxRecords: 20, startDate, endDate: now });
      candidates.push(...articles.map((article) => toCandidate(article, target, query.signalType)));
    } catch (error) {
      warnings.push(`GDELT ${query.signalType}: ${safeError(error)}`);
    }
  }

  if (target.rssFeedUrl) {
    try {
      const rssArticles = await new RssClient().fetch(target.rssFeedUrl);
      candidates.push(...rssArticles.map((article) => toCandidate(article, target, undefined)));
    } catch (error) {
      warnings.push(`RSS ${target.rssFeedUrl}: ${safeError(error)}`);
    }
  }

  const ranked = rankNewsCandidates(candidates, {
    now,
    targetPriority: target.priority,
    icpScore: target.icpScore ?? undefined,
    lastSeenAt: target.lastScannedAt,
  }).slice(0, maxArticlesPerCompany());
  let articlesFetched = 0;
  let signalsExtracted = 0;
  let provider: ReturnType<typeof getAIProvider> | null = null;
  if (isAiActionsEnabled()) {
    try {
      provider = getAIProvider();
    } catch (error) {
      warnings.push(`AI provider: ${safeError(error)}`);
    }
  } else {
    warnings.push("AI actions are disabled; using deterministic signal extraction.");
  }

  for (const scored of ranked) {
    const newsItemId = await persistArticle(target, scored.candidate, scored.score, actorUserId);
    let article = scored.candidate;
    try {
      const firecrawl = getFirecrawlClient();
      const scraped: FirecrawlScrapeResult = await firecrawl.scrapeUrl(scored.candidate.canonicalUrl);
      if (scraped.markdown) {
        article = {
          ...article,
          excerpt: `${article.excerpt ?? ""}\n${scraped.markdown.slice(0, MAX_MARKDOWN_FOR_SIGNAL)}`.slice(0, 2_000),
        };
      }
      articlesFetched += 1;
    } catch (error) {
      warnings.push(`Firecrawl ${scored.candidate.canonicalUrl}: ${safeError(error)}`);
    }

    const extracted = await extractSignals(provider, {
      article,
      company: {
        name: target.companyName,
        domain: target.companyDomain ?? undefined,
        industry: target.industry ?? undefined,
      },
      matchedSignalType: scored.candidate.matchedSignalType,
      context: {
        organizationId: target.organizationId,
        ...(actorUserId ? { actorUserId } : {}),
        traceId: `news-scan:${target.organizationId}:${target.companyId}`,
        dataClassification: "public",
      },
    });
    if (extracted.warning) warnings.push(`AI ${scored.candidate.canonicalUrl}: ${extracted.warning}`);
    if (extracted.extraction.signals.length > 0) {
      await withSystemTenantContext(target.organizationId, async (tx) => {
        await tx
          .insert(leadSignals)
          .values(
            extracted.extraction.signals.map((signal) =>
              toLeadSignalInsert({
                organizationId: target.organizationId,
                companyId: target.companyId,
                newsItemId,
                signal,
                model: extracted.model ?? extracted.provider,
              }),
            ),
          )
          .onConflictDoNothing({
            target: [leadSignals.organizationId, leadSignals.companyId, leadSignals.newsItemId, leadSignals.signalType],
          });
      }, actorUserId);
      signalsExtracted += extracted.extraction.signals.length;
    }
  }

  await withSystemTenantContext(target.organizationId, async (tx) => {
    await tx
      .update(monitoringTargets)
      .set({
        lastScannedAt: now,
        nextScanAt: new Date(now.getTime() + target.scanFrequencyDays * 86_400_000),
      })
      .where(and(eq(monitoringTargets.id, target.targetId), eq(monitoringTargets.organizationId, target.organizationId)));
  }, actorUserId);

  return { candidatesFound: candidates.length, articlesFetched, signalsExtracted, warnings };
}

async function runOrganizationScan(
  organizationId: string,
  actorUserId: string | undefined,
  reservationKey: string,
): Promise<ScanCounts & { warning?: string }> {
  const targets = await loadDueTargets(organizationId);
  if (targets.length === 0) {
    return { candidatesFound: 0, articlesFetched: 0, signalsExtracted: 0 };
  }

  const now = new Date();
  const scan = await withSystemTenantContext(
    organizationId,
    async (tx) => {
      if (actorUserId) {
        const actor = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, actorUserId),
              eq(users.organizationId, organizationId),
              eq(users.isActive, true),
            ),
          )
          .limit(1);
        if (!actor[0]) {
          throw new NonRetriableError("News scan actor is not an active member of the target organization.");
        }
      }

      try {
        await reserveOrganizationUsage(tx, {
          organizationId,
          kind: "news_scan",
          reservationKey,
          now,
        });
      } catch (error) {
        if (error instanceof OrganizationUsageLimitError) return null;
        throw error;
      }

      return (
        await tx
          .insert(signalScans)
          .values({ organizationId, status: "running", startedAt: now })
          .returning({ id: signalScans.id })
      )[0];
    },
    actorUserId,
  );
  if (!scan) {
    return {
      candidatesFound: 0,
      articlesFetched: 0,
      signalsExtracted: 0,
      warning: "The organization news-scan daily limit has been reached.",
    };
  }

  const totals = { candidatesFound: 0, articlesFetched: 0, signalsExtracted: 0 };
  const warnings: string[] = [];
  try {
    for (const target of targets) {
      const result = await scanTarget(target, actorUserId);
      totals.candidatesFound += result.candidatesFound;
      totals.articlesFetched += result.articlesFetched;
      totals.signalsExtracted += result.signalsExtracted;
      warnings.push(...result.warnings.slice(0, 10));
    }
    await updateScan(scan.id, organizationId, {
      ...totals,
      status: "completed",
      error: warnings.length ? warnings.join(" | ").slice(0, 1_000) : null,
    }, actorUserId);
    return { ...totals, ...(warnings.length ? { warning: warnings.join(" | ").slice(0, 1_000) } : {}) };
  } catch (error) {
    await updateScan(scan.id, organizationId, {
      ...totals,
      status: "failed",
      error: safeError(error),
    }, actorUserId);
    throw error;
  }
}

export const scanNewsScheduled = inngest.createFunction(
  {
    id: "scan-news-weekly",
    name: "Scan monitored companies for lead signals",
    triggers: [cron(process.env.NEWS_SCAN_CRON ?? DEFAULT_CRON)],
    concurrency: { limit: 1, scope: "fn" },
  },
  async ({ step }) => {
    if (!scanEnabled()) return { skipped: true, reason: "NEWS_SCAN_ENABLED=0" };
    const scanDate = usageDateKey();
    const organizationIds = await step.run("load-due-organizations", async () =>
      [...new Set((await loadDueTargets()).map((target) => target.organizationId))],
    );
    const results = [];
    for (const organizationId of organizationIds) {
      results.push(await step.run(`scan-organization-${organizationId}`, () =>
        runOrganizationScan(organizationId, undefined, `scheduled:${organizationId}:${scanDate}`),
      ));
    }
    return { organizations: organizationIds.length, results };
  },
);

export const scanNewsRequested = inngest.createFunction(
  {
    id: "scan-news-requested",
    name: "Scan monitored companies on demand",
    idempotency: "event.data.runId",
    triggers: [{ event: newsScanRequested }],
    concurrency: { limit: 1, key: "event.data.organizationId", scope: "fn" },
  },
  async ({ event, step }) => {
    if (!scanEnabled()) return { skipped: true, reason: "NEWS_SCAN_ENABLED=0" };
    return step.run("scan-organization", () =>
      runOrganizationScan(event.data.organizationId, event.data.actorUserId, event.data.runId),
    );
  },
);

export const __newsScanInternals = {
  loadDueTargets,
  runOrganizationScan,
  scanTarget,
  scanEnabled,
};
