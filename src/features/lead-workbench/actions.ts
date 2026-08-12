"use server";

import { and, count, eq } from "drizzle-orm";
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
import { getDatabase, monitoringTargets } from "@/lib/db";
import {
  OrganizationUsageLimitError,
  releaseOrganizationUsage,
  reserveOrganizationUsage,
} from "@/lib/db/usage";
import type { ActionResult } from "./types";

const domainInputSchema = z.string().trim().min(1, "Enter a company domain.").max(253);

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
    return { ok: false, error: "The workspace news-scan daily limit has been reached. Try again tomorrow." };
  }

  console.error("Lead ingestion action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
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
    const event = leadIngestRequested.create({
      domain: normalizedDomain,
      targetTitles: ["CEO", "Founder", "VP", "Director"],
      organizationId: context.organizationId,
      actorUserId: context.userId,
      runId: crypto.randomUUID(),
    });
    await event.validate();
    await inngest.send({ name: event.name, data: event.data });
    return { ok: true, data: { message: "Ingestion started in background" } };
  } catch (error) {
    return actionFailure(error);
  }
}

/** Queues an immediate scan of all enabled monitoring targets in this workspace. */
export async function triggerNewsScan(): Promise<ActionResult<{ message: string }>> {
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
    await withLeadMutationContext(context, async (tx) => {
      await reserveOrganizationUsage(tx, {
        organizationId: context.organizationId,
        kind: "news_scan",
        reservationKey: runId,
      });
    });
    try {
      const event = newsScanRequested.create({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        runId,
        force: true,
      });
      await event.validate();
      await inngest.send({ name: event.name, data: event.data });
    } catch (error) {
      await withLeadMutationContext(context, async (tx) => {
        await releaseOrganizationUsage(tx, {
          organizationId: context.organizationId,
          kind: "news_scan",
          reservationKey: runId,
        });
      });
      throw error;
    }
    return { ok: true, data: { message: "News scan started in background" } };
  } catch (error) {
    return actionFailure(error);
  }
}
