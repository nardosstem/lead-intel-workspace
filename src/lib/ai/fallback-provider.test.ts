import { describe, expect, it } from "vitest";

import type { IAIProvider } from "./types";
import { FallbackAIProvider } from "./fallback-provider";
import { AIProviderError } from "./errors";

function provider(id: string, shouldFail = false): IAIProvider {
  return {
    id,
    extractEntities: async <T>() => {
      if (shouldFail) throw new Error(`${id} unavailable`);
      return { provider: id, data: { ok: true } as T };
    },
    summarizeText: async () => ({ provider: id, data: "summary" }),
    generateDraft: async () => ({ provider: id, data: "draft" }),
  };
}

describe("FallbackAIProvider", () => {
  it("uses the primary provider and falls back after an error", async () => {
    const fallback = new FallbackAIProvider(provider("gemini", true), provider("claude"));
    const result = await fallback.extractEntities({
      text: "context",
      schema: {} as never,
      context: { organizationId: "org-1" },
    });

    expect(result.provider).toBe("claude");
    expect(fallback.id).toBe("gemini->claude");
  });

  it("uses the fallback when no primary is configured", async () => {
    const fallback = new FallbackAIProvider(undefined, provider("claude"));
    await expect(
      fallback.generateDraft({ purpose: "draft", context: { organizationId: "org-1" } }),
    ).resolves.toMatchObject({ provider: "claude", data: "draft" });
  });

  it("does not hide non-retryable provider contract failures", async () => {
    const primary: IAIProvider = {
      ...provider("gemini"),
      extractEntities: async () => {
        throw new AIProviderError("Gemini returned invalid JSON.", "gemini");
      },
    };
    const fallback = new FallbackAIProvider(primary, provider("claude"));
    await expect(fallback.extractEntities({ text: "x", schema: {} as never, context: { organizationId: "org-1" } }))
      .rejects.toThrow(/invalid JSON/i);
  });

  it("routes a free-tier private-data refusal to the approved fallback", async () => {
    const primary: IAIProvider = {
      ...provider("gemini"),
      generateDraft: async () => {
        throw new AIProviderError("Gemini free-tier data policy does not allow private workspace data.", "gemini");
      },
    };
    const fallback = new FallbackAIProvider(primary, provider("claude"));
    await expect(fallback.generateDraft({ purpose: "private draft", context: { organizationId: "org-1", dataClassification: "private" } }))
      .resolves.toMatchObject({ provider: "claude", data: "draft" });
  });
});
