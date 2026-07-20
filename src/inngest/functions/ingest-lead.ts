import { and, eq, or, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngest, leadIngestRequested } from "@/inngest/client";
import {
  ApolloApiError,
  ApolloConfigurationError,
  ingestApolloLeads,
  type ApolloContactPayload,
  type ApolloLeadBatch,
} from "@/lib/apollo";
import { getAIProvider } from "@/lib/ai/server";
import { AIProviderError } from "@/lib/ai";
import { auditLogs, companies, contacts, pipeline, users } from "@/lib/db";
import { scrapeDomain, type FirecrawlScrapeResult } from "@/lib/firecrawl";

import {
  withLeadMutationContext,
  type LeadContext,
} from "@/features/lead-workbench/server/context";

const aiEnrichmentSchema = z.object({
  icpScore: z.number().int().min(0).max(100),
  painPoints: z.array(z.string().trim().min(1)).length(3),
  outreachDraft: z.string().trim().min(1).max(12_000),
});

type InitialLeadData = Readonly<{
  companyId: string;
  contactIds: string[];
  primaryContact: ApolloContactPayload | null;
}>;

type EnrichmentData = z.infer<typeof aiEnrichmentSchema>;

export function safeEnrichmentError(error: unknown): string {
  if (error instanceof Error) {
    const status = "status" in error && typeof error.status === "number" ? ` (HTTP ${error.status})` : "";
    return `${error.name}${status}`.slice(0, 1000);
  }
  return "UnknownError";
}

export function toWorkflowError(error: unknown): unknown {
  if (error instanceof ApolloConfigurationError) {
    return new NonRetriableError("Apollo is not configured for lead ingestion.", { cause: error });
  }

  if (
    error instanceof ApolloApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    return new NonRetriableError("Apollo rejected the lead ingestion request.", { cause: error });
  }

  if (
    error instanceof AIProviderError &&
    (/not configured|invalid JSON|HTTP 4\d\d/i.test(error.message))
  ) {
    return new NonRetriableError("Claude MCP cannot complete this enrichment request.", { cause: error });
  }

  return error;
}

function normalizeComparable(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function sameContact(left: typeof contacts.$inferSelect, right: ApolloContactPayload): boolean {
  if (left.apolloId && left.apolloId === right.apolloId) return true;

  const leftEmail = normalizeComparable(left.email);
  const rightEmail = normalizeComparable(right.email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true;

  const leftLinkedin = normalizeComparable(left.linkedin);
  const rightLinkedin = normalizeComparable(right.linkedin);
  if (leftLinkedin && rightLinkedin && leftLinkedin === rightLinkedin) return true;

  return (
    normalizeComparable(left.name) === normalizeComparable(right.name) &&
    normalizeComparable(left.title) === normalizeComparable(right.title)
  );
}

async function initializeIngestion(
  domain: string,
  context: LeadContext,
  runId: string,
): Promise<string> {
  return withLeadMutationContext(context, async (tx) => {
    const actor = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, context.userId), eq(users.organizationId, context.organizationId)))
      .limit(1);
    if (!actor[0]) {
      throw new NonRetriableError("Ingestion actor is not a member of the target organization.");
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${domain}`}, 0))`,
    );

    const existing = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, context.organizationId),
          or(
            eq(companies.domain, domain),
            eq(companies.website, `https://${domain}`),
            eq(companies.website, `http://${domain}`),
            eq(companies.website, `https://www.${domain}`),
            eq(companies.website, `http://www.${domain}`),
          ),
        ),
      )
      .limit(1);

    const companyId = existing[0]?.id ?? (await tx
      .insert(companies)
      .values({
        organizationId: context.organizationId,
        domain,
        name: domain,
        website: `https://${domain}`,
        status: "prospect",
        enrichmentStatus: "processing",
        enrichmentRunId: runId,
        enrichmentError: null,
        enrichmentErrorAt: null,
      })
      .returning({ id: companies.id }))[0]?.id;

    if (!companyId) throw new Error("Unable to initialize the ingestion company.");

    await tx
      .update(companies)
      .set({
        enrichmentStatus: "processing",
        enrichmentRunId: runId,
        enrichmentError: null,
        enrichmentErrorAt: null,
      })
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, context.organizationId)));

    await tx
      .insert(pipeline)
      .values({ organizationId: context.organizationId, companyId, stage: "new" })
      .onConflictDoNothing({ target: pipeline.companyId });

    return companyId;
  });
}

