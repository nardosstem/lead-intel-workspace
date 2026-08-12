"use server";

import { and, count, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { inngest, leadIngestRequested, newsScanRequested } from "@/inngest/client";
import { isPublicHostname } from "@/lib/domains";
import { normalizeDomain } from "@/lib/apollo";
import {
  isLeadIngestionEnabled,
  isNewsScanEnabled,
} from "@/lib/runtime-controls";

import { requireLeadContext } from "./server/context";
import { withLeadMutationContext } from "./server/context";
import { auditLogs, companies, getDatabase, ingestionRuns, monitoringTargets, organizations, pipeline, signalScans } from "@/lib/db";
import {
  OrganizationUsageLimitError,
  reserveOrganizationUsage,
  usageDateKey,
} from "@/lib/db/usage";
import type { ActionResult } from "./types";

const domainInputSchema = z.string().trim().min(1, "Enter a company domain.").max(253);
const STALE_INGESTION_MS = 30 * 60 * 1_000;

function actionFailure(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Enter a valid domain." };
  }

  if (
    error instanceof Error &&
    (error.name === "AuthenticationRequiredError" || /organization profile/i.test(error.message))
  ) {
    return { ok: false, error: "Sign in with an organization account to ingest leads." };
  }

  if (error instanceof Error && /event key|INNGEST_EVENT_KEY/i.test(error.message)) {
    return { ok: false, error: "Inngest is not configured. Set INNGEST_EVENT_KEY first." };
  }

  if (error instanceof OrganizationUsageLimitError) {
    const label = error.kind === "domain_ingestion" ? "lead-ingestion" : error.kind;
    return { ok: false, error: `The workspace ${label.replaceAll("_", " ")} daily limit has been reached. Try again tomorrow.` };
  }

  if (error instanceof Error && error.name === "LeadIngestionAlreadyRunningError") {
    return { ok: false, error: "This domain is already being ingested. Watch the company row for progress." };
  }

  if (error instanceof Error && error.name === "LeadAlreadyEnrichedError") {
    return { ok: false, error: "This domain is already enriched in the workspace. Retry only after a failed run." };
  }

  if (error instanceof Error && error.name === "PasswordSetupRequiredError") {
    return { ok: false, error: "Set your password before accessing the workspace." };
  }

  console.error("Lead ingestion action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
  return { ok: false, error: "Lead ingestion could not be started." };
}

export async function triggerDomainIngestion(
  domain: string,
): Promise<ActionResult<{ message: string }>> {
  const parsed = domainInputSchema.safeParse(domain);
  if (!parsed.success) {
    return actionFailure(parsed.error);
  }

  const normalizedDomain = normalizeDomain(parsed.data);
  if (!isPublicHostname(normalizedDomain)) {
    return { ok: false, error: "Enter a valid domain such as stripe.com." };
  }
  if (!isLeadIngestionEnabled()) {
    return { ok: false, error: "Lead ingestion is temporarily disabled by workspace configuration." };
  }

  try {
    const context = await requireLeadContext();
    const runId = crypto.randomUUID();
    const usageDate = usageDateKey();
    await withLeadMutationContext(context, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ingestion:${context.organizationId}:${normalizedDomain}`}, 0))`,
      );
      const existing = await tx
        .select({ id: companies.id, enrichmentStatus: companies.enrichmentStatus, updatedAt: companies.updatedAt })
        .from(companies)
        .where(and(
          eq(companies.organizationId, context.organizationId),
          or(
            eq(companies.domain, normalizedDomain),
            eq(companies.website, `https://${normalizedDomain}`),
            eq(companies.website, `http://${normalizedDomain}`),
            eq(companies.website, `https://www.${normalizedDomain}`),
            eq(companies.website, `http://www.${normalizedDomain}`),
          ),
        ))
        .limit(1);
      if (existing[0]?.enrichmentStatus === "processing" && (!existing[0].updatedAt || Date.now() - existing[0].updatedAt.getTime() < STALE_INGESTION_MS)) {
        const error = new Error("This domain is already being ingested.");
        error.name = "LeadIngestionAlreadyRunningError";
        throw error;
      }
      if (existing[0]?.enrichmentStatus === "complete") {
        const error = new Error("This domain is already enriched.");
        error.name = "LeadAlreadyEnrichedError";
        throw error;
      }
      await reserveOrganizationUsage(tx, {
        organizationId: context.organizationId,
        kind: "domain_ingestion",
        reservationKey: runId,
        usageDate,
      });
      await tx.insert(ingestionRuns).values({
        id: runId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        domain: normalizedDomain,
        targetTitles: ["CEO", "Founder", "VP", "Director"],
        usageDate,
        status: "queued",
      });
      const defaults = (await tx
        .select({ defaultStage: organizations.defaultPipelineStage, followUpDays: organizations.defaultFollowUpDays })
        .from(organizations)
        .where(eq(organizations.id, context.organizationId))
        .limit(1))[0];
      const companyId = existing[0]?.id ?? (await tx.insert(companies).values({
        organizationId: context.organizationId,
        domain: normalizedDomain,
        name: normalizedDomain,
        website: `https://${normalizedDomain}`,
        status: "prospect",
        enrichmentStatus: "processing",
        enrichmentRunId: runId,
      }).returning({ id: companies.id }))[0]?.id;
      if (!companyId) throw new Error("Unable to initialize the ingestion company.");
      await tx.update(companies).set({
        enrichmentStatus: "processing",
        enrichmentRunId: runId,
        enrichmentError: null,
        enrichmentErrorAt: null,
      }).where(and(eq(companies.id, companyId), eq(companies.organizationId, context.organizationId)));
      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "ingestion_queued",
        entityType: "company",
        entityId: companyId,
        changes: { enrichmentStatus: "processing", runId, queueState: "submitted" },
        metadata: { source: "lead-ingestion-action", domain: normalizedDomain },
      });
      await tx.insert(pipeline).values({
        organizationId: context.organizationId,
        companyId,
        stage: defaults?.defaultStage ?? "new",
        nextFollowUpAt: new Date(Date.now() + (defaults?.followUpDays ?? 7) * 24 * 60 * 60 * 1000),
      }).onConflictDoNothing({ target: pipeline.companyId });

    });
    try {
      const event = leadIngestRequested.create({
        domain: normalizedDomain,
        targetTitles: ["CEO", "Founder", "VP", "Director"],
        organizationId: context.organizationId,
        actorUserId: context.userId,
        runId,
        usageDate,
      });
      await event.validate();
      await inngest.send({ name: event.name, data: event.data });
      await withLeadMutationContext(context, async (tx) => {
        await tx.update(ingestionRuns).set({ status: "dispatched", lastAttemptAt: new Date() })
          // The Inngest handler can start before this HTTP request receives
          // the send response. Never overwrite its processing/complete state.
          .where(and(
            eq(ingestionRuns.id, runId),
            eq(ingestionRuns.organizationId, context.organizationId),
            eq(ingestionRuns.status, "queued"),
          ));
      });
    } catch (error) {
      await withLeadMutationContext(context, async (tx) => {
        await tx.update(ingestionRuns).set({ status: "queued", nextAttemptAt: new Date(), lastError: "Delivery will be retried." })
          // A provider may accept an event and still make the HTTP send call
          // fail. Preserve a worker's processing/complete state in that
          // ambiguous window; only untouched outbox rows may be requeued.
          .where(and(
            eq(ingestionRuns.id, runId),
            eq(ingestionRuns.organizationId, context.organizationId),
            or(eq(ingestionRuns.status, "queued"), eq(ingestionRuns.status, "dispatched")),
          ));
      });
      console.warn("Lead ingestion delivery deferred for retry", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        runId,
      });
      return { ok: true, data: { message: "Ingestion queued; background delivery will retry." } };
    }
    return { ok: true, data: { message: "Ingestion started in background" } };
  } catch (error) {
    return actionFailure(error);
  }
}

