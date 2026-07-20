import { describe, expect, it } from "vitest";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { ApolloApiError, ApolloConfigurationError } from "@/lib/apollo";
import { AIProviderError } from "@/lib/ai";

import { aiEnrichmentSchema, safeEnrichmentError, toWorkflowError } from "./ingest-lead";

describe("lead ingestion workflow error policy", () => {
  it("stops retries for Apollo configuration and non-rate-limit client errors", () => {
    expect(toWorkflowError(new ApolloConfigurationError())).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new ApolloApiError("forbidden", 403))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new AIProviderError("Claude MCP is not configured.", "claude-mcp"))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new z.ZodError([]))).toBeInstanceOf(NonRetriableError);
  });

  it("keeps rate limits and server failures retryable", () => {
    expect(toWorkflowError(new ApolloApiError("rate limited", 429))).toBeInstanceOf(ApolloApiError);
    expect(toWorkflowError(new ApolloApiError("server error", 503))).toBeInstanceOf(ApolloApiError);
    expect(toWorkflowError(new AIProviderError("Claude MCP endpoint returned HTTP 429.", "claude-mcp"))).toBeInstanceOf(AIProviderError);
    expect(toWorkflowError(new AIProviderError("Claude MCP request timed out.", "claude-mcp"))).toBeInstanceOf(AIProviderError);
  });

  it("stops retries for other Claude MCP client errors", () => {
    expect(toWorkflowError(new AIProviderError("Claude MCP endpoint returned HTTP 403.", "claude-mcp"))).toBeInstanceOf(NonRetriableError);
  });

  it("stores only safe error categories", () => {
    const error = new ApolloApiError("provider response included secret data", 403);
    expect(safeEnrichmentError(error)).toBe("ApolloApiError (HTTP 403)");
  });

  it("bounds AI enrichment pain points before persistence", () => {
    const valid = {
      icpScore: 84,
      painPoints: ["a", "b", "c"],
      outreachDraft: "Subject: A useful idea\\n\\nHello there",
    };

    expect(aiEnrichmentSchema.parse(valid)).toEqual(valid);
    expect(() =>
      aiEnrichmentSchema.parse({
        ...valid,
        painPoints: ["x".repeat(501), "b", "c"],
      }),
    ).toThrow(/maximum/i);
  });
});
