import "server-only";

import { z } from "zod";

import { AIProviderError } from "@/lib/ai/errors";
import type { ClaudeMCPTransport } from "@/lib/ai/transport";
import type {
  AIResult,
  EntityExtractionRequest,
  GenerateDraftRequest,
  IAIProvider,
  SummarizeTextRequest,
} from "@/lib/ai/types";

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

const responseMetadataSchema = z.object({
  model: z.string().min(1).optional(),
  usage: usageSchema.optional(),
});

const textResponseSchema = responseMetadataSchema.extend({
  text: z.string().trim().min(1),
});

const entityResponseSchema = responseMetadataSchema.extend({
  entities: z.unknown(),
});

export type ClaudeMCPToolNames = Readonly<{
  extractEntities: string;
  summarizeText: string;
  generateDraft: string;
}>;

const defaultToolNames: ClaudeMCPToolNames = {
  extractEntities: "claude.extract_entities",
  summarizeText: "claude.summarize_text",
  generateDraft: "claude.generate_draft",
};

export class ClaudeMCPProvider implements IAIProvider {
  readonly id = "claude-mcp";

  constructor(
    private readonly transport: ClaudeMCPTransport,
    private readonly toolNames: ClaudeMCPToolNames = defaultToolNames,
  ) {}

  async extractEntities<T>(
    request: EntityExtractionRequest<T>,
  ): Promise<AIResult<T>> {
    try {
      const response = await this.transport.callTool({
        name: this.toolNames.extractEntities,
        arguments: {
          text: request.text,
          instructions: request.instructions,
          outputSchema: z.toJSONSchema(request.schema),
          context: this.toTransportContext(request.context),
        },
        signal: request.context.signal,
      });
      const envelope = entityResponseSchema.parse(response);

      return this.result(
        request.schema.parse(envelope.entities),
        envelope,
      );
    } catch (error) {
      throw this.wrapError("Entity extraction failed", error);
    }
  }

  async summarizeText(
    request: SummarizeTextRequest,
  ): Promise<AIResult<string>> {
    try {
      const response = await this.transport.callTool({
        name: this.toolNames.summarizeText,
        arguments: {
          text: request.text,
          audience: request.audience,
          maxWords: request.maxWords,
          context: this.toTransportContext(request.context),
        },
        signal: request.context.signal,
      });
      const envelope = textResponseSchema.parse(response);

      return this.result(envelope.text, envelope);
    } catch (error) {
      throw this.wrapError("Text summarization failed", error);
    }
  }

  async generateDraft(
    request: GenerateDraftRequest,
  ): Promise<AIResult<string>> {
    try {
      const response = await this.transport.callTool({
        name: this.toolNames.generateDraft,
        arguments: {
          purpose: request.purpose,
          sourceText: request.sourceText,
          instructions: request.instructions,
          tone: request.tone,
          context: this.toTransportContext(request.context),
        },
        signal: request.context.signal,
      });
      const envelope = textResponseSchema.parse(response);

      return this.result(envelope.text, envelope);
    } catch (error) {
      throw this.wrapError("Draft generation failed", error);
    }
  }

  private result<T>(
    data: T,
    metadata: z.infer<typeof responseMetadataSchema>,
  ): AIResult<T> {
    return {
      data,
      provider: this.id,
      model: metadata.model,
      usage: metadata.usage,
    };
  }

  private toTransportContext(
    context: EntityExtractionRequest<unknown>["context"],
  ) {
    return {
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      traceId: context.traceId,
      dataClassification: context.dataClassification,
      webSearch: context.webSearch,
    };
  }

  private wrapError(message: string, error: unknown): AIProviderError {
    if (error instanceof AIProviderError) {
      return error;
    }

    return new AIProviderError(message, this.id, error);
  }
}
