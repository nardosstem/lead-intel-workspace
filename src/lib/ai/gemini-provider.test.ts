import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIProviderError } from "./errors";
import { GeminiProvider, type GeminiGenerateContent } from "./gemini-provider";

const context = { organizationId: "org-1", actorUserId: "user-1" } as const;

function response(text: string, modelVersion = "gemini-test", extra: Record<string, unknown> = {}) {
  return {
    text,
    modelVersion,
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
    ...extra,
  } as never;
}

describe("GeminiProvider", () => {
  it("validates structured output and forwards a Gemini JSON schema", async () => {
    let request: Parameters<GeminiGenerateContent>[0] | undefined;
    const client: GeminiGenerateContent = vi.fn(async (parameters) => {
      request = parameters;
      return response('{"score":87}');
    });
    const provider = new GeminiProvider({ apiKey: "gemini-key", client });

    const result = await provider.extractEntities({
      text: "Company context",
      schema: z.object({ score: z.number().min(0).max(100) }),
      instructions: "Return the score.",
      context,
    });

    expect(result).toMatchObject({
      data: { score: 87 },
      provider: "gemini",
      model: "gemini-test",
      usage: { inputTokens: 12, outputTokens: 8 },
    });
    expect(request?.config).toMatchObject({
      responseMimeType: "application/json",
      temperature: 0.1,
    });
    expect(request?.model).toBe("gemini-3.6-flash");
    expect(request?.config?.responseJsonSchema).toMatchObject({
      type: "object",
      properties: { score: { type: "number", minimum: 0, maximum: 100 } },
    });
  });

  it("uses a separate search pass for public research", async () => {
    const calls: Parameters<GeminiGenerateContent>[0][] = [];
    const client: GeminiGenerateContent = vi.fn(async (parameters) => {
      calls.push(parameters);
      return calls.length === 1
        ? response("Grounded public research from current sources.", "gemini-test", {
            candidates: [{ groundingMetadata: {
              webSearchQueries: ["Acme recent news"],
              groundingChunks: [{ web: { uri: "https://news.example.com/acme", title: "Acme news" } }],
            } }],
          })
        : response('{"summary":"Grounded summary"}');
    });
    const provider = new GeminiProvider({
      apiKey: "gemini-key",
      searchEnabled: true,
      client,
    });

    const result = await provider.extractEntities({
      text: "Research Acme",
      schema: z.object({ summary: z.string() }),
      instructions: "Return a summary.",
      context: { ...context, webSearch: true, dataClassification: "public" },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(calls[1]?.config?.tools).toBeUndefined();
    expect(calls[1]?.contents).toContain("Grounded public research");
    expect(result.sources).toEqual([{ uri: "https://news.example.com/acme", title: "Acme news" }]);
    expect(result.searchQueries).toEqual(["Acme recent news"]);
  });

  it("redacts common personal identifiers from public free-tier prompts", async () => {
    let request: Parameters<GeminiGenerateContent>[0] | undefined;
    const client: GeminiGenerateContent = vi.fn(async (parameters) => {
      request = parameters;
      return response('{"summary":"ok"}');
    });
    const provider = new GeminiProvider({ apiKey: "gemini-key", client });

    await provider.extractEntities({
      text: "Public article contact alex@example.com, +1 (212) 555-0199, https://linkedin.com/in/alex.",
      schema: z.object({ summary: z.string() }),
      context: { ...context, dataClassification: "public" },
    });

    expect(request?.contents).not.toContain("alex@example.com");
    expect(request?.contents).not.toContain("555-0199");
    expect(request?.contents).toContain("[email redacted]");
  });

  it("does not send private data through the free-tier provider by default", async () => {
    const client: GeminiGenerateContent = vi.fn();
    const provider = new GeminiProvider({ apiKey: "gemini-key", client });

    await expect(
      provider.generateDraft({
        purpose: "Draft outreach",
        sourceText: "A contact note",
        context: { ...context, dataClassification: "private" },
      }),
    ).rejects.toMatchObject({
      provider: "gemini",
      message: expect.stringMatching(/private workspace data/i),
    } satisfies Partial<AIProviderError>);
    expect(client).not.toHaveBeenCalled();
  });

  it("maps provider HTTP status into a retry-aware error", async () => {
    const client: GeminiGenerateContent = vi.fn(async () => {
      throw Object.assign(new Error("rate limited"), { status: 429 });
    });
    const provider = new GeminiProvider({ apiKey: "gemini-key", client });

    await expect(
      provider.summarizeText({ text: "context", context }),
    ).rejects.toMatchObject({
      provider: "gemini",
      message: "Gemini API request failed (HTTP 429).",
    });
  });
});
