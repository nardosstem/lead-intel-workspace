import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { ingestLead } from "@/inngest/functions/ingest-lead";
import { scanNewsRequested, scanNewsScheduled } from "@/inngest/functions/scan-news";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestLead, scanNewsScheduled, scanNewsRequested],
});
