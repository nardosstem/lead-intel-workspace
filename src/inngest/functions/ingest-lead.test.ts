import { describe, expect, it } from "vitest";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { ApolloApiError, ApolloConfigurationError } from "@/lib/apollo";
import { AIProviderError } from "@/lib/ai";

import {
  aiEnrichmentSchema,
  automaticEnrichmentDataClassification,
  MAX_DISPATCH_ATTEMPTS,
  ingestLead,
  dispatchQueuedLeadIngestions,
  publicEnrichmentInput,
  safeEnrichmentError,
  toFirecrawlWorkflowError,
  toWorkflowError,
} from "./ingest-lead";

describe("lead ingestion workflow error policy", () => {
  it("bounds interrupted outbox delivery attempts", () => {
    expect(MAX_DISPATCH_ATTEMPTS).toBe(5);
  });
  it("registers a bounded queued-request dispatcher", () => {
    expect(dispatchQueuedLeadIngestions.opts.concurrency).toEqual({ limit: 1, scope: "fn" });
    expect(dispatchQueuedLeadIngestions.opts.triggers).toHaveLength(1);
  });
  it("serializes tenant/domain duplicates and caps provider pressure", () => {
    expect(ingestLead.opts.concurrency).toEqual([
      {
        limit: 1,
        key: "event.data.organizationId + '-' + event.data.domain",
        scope: "fn",
      },
      {
        limit: 5,
        scope: "fn",
      },
    ]);
  });

  it("stops retries for Apollo configuration and non-rate-limit client errors", () => {
    expect(toWorkflowError(new ApolloConfigurationError())).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new ApolloApiError("forbidden", 403))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new AIProviderError("Claude MCP is not configured.", "claude-mcp"))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new AIProviderError("Gemini API request failed (HTTP 400).", "gemini"))).toBeInstanceOf(NonRetriableError);
    expect(toWorkflowError(new AIProviderError("Gemini free-tier data policy does not allow private workspace data.", "gemini"))).toBeInstanceOf(NonRetriableError);
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

  it("treats Firecrawl provider rejection as terminal but target rejection as non-fatal", () => {
    expect(toFirecrawlWorkflowError({ sourceUrl: "https://example.com", markdown: "", truncated: false, failure: "provider" })).toBeInstanceOf(NonRetriableError);
    expect(toFirecrawlWorkflowError({ sourceUrl: "https://example.com", markdown: "", truncated: false, failure: "target" })).toBeNull();
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

  it("keeps automatic enrichment provider input at the company/public-website level", () => {
    const input = publicEnrichmentInput(
      {
        name: "Acme",
        website: "https://acme.com",
        industry: "Software",
        size: "50",
        location: "New York, NY",
      },
      {
        sourceUrl: "https://acme.com",
        markdown: "# Acme\nWe automate operations.",
        truncated: false,
      },
    );

    expect(input).toContain("Acme");
    expect(input).toContain("We automate operations.");
    expect(input).not.toContain("Primary contact");
    expect(input).not.toContain("@example.com");
    expect(automaticEnrichmentDataClassification).toBe("public");
  });
});
