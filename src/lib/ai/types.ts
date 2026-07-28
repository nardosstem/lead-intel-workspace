import type { z } from "zod";

export type AIRequestContext = Readonly<{
  organizationId: string;
  actorUserId?: string;
  traceId?: string;
  signal?: AbortSignal;
  /** Ask a provider with web-search capability to ground this request. */
  webSearch?: boolean;
  /** Prevent free-tier providers from receiving contact/private workspace data. */
  dataClassification?: "public" | "private";
}>;

export type AIUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
}>;

export type AIResult<T> = Readonly<{
  data: T;
  provider: string;
  model?: string;
  usage?: AIUsage;
}>;

export type EntityExtractionRequest<T> = Readonly<{
  text: string;
  schema: z.ZodType<T>;
  instructions?: string;
  context: AIRequestContext;
}>;

export type SummarizeTextRequest = Readonly<{
  text: string;
  audience?: string;
  maxWords?: number;
  context: AIRequestContext;
}>;

export type GenerateDraftRequest = Readonly<{
  purpose: string;
  sourceText?: string;
  instructions?: string;
  tone?: string;
  context: AIRequestContext;
}>;

export interface IAIProvider {
  readonly id: string;

  extractEntities<T>(
    request: EntityExtractionRequest<T>,
  ): Promise<AIResult<T>>;

  summarizeText(request: SummarizeTextRequest): Promise<AIResult<string>>;

  generateDraft(request: GenerateDraftRequest): Promise<AIResult<string>>;
}
