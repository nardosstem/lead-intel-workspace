import { serve } from "inngest/next";

import { assertInngestDeploymentConfiguration, inngest } from "@/inngest/client";
import type { NextRequest } from "next/server";
import { dispatchQueuedLeadIngestions, ingestLead } from "@/inngest/functions/ingest-lead";
import {
  scanNewsOrganizationScheduled,
  scanNewsRequested,
  scanNewsScheduled,
} from "@/inngest/functions/scan-news";

export const runtime = "nodejs";
// Vercel Hobby allows up to 60 seconds; keep the Inngest serve request alive
// long enough for bounded provider calls (Firecrawl is capped at 30 seconds).
export const maxDuration = 60;

const handlers = serve({
  client: inngest,
  functions: [ingestLead, dispatchQueuedLeadIngestions, scanNewsScheduled, scanNewsOrganizationScheduled, scanNewsRequested],
});

async function guarded(
  request: NextRequest,
  context: unknown,
  handler: (request: NextRequest, context: unknown) => Promise<Response>,
): Promise<Response> {
  try {
    assertInngestDeploymentConfiguration();
    return await handler(request, context);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Inngest is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = (request: NextRequest, context: unknown) => guarded(request, context, handlers.GET);
export const POST = (request: NextRequest, context: unknown) => guarded(request, context, handlers.POST);
export const PUT = (request: NextRequest, context: unknown) => guarded(request, context, handlers.PUT);