async function saveInitialData(
  batch: ApolloLeadBatch,
  context: LeadContext,
  companyId: string,
  runId: string,
): Promise<InitialLeadData> {
  return withLeadMutationContext(context, async (tx) => {
    const actor = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, context.userId),
          eq(users.organizationId, context.organizationId),
        ),
      )
      .limit(1);
    if (!actor[0]) {
      throw new NonRetriableError("Ingestion actor is not a member of the target organization.");
    }

    // Serialize concurrent retries/submissions for the same tenant/domain so
    // the contact dedupe scan and inserts share one atomic boundary.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${batch.domain}`}, 0))`,
    );

    const companyRows = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.id, companyId),
          eq(companies.organizationId, context.organizationId),
        ),
      )
      .limit(1);
    const company = companyRows[0];
    if (!company || company.enrichmentRunId !== runId) {
      throw new NonRetriableError("Ingestion run is stale or its company record was removed.");
    }

    const updatedCompany = await tx
      .update(companies)
      .set({
        name: batch.company.name,
        website: batch.company.website,
        industry: batch.company.industry,
        size: batch.company.size,
        location: batch.company.location,
        domain: batch.domain,
        enrichmentStatus: "processing",
        enrichmentError: null,
        enrichmentErrorAt: null,
      })
      .where(
        and(
          eq(companies.id, company.id),
          eq(companies.organizationId, context.organizationId),
          eq(companies.enrichmentRunId, runId),
        ),
      )
      .returning();
    const persistedCompany = updatedCompany[0];
    if (!persistedCompany) {
      throw new NonRetriableError("Ingestion run lost ownership of the company record.");
    }

    await tx
      .insert(pipeline)
      .values({ organizationId: context.organizationId, companyId: persistedCompany.id, stage: "new" })
      .onConflictDoNothing({ target: pipeline.companyId });

    const existingContacts = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, context.organizationId),
          eq(contacts.companyId, persistedCompany.id),
        ),
      );
    const contactIds: string[] = [];

    for (const contactPayload of batch.contacts) {
      const existingByApolloId = await (contactPayload.apolloId
        ? tx
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.organizationId, context.organizationId),
                eq(contacts.apolloId, contactPayload.apolloId),
              ),
            )
            .limit(1)
        : Promise.resolve([]));
      const existing = existingByApolloId[0] ?? existingContacts.find((candidate) =>
        sameContact(candidate, contactPayload),
      );
      if (existing && existing.companyId !== persistedCompany.id) {
        // Apollo can return a person already associated with another company
        // in this organization. Do not silently reassign that relationship or
        // create a duplicate against the org-wide Apollo ID constraint.
        continue;
      }
      if (existing) {
        if (!existing.apolloId) {
          await tx
            .update(contacts)
            .set({ apolloId: contactPayload.apolloId })
            .where(
              and(
                eq(contacts.id, existing.id),
                eq(contacts.organizationId, context.organizationId),
              ),
            );
        }
        contactIds.push(existing.id);
        const existingContactPipeline = await tx
          .select({ id: pipeline.id })
          .from(pipeline)
          .where(
            and(
              eq(pipeline.organizationId, context.organizationId),
              eq(pipeline.contactId, existing.id),
            ),
          )
          .limit(1);
        if (!existingContactPipeline[0]) {
          await tx
            .insert(pipeline)
            .values({
              organizationId: context.organizationId,
              contactId: existing.id,
              stage: "new",
            })
            .onConflictDoNothing({ target: pipeline.contactId });
        }
        continue;
      }

      const inserted = await tx
        .insert(contacts)
        .values({
          organizationId: context.organizationId,
          companyId: persistedCompany.id,
          apolloId: contactPayload.apolloId,
          name: contactPayload.name,
          title: contactPayload.title,
          email: contactPayload.email,
          linkedin: contactPayload.linkedin,
          notes: contactPayload.notes,
        })
        .returning();
      const contact = inserted[0];
      if (!contact) throw new Error("Apollo contact insert returned no row.");
      contactIds.push(contact.id);
      existingContacts.push(contact);

      await tx
        .insert(pipeline)
        .values({
          organizationId: context.organizationId,
          contactId: contact.id,
          stage: "new",
        })
        .onConflictDoNothing({ target: pipeline.contactId });
    }

    return {
      companyId: persistedCompany.id,
      contactIds,
      primaryContact: batch.contacts[0] ?? null,
    };
  });
}

async function markEnrichmentFailed(
  context: LeadContext,
  companyId: string,
  domain: string,
  runId: string,
  error: unknown,
): Promise<void> {
  await withLeadMutationContext(context, async (tx) => {
    const actor = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, context.userId), eq(users.organizationId, context.organizationId)))
      .limit(1);
    const updated = await tx
      .update(companies)
      .set({
        enrichmentStatus: "failed",
        enrichmentError: safeEnrichmentError(error),
        enrichmentErrorAt: new Date(),
      })
      .where(
        and(
          eq(companies.id, companyId),
          eq(companies.organizationId, context.organizationId),
          eq(companies.enrichmentRunId, runId),
        ),
      )
      .returning({ id: companies.id });
    if (!updated[0]) return;

    const existingFailureAudit = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, context.organizationId),
          eq(auditLogs.action, "enrichment_failed"),
          eq(auditLogs.entityId, companyId),
          sql`${auditLogs.metadata} ->> 'runId' = ${runId}`,
        ),
      )
      .limit(1);
    if (existingFailureAudit[0]) return;

    await tx.insert(auditLogs).values({
      organizationId: context.organizationId,
      actorUserId: actor[0]?.id ?? null,
      action: "enrichment_failed",
      entityType: "company",
      entityId: companyId,
      changes: {
        enrichmentStatus: "failed",
        enrichmentError: safeEnrichmentError(error),
      },
      metadata: { source: "apollo-firecrawl-inngest", domain, runId },
    });
  });
}

