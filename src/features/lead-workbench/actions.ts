"use server";

import { z } from "zod";

import { inngest, leadIngestRequested, newsScanRequested } from "@/inngest/client";
import { isPublicHostname } from "@/lib/domains";
import { normalizeDomain } from "@/lib/apollo";
import {
  isLeadIngestionEnabled,
  isNewsScanEnabled,
} from "@/lib/runtime-controls";

import { requireLeadContext } from "./server/context";
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
    const event = newsScanRequested.create({
      organizationId: context.organizationId,
      actorUserId: context.userId,
    });
    await event.validate();
    await inngest.send({ name: event.name, data: event.data });
    return { ok: true, data: { message: "News scan started in background" } };
  } catch (error) {
    return actionFailure(error);
  }
}
