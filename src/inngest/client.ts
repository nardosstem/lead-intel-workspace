import { eventType, Inngest } from "inngest";
import { z } from "zod";

import { isPublicHostname } from "@/lib/domains";

export const leadIngestRequestedDataSchema = z.object({
  domain: z.string().trim().toLowerCase().refine(isPublicHostname, "Invalid company domain."),
  targetTitles: z.array(z.string().min(1).max(120)).min(1).max(10),
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  runId: z.uuid(),
  /** UTC usage bucket reserved by the foreground request. */
  usageDate: z.iso.date(),
});

export type LeadIngestRequestedData = z.infer<
  typeof leadIngestRequestedDataSchema
>;

export const leadIngestRequested = eventType("lead.ingest.requested", {
  schema: leadIngestRequestedDataSchema,
});

/** Manually requests an immediate scan for one tenant's enabled targets. */
export const newsScanRequestedDataSchema = z.object({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  /** Stable across Inngest retries, unique for each user-requested scan. */
  runId: z.uuid(),
  /** UTC usage bucket reserved by the foreground request. */
  usageDate: z.iso.date(),
  force: z.boolean().optional(),
});

export type NewsScanRequestedData = z.infer<typeof newsScanRequestedDataSchema>;

export const newsScanRequested = eventType("lead.news.scan.requested", {
  schema: newsScanRequestedDataSchema,
});

export const scheduledNewsScanRequestedDataSchema = z.object({
  organizationId: z.uuid(),
  runId: z.string().min(1).max(200),
  usageDate: z.iso.date(),
});

export const scheduledNewsScanRequested = eventType("lead.news.scheduled.scan.requested", {
  schema: scheduledNewsScanRequestedDataSchema,
});

/**
 * Local Inngest development is opt-in, but it must never be enabled by an
 * accidentally copied production environment variable. In cloud mode the SDK
 * requires signed requests from Inngest.
 */
export function isLocalInngestDevelopment(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.INNGEST_DEV === "1";
}

export function assertInngestDeploymentConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.INNGEST_DEV?.trim()) {
    throw new Error("INNGEST_DEV must be unset in production.");
  }
  if (!process.env.INNGEST_EVENT_KEY?.trim() || !process.env.INNGEST_SIGNING_KEY?.trim()) {
    throw new Error("INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are required in production.");
  }
}

export const inngest = new Inngest({
  id: "lead-workbench",
  isDev: isLocalInngestDevelopment(),
});
