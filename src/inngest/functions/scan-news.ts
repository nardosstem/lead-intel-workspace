import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { cron, NonRetriableError, type GetStepTools } from "inngest";

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

import {
  inngest,
  newsScanRequested,
  scheduledNewsScanRequested,
} from "@/inngest/client";

// Run daily so targets configured for 1–90 day cadence and provider failures
// retry on the next due day instead of waiting for the next Monday.
const DEFAULT_CRON = "TZ=UTC 0 7 * * *";
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

type StartedScan = Readonly<{
  scanId: string;
  targets: SerializedScanTarget[];
}>;

type SerializedScanTarget = Omit<ScanTarget, "lastScannedAt"> & {
  lastScannedAt: string | null;
};

type SerializedNewsCandidate = Omit<NewsCandidate, "publishedAt" | "discoveredAt"> & {
  publishedAt: string | null;
  discoveredAt: string;
  relevanceScore: number;
};

type SerializedNewsArticle = Omit<NewsArticle, "publishedAt" | "discoveredAt"> & {
  publishedAt: string | null;
  discoveredAt: string;
};

type ProviderDiscoveryResult = Readonly<{
  articles: SerializedNewsArticle[];
  warning: string | null;
}>;

type DiscoveryResult = Readonly<{
  candidates: SerializedNewsCandidate[];
  warnings: string[];
  scannedAt: string;
}>;

type StepRunner = GetStepTools<typeof inngest>;

type ScrapeOutcome = Readonly<{
  article: NewsArticle;
  fetched: boolean;
  warning?: string;
}>;

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

function serializeTarget(target: ScanTarget): SerializedScanTarget {
  return {
    ...target,
    lastScannedAt: target.lastScannedAt?.toISOString() ?? null,
  };
}

function deserializeTarget(target: SerializedScanTarget): ScanTarget {
  return {
    ...target,
    lastScannedAt: target.lastScannedAt ? new Date(target.lastScannedAt) : null,
  };
}

function serializeCandidate(candidate: NewsCandidate, relevanceScore: number): SerializedNewsCandidate {
  return {
    ...candidate,
    publishedAt: candidate.publishedAt?.toISOString() ?? null,
    discoveredAt: candidate.discoveredAt.toISOString(),
    relevanceScore,
  };
}

function deserializeCandidate(candidate: SerializedNewsCandidate): NewsCandidate {
  return {
    ...candidate,
    publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
    discoveredAt: new Date(candidate.discoveredAt),
  };
}

function serializeArticle(article: NewsArticle): SerializedNewsArticle {
  return {
    ...article,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    discoveredAt: article.discoveredAt.toISOString(),
  };
}

function deserializeArticle(article: SerializedNewsArticle): NewsArticle {
  return {
    ...article,
    publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    discoveredAt: new Date(article.discoveredAt),
  };
}

/** Preserve a provider's non-fatal scrape warning in the durable scan record. */
export function applyScrapeResult(
  article: NewsArticle,
  scraped: FirecrawlScrapeResult,
): ScrapeOutcome {
  if (!scraped.markdown) {
    return { article, fetched: false, ...(scraped.warning ? { warning: scraped.warning } : {}) };
  }

  return {
    article: {
      ...article,
      excerpt: `${article.excerpt ?? ""}\n${scraped.markdown.slice(0, MAX_MARKDOWN_FOR_SIGNAL)}`.slice(0, 2_000),
    },
    fetched: true,
    ...(scraped.warning ? { warning: scraped.warning } : {}),
  };
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
  force = false,
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
        force
          ? undefined
          : or(isNull(monitoringTargets.nextScanAt), lte(monitoringTargets.nextScanAt, now)),
      ),
    )
    .orderBy(asc(monitoringTargets.nextScanAt), desc(monitoringTargets.priority))
    .limit(maxCompanies());

  return rows;
}

async function loadDueOrganizationIds(): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .select({ organizationId: monitoringTargets.organizationId })
    .from(monitoringTargets)
    .where(
      and(
        eq(monitoringTargets.enabled, true),
        or(isNull(monitoringTargets.nextScanAt), lte(monitoringTargets.nextScanAt, new Date())),
      ),
    );
  return [...new Set(rows.map((row) => row.organizationId))];
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

