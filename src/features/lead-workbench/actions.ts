"use server";

import { z } from "zod";

import { inngest, leadIngestRequested } from "@/inngest/client";
import { normalizeDomain } from "@/lib/apollo";

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

  console.error(error);
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
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(normalizedDomain)) {
    return { ok: false, error: "Enter a valid domain such as stripe.com." };
  }

  try {
    const context = await requireLeadContext();
    const event = leadIngestRequested.create({
      domain: normalizedDomain,
      targetTitles: ["CEO", "Founder", "VP", "Director"],
      organizationId: context.organizationId,
      actorUserId: context.userId,
    });
    await event.validate();
    await inngest.send({ name: event.name, data: event.data });
    return { ok: true, data: { message: "Ingestion started in background" } };
  } catch (error) {
    return actionFailure(error);
  }
}
