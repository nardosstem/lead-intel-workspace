import "server-only";

import { AIProviderError, createAIProvider } from "@/lib/ai";
import type { ClaudeMCPTransport, IAIProvider, MCPToolCall } from "@/lib/ai";

class HttpClaudeMCPTransport implements ClaudeMCPTransport {
  constructor(private readonly endpoint: string) {}

  async callTool<TArguments extends Record<string, unknown>>(
    call: MCPToolCall<TArguments>,
  ): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: call.name, arguments: call.arguments }),
      signal: call.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new AIProviderError(
        `Claude MCP endpoint returned HTTP ${response.status}.`,
        "claude-mcp",
      );
    }

    return response.json();
  }
}

class UnconfiguredClaudeMCPTransport implements ClaudeMCPTransport {
  async callTool(): Promise<unknown> {
    throw new AIProviderError(
      "Claude MCP is not configured. Set CLAUDE_MCP_ENDPOINT before using AI actions.",
      "claude-mcp",
    );
  }
}

const globalForAI = globalThis as typeof globalThis & {
  leadIntelAIProvider?: IAIProvider;
};

export function getAIProvider(): IAIProvider {
  return (globalForAI.leadIntelAIProvider ??= createAIProvider({
    provider: "claude-mcp",
    transport: process.env.CLAUDE_MCP_ENDPOINT
      ? new HttpClaudeMCPTransport(process.env.CLAUDE_MCP_ENDPOINT)
      : new UnconfiguredClaudeMCPTransport(),
  }));
}
