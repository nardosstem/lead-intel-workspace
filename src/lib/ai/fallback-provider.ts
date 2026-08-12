import "server-only";

import type {
  AIResult,
  EntityExtractionRequest,
  GenerateDraftRequest,
  IAIProvider,
  SummarizeTextRequest,
} from "./types";
import { AIProviderError } from "./errors";

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
        if (!fallback || !isRetryableProviderError(primaryError)) throw primaryError;
      }
    }

    if (fallback) return operation(fallback);
    throw new Error("No AI provider is configured.");
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return true;
  // A free-tier policy refusal is safe to route to the explicitly configured
  // private-data fallback (normally Claude). Contract/schema errors still
  // remain terminal so the fallback cannot hide a programming defect.
  return /timeout|timed out|rate limit|\b429\b|\b5\d\d\b|network|unavailable|econn|enotfound|data policy|private workspace data/i.test(error.message);
}
