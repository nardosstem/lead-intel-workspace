export class AIProviderError extends Error {
  readonly provider: string;
  readonly cause?: unknown;

  constructor(message: string, provider: string, cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}
