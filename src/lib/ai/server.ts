import "server-only";

import {
  AIProviderError,
  FallbackAIProvider,
  GeminiProvider,
  createAIProvider,
} from "@/lib/ai";
import type { ClaudeMCPTransport, IAIProvider, MCPToolCall } from "@/lib/ai";

const AI_REQUEST_TIMEOUT_MS = 30_000;
const MAX_AI_RESPONSE_BYTES = 2_000_000;

class HttpClaudeMCPTransport implements ClaudeMCPTransport {
  private readonly endpoint: string;
  private readonly authToken?: string;
  private readonly allowPrivateData: boolean;

  constructor(endpoint: string, authToken?: string, allowPrivateData = false) {
    const parsed = new URL(endpoint);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(localHost && parsed.protocol === "http:")) {
      throw new AIProviderError(
        "Claude MCP endpoint must use HTTPS unless it is local development.",
        "claude-mcp",
      );
    }
    this.endpoint = parsed.toString();
    this.authToken = authToken?.trim() || undefined;
    this.allowPrivateData = allowPrivateData;
  }

  async callTool<TArguments extends Record<string, unknown>>(
    call: MCPToolCall<TArguments>,
  ): Promise<unknown> {
    const requestContext = call.arguments.context;
    if (
      !this.allowPrivateData &&
      typeof requestContext === "object" &&
      requestContext !== null &&
      "dataClassification" in requestContext &&
      requestContext.dataClassification === "private"
    ) {
      throw new AIProviderError(
        "Claude MCP private-data processing is disabled. Set CLAUDE_MCP_ALLOW_PRIVATE_DATA=1 after reviewing the bridge policy.",
        "claude-mcp",
      );
    }
    const timeoutSignal = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    const signal = call.signal
      ? AbortSignal.any([call.signal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
      },
      body: JSON.stringify({ name: call.name, arguments: call.arguments }),
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new AIProviderError(
        `Claude MCP endpoint returned HTTP ${response.status}.`,
        "claude-mcp",
      );
    }

    const body = await response.text();
    if (body.length > MAX_AI_RESPONSE_BYTES) {
      throw new AIProviderError(
        "Claude MCP response exceeded the configured size limit.",
        "claude-mcp",
      );
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new AIProviderError(
        "Claude MCP returned an invalid JSON response.",
        "claude-mcp",
      );
    }
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
  if (globalForAI.leadIntelAIProvider) return globalForAI.leadIntelAIProvider;

  const claude = process.env.CLAUDE_MCP_ENDPOINT?.trim()
    ? createAIProvider({
        provider: "claude-mcp",
        transport: new HttpClaudeMCPTransport(
          process.env.CLAUDE_MCP_ENDPOINT,
          process.env.CLAUDE_MCP_AUTH_TOKEN,
          process.env.CLAUDE_MCP_ALLOW_PRIVATE_DATA === "1",
        ),
      })
    : undefined;
  const unconfigured = createAIProvider({
    provider: "claude-mcp",
    transport: new UnconfiguredClaudeMCPTransport(),
  });
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const gemini = geminiApiKey
    ? new GeminiProvider({
        apiKey: geminiApiKey,
        model: process.env.GEMINI_MODEL,
        searchEnabled: process.env.GEMINI_SEARCH_ENABLED !== "0",
        allowPrivateData: process.env.GEMINI_ALLOW_PRIVATE_DATA === "1",
      })
    : undefined;
  const preference = process.env.AI_PROVIDER?.trim().toLowerCase();
  const primary = preference === "claude" ? claude ?? unconfigured : gemini ?? claude ?? unconfigured;
  const fallback = preference === "claude" ? gemini : gemini ? claude : undefined;

  return (globalForAI.leadIntelAIProvider = new FallbackAIProvider(primary, fallback));
}