/** Queues an immediate scan of all enabled monitoring targets in this workspace. */
export async function triggerNewsScan(): Promise<ActionResult<{ message: string; runId: string }>> {
  if (!isNewsScanEnabled()) {
    return { ok: false, error: "News scanning is disabled. Set NEWS_SCAN_ENABLED=1 to enable it." };
  }

  try {
    const context = await requireLeadContext();
    const monitoredTargets = await getDatabase()
      .select({ value: count() })
      .from(monitoringTargets)
      .where(and(
        eq(monitoringTargets.organizationId, context.organizationId),
        eq(monitoringTargets.enabled, true),
      ));
    if (Number(monitoredTargets[0]?.value ?? 0) === 0) {
      return { ok: false, error: "Monitor at least one company before scanning news." };
    }
    const runId = crypto.randomUUID();
    const usageDate = usageDateKey();
    await withLeadMutationContext(context, async (tx) => {
      await reserveOrganizationUsage(tx, {
        organizationId: context.organizationId,
        kind: "news_scan",
        reservationKey: runId,
        usageDate,
      });
      await tx.insert(signalScans).values({
        organizationId: context.organizationId,
        runId,
        status: "pending",
      }).onConflictDoNothing({ target: [signalScans.organizationId, signalScans.runId] });

    });
    try {
      const event = newsScanRequested.create({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        runId,
        force: true,
        usageDate,
      });
      await event.validate();
      await inngest.send({ name: event.name, data: event.data });
    } catch (error) {
      await withLeadMutationContext(context, async (tx) => {
        await tx.update(signalScans).set({
          status: "failed",
          completedAt: new Date(),
          error: "News scan could not be queued.",
        }).where(and(
          eq(signalScans.organizationId, context.organizationId),
          eq(signalScans.runId, runId),
        ));
      });
      throw error;
    }
    return { ok: true, data: { message: "News scan started in background", runId } };
  } catch (error) {
    return actionFailure(error);
  }
}
