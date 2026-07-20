import { eventType, Inngest } from "inngest";
import { z } from "zod";

import { isPublicHostname } from "@/lib/domains";

export const leadIngestRequestedDataSchema = z.object({
  domain: z.string().trim().toLowerCase().refine(isPublicHostname, "Invalid company domain."),
  targetTitles: z.array(z.string().min(1).max(120)).min(1).max(10),
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  runId: z.uuid(),
});

export type LeadIngestRequestedData = z.infer<
  typeof leadIngestRequestedDataSchema
>;

export const leadIngestRequested = eventType("lead.ingest.requested", {
  schema: leadIngestRequestedDataSchema,
});

export const inngest = new Inngest({ id: "lead-workbench" });
