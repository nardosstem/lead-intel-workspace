import { describe, expect, it } from "vitest";
import { NonRetriableError } from "inngest";

import { ApolloApiError, ApolloConfigurationError } from "@/lib/apollo";
import { AIProviderError } from "@/lib/ai";

import { safeEnrichmentError, toWorkflowError } from "./ingest-lead";

describe("lead ingestion workflow error policy", () => {
  it("stops retries for Apollo configuration and non-rate-limit client errors", () => {
    expect(toWorkflowError(new ApolloConfigurationError())).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new ApolloApiError("forbidden", 403))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new AIProviderError("Claude MCP is not configured.", "claude-mcp"))).toBeInstanceOf(NonRetriableError);
  });

  it("keeps rate limits and server failures retryable", () => {
    expect(toWorkflowError(new ApolloApiError("rate limited", 429))).toBeInstanceOf(ApolloApiError);
    expect(toWorkflowError(new ApolloApiError("server error", 503))).toBeInstanceOf(ApolloApiError);
    expect(toWorkflowError(new AIProviderError("Claude MCP request timed out.", "claude-mcp"))).toBeInstanceOf(AIProviderError);
  });

  it("stores only safe error categories", () => {
    const error = new ApolloApiError("provider response included secret data", 403);
    expect(safeEnrichmentError(error)).toBe("ApolloApiError (HTTP 403)");
  });
});