async function discoverTargetDurably(
  step: StepRunner,
  target: ScanTarget,
  stepPrefix: string,
): Promise<DiscoveryResult> {
  const now = new Date();
  const startDate = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
  const queries = buildSignalQueries(target.companyName, target.companyDomain ?? undefined);
  const candidates: NewsCandidate[] = [];
  const warnings: string[] = [];

  for (const query of queries) {
    const queryKey = query.signalType.replaceAll("_", "-");
    const result = await step.run(`${stepPrefix}-gdelt-${queryKey}`, async (): Promise<ProviderDiscoveryResult> => {
      try {
        const articles = await getGdeltClient().search({
          query: query.query,
          maxRecords: 20,
          startDate,
          endDate: now,
        });
        return { articles: articles.map(serializeArticle), warning: null };
      } catch (error) {
        return { articles: [], warning: `GDELT ${query.signalType}: ${safeError(error)}` };
      }
    });
    candidates.push(...result.articles.map((article) => toCandidate(deserializeArticle(article), target, query.signalType)));
    if (result.warning) warnings.push(result.warning);
  }

  if (target.rssFeedUrl) {
    const result = await step.run(`${stepPrefix}-rss`, async (): Promise<ProviderDiscoveryResult> => {
      try {
        const articles = await new RssClient().fetch(target.rssFeedUrl!);
        return { articles: articles.map(serializeArticle), warning: null };
      } catch (error) {
        return { articles: [], warning: `RSS ${target.rssFeedUrl}: ${safeError(error)}` };
      }
    });
    candidates.push(...result.articles.map((article) => toCandidate(deserializeArticle(article), target, undefined)));
    if (result.warning) warnings.push(result.warning);
  }

  const ranked = rankNewsCandidates(candidates, {
    now,
    targetPriority: target.priority,
    icpScore: target.icpScore ?? undefined,
    lastSeenAt: target.lastScannedAt,
  }).slice(0, maxArticlesPerCompany());

  return {
    candidates: ranked.map(({ candidate, score }) => serializeCandidate(candidate, score)),
    warnings,
    scannedAt: now.toISOString(),
  };
}

async function startDurableScan(
  organizationId: string,
  actorUserId: string | undefined,
  reservationKey: string,
  usageDate: string,
  force = false,
): Promise<StartedScan | null> {
  const targets = await loadDueTargets(organizationId, force);
  if (targets.length === 0) return null;

  const now = new Date();
  const scan = await withSystemTenantContext(
    organizationId,
    async (tx) => {
      if (actorUserId) {
        const actor = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.id, actorUserId),
            eq(users.organizationId, organizationId),
            eq(users.isActive, true),
          ))
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
          usageDate,
          now,
        });
      } catch (error) {
        if (error instanceof OrganizationUsageLimitError) return null;
        throw error;
      }

      const inserted = await tx
        .insert(signalScans)
        .values({ organizationId, runId: reservationKey, status: "running", startedAt: now })
        .onConflictDoNothing({ target: [signalScans.organizationId, signalScans.runId] })
        .returning({ id: signalScans.id });
      if (inserted[0]) return inserted[0];
      const existing = await tx
        .select({ id: signalScans.id })
        .from(signalScans)
        .where(and(eq(signalScans.organizationId, organizationId), eq(signalScans.runId, reservationKey)))
        .limit(1);
      if (!existing[0]) return null;
      await tx.update(signalScans).set({ status: "running", startedAt: now, completedAt: null, error: null })
        .where(and(eq(signalScans.id, existing[0].id), eq(signalScans.organizationId, organizationId)));
      return existing[0];
    },
    actorUserId,
  );

  return scan
    ? { scanId: scan.id, targets: targets.map(serializeTarget) }
    : null;
}

async function saveExtractedSignals(
  target: ScanTarget,
  newsItemId: string,
  extracted: Awaited<ReturnType<typeof extractSignals>>,
  actorUserId?: string,
): Promise<number> {
  if (extracted.extraction.signals.length === 0) return 0;
  await withSystemTenantContext(target.organizationId, async (tx) => {
    await tx
      .insert(leadSignals)
      .values(extracted.extraction.signals.map((signal) => toLeadSignalInsert({
        organizationId: target.organizationId,
        companyId: target.companyId,
        newsItemId,
        signal,
        model: extracted.model ?? extracted.provider,
      })))
      .onConflictDoNothing({
        target: [leadSignals.organizationId, leadSignals.companyId, leadSignals.newsItemId, leadSignals.signalType],
      });
  }, actorUserId);
  return extracted.extraction.signals.length;
}

