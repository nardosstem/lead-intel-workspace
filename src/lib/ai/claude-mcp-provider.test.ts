import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AIProviderError } from "./errors";
import { ClaudeMCPProvider } from "./claude-mcp-provider";
import type { ClaudeMCPTransport } from "./transport";

const context = { organizationId: "org-1", actorUserId: "user-1" };

describe("ClaudeMCPProvider", () => {
  it("validates structured entities and forwards trace context", async () => {
    const calls: string[] = [];
    const transport: ClaudeMCPTransport = {
      callTool: async (call) => {
        calls.push(JSON.stringify(call));
        return { entities: { score: 87 }, model: "claude-test" };
      },
    };
    const provider = new ClaudeMCPProvider(transport);

    const result = await provider.extractEntities({
      text: "Company context",
      schema: z.object({ score: z.number().min(0).max(100) }),
      context: { ...context, traceId: "trace-1" },
    });

    expect(result.data).toEqual({ score: 87 });
    expect(result.model).toBe("claude-test");
    expect(calls[0]).toContain('"traceId":"trace-1"');
  });

  it("wraps malformed provider envelopes as safe provider errors", async () => {
    const provider = new ClaudeMCPProvider({
      callTool: async () => ({ text: 42 }),
    });

    await expect(
      provider.summarizeText({ text: "context", context }),
    ).rejects.toBeInstanceOf(AIProviderError);

    const emptyProvider = new ClaudeMCPProvider({
      callTool: async () => ({ text: "   " }),
    });
    await expect(
      emptyProvider.summarizeText({ text: "context", context }),
    ).rejects.toBeInstanceOf(AIProviderError);
  });
});
