import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { inngest, leadIngestRequested } from "@/inngest/client";
import {
  ingestApolloLeads,
  normalizeDomain,
  type ApolloContactPayload,
  type ApolloLeadBatch,
} from "@/lib/apollo";
import { getAIProvider } from "@/lib/ai/server";
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

async function saveInitialData(
  batch: ApolloLeadBatch,
  context: LeadContext,
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
      throw new Error("Ingestion actor is not a member of the target organization.");
    }

    // Serialize concurrent retries/submissions for the same tenant/domain so
    // the contact dedupe scan and inserts share one atomic boundary.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${batch.domain}`}, 0))`,
    );

    const organizationCompanies = await tx
      .select()
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId));
    let company = organizationCompanies.find(
      (candidate) =>
        candidate.domain === batch.domain ||
        (candidate.website && normalizeDomain(candidate.website) === batch.domain),
    );

    if (!company) {
      const inserted = await tx
        .insert(companies)
        .values({
          organizationId: context.organizationId,
          domain: batch.domain,
          name: batch.company.name,
          website: batch.company.website,
          industry: batch.company.industry,
          size: batch.company.size,
          location: batch.company.location,
          status: "prospect",
          enrichmentStatus: "processing",
        })
        .onConflictDoNothing({
          target: [companies.organizationId, companies.domain],
        })
        .returning();
      company = inserted[0];
      if (!company) {
        const concurrent = await tx
          .select()
          .from(companies)
          .where(
            and(
              eq(companies.organizationId, context.organizationId),
              eq(companies.domain, batch.domain),
            ),
          )
          .limit(1);
        company = concurrent[0];
        if (!company) throw new Error("Apollo company insert returned no row.");
      }

      if (inserted[0]) {
        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          companyId: company.id,
          stage: "new",
        });
      } else {
        const updated = await tx
          .update(companies)
          .set({ enrichmentStatus: "processing", domain: batch.domain })
          .where(
            and(
              eq(companies.id, company.id),
              eq(companies.organizationId, context.organizationId),
            ),
          )
          .returning();
        company = updated[0] ?? company;

        const existingCompanyPipeline = await tx
          .select({ id: pipeline.id })
          .from(pipeline)
          .where(
            and(
              eq(pipeline.organizationId, context.organizationId),
              eq(pipeline.companyId, company.id),
            ),
          )
          .limit(1);
        if (!existingCompanyPipeline[0]) {
          await tx
            .insert(pipeline)
            .values({
              organizationId: context.organizationId,
              companyId: company.id,
              stage: "new",
            })
            .onConflictDoNothing({ target: pipeline.companyId });
        }
      }
    } else {
      const updated = await tx
        .update(companies)
        .set({ enrichmentStatus: "processing", domain: batch.domain })
        .where(
          and(
            eq(companies.id, company.id),
            eq(companies.organizationId, context.organizationId),
          ),
        )
        .returning();
      company = updated[0] ?? company;

      const existingCompanyPipeline = await tx
        .select({ id: pipeline.id })
        .from(pipeline)
        .where(
          and(
            eq(pipeline.organizationId, context.organizationId),
            eq(pipeline.companyId, company.id),
          ),
        )
        .limit(1);
      if (!existingCompanyPipeline[0]) {
        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          companyId: company.id,
          stage: "new",
        });
      }
    }

    const existingContacts = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, context.organizationId),
          eq(contacts.companyId, company.id),
        ),
      );
    const contactIds: string[] = [];

    for (const contactPayload of batch.contacts) {
      const existing = existingContacts.find((candidate) =>
        sameContact(candidate, contactPayload),
      );
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
          companyId: company.id,
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
      companyId: company.id,
      contactIds,
      primaryContact: batch.contacts[0] ?? null,
    };
  });
}

async function markEnrichmentFailed(
  context: LeadContext,
  companyId: string,
  domain: string,
): Promise<void> {
  await withLeadMutationContext(context, async (tx) => {
    await tx
      .update(companies)
      .set({ enrichmentStatus: "failed" })
      .where(
        and(
          eq(companies.id, companyId),
          eq(companies.organizationId, context.organizationId),
        ),
      );
    await tx.insert(auditLogs).values({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "enrichment_failed",
      entityType: "company",
      entityId: companyId,
      changes: { enrichmentStatus: "failed" },
      metadata: { source: "apollo-firecrawl-inngest", domain },
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
    idempotency: "event.data.organizationId + '-' + event.data.domain",
    triggers: [{ event: leadIngestRequested }],
  },
  async ({ event, step }) => {
    const context: LeadContext = {
      organizationId: event.data.organizationId,
      userId: event.data.actorUserId,
    };

    const apolloData = await step.run("fetch-apollo-data", async () =>
      ingestApolloLeads(event.data.domain, event.data.targetTitles),
    );

    const initialData = await step.run("save-initial-data", async () =>
      saveInitialData(apolloData, context),
    );

    try {
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
            ),
          )
          .returning({ id: companies.id });
        if (!updated[0]) throw new Error("Lead company was not found during enrichment save.");

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
      try {
        await step.run("mark-enrichment-failed", async () => {
          await markEnrichmentFailed(context, initialData.companyId, apolloData.domain);
        });
      } catch (failureError) {
        console.error("Unable to mark lead enrichment as failed", {
          errorName: failureError instanceof Error ? failureError.name : "UnknownError",
          companyId: initialData.companyId,
        });
      }
      throw error;
    }
  },
);
