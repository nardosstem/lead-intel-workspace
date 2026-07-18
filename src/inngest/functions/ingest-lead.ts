import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { inngest, leadIngestRequested } from "@/inngest/client";
import {
  ingestApolloLeads,
  normalizeDomain,
  type ApolloContactPayload,
  type ApolloLeadBatch,
} from "@/lib/apollo";
import { getAIProvider } from "@/lib/ai/server";
import { auditLogs, companies, contacts, pipeline } from "@/lib/db";
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
    const organizationCompanies = await tx
      .select()
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId));
    let company = organizationCompanies.find(
      (candidate) =>
        candidate.website && normalizeDomain(candidate.website) === batch.domain,
    );

    if (!company) {
      const inserted = await tx
        .insert(companies)
        .values({
          organizationId: context.organizationId,
          name: batch.company.name,
          website: batch.company.website,
          industry: batch.company.industry,
          size: batch.company.size,
          location: batch.company.location,
          status: "prospect",
          enrichmentStatus: "processing",
        })
        .returning();
      company = inserted[0];
      if (!company) throw new Error("Apollo company insert returned no row.");

      await tx.insert(pipeline).values({
        organizationId: context.organizationId,
        companyId: company.id,
        stage: "new",
      });
    } else {
      const updated = await tx
        .update(companies)
        .set({ enrichmentStatus: "processing" })
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
        contactIds.push(existing.id);
        continue;
      }

      const inserted = await tx
        .insert(contacts)
        .values({
          organizationId: context.organizationId,
          companyId: company.id,
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

      await tx.insert(pipeline).values({
        organizationId: context.organizationId,
        contactId: contact.id,
        stage: "new",
      });
    }

    return {
      companyId: company.id,
      contactIds,
      primaryContact: batch.contacts[0] ?? null,
    };
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
            traceId: `lead-ingest:${event.data.domain}`,
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
  },
);
