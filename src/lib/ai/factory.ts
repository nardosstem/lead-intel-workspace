import "server-only";

import { ClaudeMCPProvider, type ClaudeMCPToolNames } from "./claude-mcp-provider";
import type { ClaudeMCPTransport } from "./transport";
import type { IAIProvider } from "./types";

export type AIProviderConfig = Readonly<{
  provider: "claude-mcp";
  transport: ClaudeMCPTransport;
  toolNames?: ClaudeMCPToolNames;
}>;

/** Composition root for AI adapters. Feature code accepts `IAIProvider`. */
export function createAIProvider(config: AIProviderConfig): IAIProvider {
  switch (config.provider) {
    case "claude-mcp":
      return new ClaudeMCPProvider(config.transport, config.toolNames);
    default: {
      const unreachable: never = config.provider;
      throw new Error(`Unsupported AI provider: ${unreachable}`);
    }
  }
}
