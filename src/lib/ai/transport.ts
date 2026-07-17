export type MCPToolCall<TArguments extends Record<string, unknown>> = Readonly<{
  name: string;
  arguments: TArguments;
  signal?: AbortSignal;
}>;

/**
 * Narrow integration seam for the application's MCP client. The concrete MCP
 * SDK or connector is composed at the application boundary, not in features.
 */
export interface ClaudeMCPTransport {
  callTool<TArguments extends Record<string, unknown>>(
    call: MCPToolCall<TArguments>,
  ): Promise<unknown>;
}