async function runDurableTarget(
  step: StepRunner,
  target: SerializedScanTarget,
  actorUserId: string | undefined,
  stepPrefix: string,
): Promise<ScanResult> {
  const parsedTarget = deserializeTarget(target);
  const discovery = await discoverTargetDurably(step, parsedTarget, stepPrefix);
  const warnings = [...discovery.warnings];
  let articlesFetched = 0;
  let signalsExtracted = 0;

  for (const serializedCandidate of discovery.candidates) {
    const candidate = deserializeCandidate(serializedCandidate);
    const candidateKey = createHash("sha256").update(candidate.canonicalUrl).digest("hex").slice(0, 16);
    const newsItemId = await step.run(`${stepPrefix}-persist-${candidateKey}`, () =>
      persistArticle(parsedTarget, candidate, serializedCandidate.relevanceScore, actorUserId),
    );
    const scraped = await step.run(`${stepPrefix}-scrape-${candidateKey}`, () => {
      try {
        return getFirecrawlClient().scrapeUrl(candidate.canonicalUrl);
      } catch (error) {
        return Promise.resolve({
          sourceUrl: candidate.canonicalUrl,
          markdown: "",
          truncated: false,
          warning: safeError(error),
          failure: /not configured/i.test(safeError(error)) ? "configuration" : "transient",
        } satisfies FirecrawlScrapeResult);
      }
    });
    if (scraped.failure === "transient") {
      throw new Error(scraped.warning ?? "Firecrawl temporarily unavailable.");
    }
    if (scraped.failure === "configuration") {
      throw new NonRetriableError(scraped.warning ?? "Firecrawl could not scrape the article.");
    }
    if (scraped.failure === "provider") {
      throw new NonRetriableError(scraped.warning ?? "Firecrawl rejected the configured provider request.");
    }
    if (scraped.failure === "target" && scraped.warning) warnings.push(`Firecrawl ${candidate.canonicalUrl}: ${scraped.warning}`);
    if (scraped.markdown) articlesFetched += 1;
    if (scraped.warning && scraped.failure !== "target") warnings.push(`Firecrawl ${candidate.canonicalUrl}: ${scraped.warning}`);

    const extracted = await step.run(`${stepPrefix}-enrich-${candidateKey}`, async () => {
      let provider: ReturnType<typeof getAIProvider> | null = null;
      if (isAiActionsEnabled()) {
        try {
          provider = getAIProvider();
        } catch (error) {
          return {
            ...(await extractSignals(null, {
              article: applyScrapeResult(candidate, scraped).article,
              company: { name: parsedTarget.companyName, domain: parsedTarget.companyDomain ?? undefined, industry: parsedTarget.industry ?? undefined },
              matchedSignalType: candidate.matchedSignalType,
              context: { organizationId: parsedTarget.organizationId, ...(actorUserId ? { actorUserId } : {}), traceId: `news-scan:${parsedTarget.organizationId}:${parsedTarget.companyId}`, dataClassification: "public" },
            })),
            warning: `AI provider: ${safeError(error)}`,
          };
        }
      }
      return extractSignals(provider, {
        article: applyScrapeResult(candidate, scraped).article,
        company: { name: parsedTarget.companyName, domain: parsedTarget.companyDomain ?? undefined, industry: parsedTarget.industry ?? undefined },
        matchedSignalType: candidate.matchedSignalType,
        context: { organizationId: parsedTarget.organizationId, ...(actorUserId ? { actorUserId } : {}), traceId: `news-scan:${parsedTarget.organizationId}:${parsedTarget.companyId}`, dataClassification: "public" },
      });
    });
    if (extracted.warning) warnings.push(`AI ${candidate.canonicalUrl}: ${extracted.warning}`);
    signalsExtracted += await step.run(`${stepPrefix}-save-signals-${candidateKey}`, () =>
      saveExtractedSignals(parsedTarget, newsItemId, extracted, actorUserId),
    );
  }

  await step.run(`${stepPrefix}-mark-target-scanned`, () => withSystemTenantContext(parsedTarget.organizationId, async (tx) => {
    const scannedAt = new Date(discovery.scannedAt);
    const retrySoon = discovery.warnings.length > 0;
    await tx
      .update(monitoringTargets)
      .set({
        lastScannedAt: scannedAt,
        nextScanAt: new Date(scannedAt.getTime() + (retrySoon ? 86_400_000 : parsedTarget.scanFrequencyDays * 86_400_000)),
      })
      .where(and(eq(monitoringTargets.id, parsedTarget.targetId), eq(monitoringTargets.organizationId, parsedTarget.organizationId)));
  }, actorUserId));

  return {
    candidatesFound: discovery.candidates.length,
    articlesFetched,
    signalsExtracted,
    warnings,
  };
}

