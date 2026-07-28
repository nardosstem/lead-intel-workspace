import "server-only";

import type {
  AIResult,
  EntityExtractionRequest,
  GenerateDraftRequest,
  IAIProvider,
  SummarizeTextRequest,
} from "./types";

/** Runs a configured primary provider first and falls back on provider failure. */
export class FallbackAIProvider implements IAIProvider {
  readonly id: string;

  constructor(
    private readonly primary: IAIProvider | undefined,
    private readonly fallback: IAIProvider | undefined,
  ) {
    this.id = [primary?.id, fallback?.id].filter(Boolean).join("->") || "unconfigured";
  }

  async extractEntities<T>(
    request: EntityExtractionRequest<T>,
  ): Promise<AIResult<T>> {
    return this.run(this.primary, this.fallback, (provider) => provider.extractEntities(request));
  }

  async summarizeText(
    request: SummarizeTextRequest,
  ): Promise<AIResult<string>> {
    return this.run(this.primary, this.fallback, (provider) => provider.summarizeText(request));
  }

  async generateDraft(
    request: GenerateDraftRequest,
  ): Promise<AIResult<string>> {
    return this.run(this.primary, this.fallback, (provider) => provider.generateDraft(request));
  }

  private async run<T>(
    primary: IAIProvider | undefined,
    fallback: IAIProvider | undefined,
    operation: (provider: IAIProvider) => Promise<AIResult<T>>,
  ): Promise<AIResult<T>> {
    if (primary) {
      try {
        return await operation(primary);
      } catch (primaryError) {
        if (!fallback) throw primaryError;
      }
    }

    if (fallback) return operation(fallback);
    throw new Error("No AI provider is configured.");
  }
}
