import { describe, expect, it } from "vitest";

import type { IAIProvider } from "./types";
import { FallbackAIProvider } from "./fallback-provider";

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
});
