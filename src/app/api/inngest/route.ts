import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { ingestLead } from "@/inngest/functions/ingest-lead";
import { scanNewsRequested, scanNewsScheduled } from "@/inngest/functions/scan-news";

export const runtime = "nodejs";
// Vercel Hobby allows up to 60 seconds; keep the Inngest serve request alive
// long enough for bounded provider calls (Firecrawl is capped at 30 seconds).
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestLead, scanNewsScheduled, scanNewsRequested],
});