export const ingestLead = inngest.createFunction(
  {
    id: "ingest-lead",
    name: "Ingest and enrich lead domain",
    description: "Find Apollo contacts, scrape the company, and enrich the lead with AI.",
    // Keep duplicate submissions for the same tenant/domain from starting a
    // second workflow while still allowing a fresh run after the Inngest
    // idempotency window expires. Database-level matching below remains the
    // final safety boundary for retries.
    idempotency: "event.data.runId",
    concurrency: {
      limit: 1,
      key: "event.data.organizationId + '-' + event.data.domain",
      scope: "fn",
    },
    triggers: [{ event: leadIngestRequested }],
  },
  async ({ event, step }) => {
    const context: LeadContext = {
      organizationId: event.data.organizationId,
      userId: event.data.actorUserId,
    };
    const runId = event.data.runId;
    const placeholderCompanyId = await step.run("initialize-ingestion", async () =>
      initializeIngestion(event.data.domain, context, runId),
    );

    try {
      const apolloData = await step.run("fetch-apollo-data", async () =>
        ingestApolloLeads(event.data.domain, event.data.targetTitles),
      );

      const initialData = await step.run("save-initial-data", async () =>
        saveInitialData(apolloData, context, placeholderCompanyId, runId),
      );

      const scrape: FirecrawlScrapeResult = await step.run(
        "scrape-website",
        async () => scrapeDomain(apolloData.domain),
      );

    const enrichment: EnrichmentData = await step.run(
      "ai-enrichment",
      async () => {
        const provider = getAIProvider();
        const primaryContact = initialData.primaryContact
          ? JSON.stringify(initialData.primaryContact)
          : "No primary contact was enriched.";
        const scrapedMarkdown = scrape.markdown || "No website Markdown was available.";

        const result = await provider.extractEntities({
          text: [
            "Enrich this lead for a founder-led sales workflow.",
            `Company metadata: ${JSON.stringify(apolloData.company)}`,
            `Primary contact: ${primaryContact}`,
            `Website Markdown:\n${scrapedMarkdown}`,
          ].join("\n\n"),
          schema: aiEnrichmentSchema,
          instructions:
            "Return exactly three evidence-based pain points, an ICP score from 0-100, and a concise personalized first-draft outreach email. Clearly avoid unsupported claims and label uncertainty in the email when needed.",
          context: {
            organizationId: context.organizationId,
            actorUserId: context.userId,
            traceId: `lead-ingest:${context.organizationId}:${event.data.domain}`,
          },
        });

        return result.data;
      },
    );

    const saved = await step.run("save-enrichment", async () =>
      withLeadMutationContext(context, async (tx) => {
        const updated = await tx
          .update(companies)
          .set({
            enrichmentStatus: "complete",
            icpScore: enrichment.icpScore,
            painPoints: enrichment.painPoints,
            outreachDraft: enrichment.outreachDraft,
            enrichedAt: new Date(),
          })
          .where(
            and(
              eq(companies.id, initialData.companyId),
              eq(companies.organizationId, context.organizationId),
              eq(companies.enrichmentRunId, runId),
              eq(companies.enrichmentStatus, "processing"),
            ),
          )
          .returning({ id: companies.id });
        if (!updated[0]) {
          throw new NonRetriableError("Ingestion run no longer owns the company record.");
        }

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "enrichment_complete",
          entityType: "company",
          entityId: initialData.companyId,
          changes: {
            icpScore: enrichment.icpScore,
            painPoints: enrichment.painPoints,
            outreachDraftGenerated: true,
            scraped: Boolean(scrape.markdown),
            scrapeWarning: scrape.warning ?? null,
            runId,
          },
          metadata: {
            source: "apollo-firecrawl-inngest",
            domain: apolloData.domain,
            contactCount: initialData.contactIds.length,
          },
        });

        return updated[0];
      }),
    );

      return {
        companyId: saved.id,
        contactsFound: initialData.contactIds.length,
        icpScore: enrichment.icpScore,
        scrapeWarning: scrape.warning ?? null,
      };
    } catch (error) {
      const workflowError = toWorkflowError(error);
      try {
        await step.run("mark-enrichment-failed", async () => {
          await markEnrichmentFailed(
            context,
            placeholderCompanyId,
            event.data.domain,
            runId,
            error,
          );
        });
      } catch (failureError) {
        console.error("Unable to mark lead enrichment as failed", {
          errorName: failureError instanceof Error ? failureError.name : "UnknownError",
          companyId: placeholderCompanyId,
        });
      }
      throw workflowError;
    }
  },
);