async function runDurableOrganizationScan(
  step: StepRunner,
  organizationId: string,
  actorUserId: string | undefined,
  reservationKey: string,
  usageDate: string,
  stepPrefix: string,
  force = false,
): Promise<ScanCounts & { warning?: string }> {
  const started = await step.run(`${stepPrefix}-start`, () =>
    startDurableScan(organizationId, actorUserId, reservationKey, usageDate, force),
  );
  if (!started) return { candidatesFound: 0, articlesFetched: 0, signalsExtracted: 0 };

  const totals = { candidatesFound: 0, articlesFetched: 0, signalsExtracted: 0 };
  const warnings: string[] = [];
  try {
    for (const target of started.targets) {
      const result = await runDurableTarget(step, target, actorUserId, `${stepPrefix}-target-${target.targetId}`);
      totals.candidatesFound += result.candidatesFound;
      totals.articlesFetched += result.articlesFetched;
      totals.signalsExtracted += result.signalsExtracted;
      warnings.push(...result.warnings.slice(0, 10));
    }
    const warning = warnings.length ? warnings.join(" | ").slice(0, 1_000) : null;
    await step.run(`${stepPrefix}-complete`, () => updateScan(started.scanId, organizationId, {
      ...totals,
      status: "completed",
      error: warning,
    }, actorUserId));
    return { ...totals, ...(warning ? { warning } : {}) };
  } catch (error) {
    await step.run(`${stepPrefix}-failed`, () => updateScan(started.scanId, organizationId, {
      ...totals,
      status: "failed",
      error: safeError(error),
    }, actorUserId));
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
    const organizationIds = await step.run("load-due-organizations", loadDueOrganizationIds);
    for (const organizationId of organizationIds) {
      await step.run(`enqueue-${organizationId}`, async () => {
        const event = scheduledNewsScanRequested.create({
          organizationId,
          runId: `scheduled:${organizationId}:${scanDate}`,
          usageDate: scanDate,
        });
        await event.validate();
        await inngest.send({ name: event.name, data: event.data });
      });
    }
    return { organizations: organizationIds.length, queued: true };
  },
);

export const scanNewsOrganizationScheduled = inngest.createFunction(
  {
    id: "scan-news-organization-scheduled",
    name: "Scan one organization's monitored companies",
    idempotency: "event.data.runId",
    triggers: [{ event: scheduledNewsScanRequested }],
    concurrency: { limit: 1, key: "event.data.organizationId", scope: "fn" },
  },
  async ({ event, step }) => {
    if (!scanEnabled()) return { skipped: true, reason: "NEWS_SCAN_ENABLED=0" };
    return runDurableOrganizationScan(
      step,
      event.data.organizationId,
      undefined,
      event.data.runId,
      event.data.usageDate ?? usageDateKey(),
      "scan-organization",
    );
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
    return runDurableOrganizationScan(
      step,
      event.data.organizationId,
      event.data.actorUserId,
      event.data.runId,
      event.data.usageDate ?? usageDateKey(),
      "scan-organization",
      event.data.force,
    );
  },
);

export const __newsScanInternals = {
  loadDueTargets,
  loadDueOrganizationIds,
  startDurableScan,
  scanEnabled,
  applyScrapeResult,
};
