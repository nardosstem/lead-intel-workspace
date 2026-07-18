import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { ingestLead } from "@/inngest/functions/ingest-lead";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ingestLead],
});
