import "server-only";

import { Firecrawl } from "@mendable/firecrawl-js";

import { isPublicHostname } from "@/lib/domains";

const SCRAPE_TIMEOUT_MS = 30_000;
const MAX_MARKDOWN_LENGTH = 60_000;

export type FirecrawlScrapeResult = Readonly<{
  sourceUrl: string;
  markdown: string;
  warning?: string;
  /** Present when Firecrawl failed; empty Markdown from a valid page has no failure. */
  failure?: "configuration" | "transient" | "target" | "provider";
  truncated: boolean;
}>;

export class FirecrawlConfigurationError extends Error {
  constructor() {
    super("Firecrawl is not configured. Set FIRECRAWL_API_KEY before scraping a domain.");
    this.name = "FirecrawlConfigurationError";
  }
}

export type FirecrawlClientOptions = Readonly<{
  apiKey: string;
  timeoutMs?: number;
  /** Injectable transport keeps timeout and provider failures deterministic in tests. */
  client?: Pick<Firecrawl, "scrapeUrl">;
}>;

export class FirecrawlClient {
  private readonly client: Pick<Firecrawl, "scrapeUrl">;

  constructor(options: FirecrawlClientOptions) {
    if (!options.apiKey.trim()) {
      throw new FirecrawlConfigurationError();
    }

    this.client =
      options.client ??
      new Firecrawl({
        apiKey: options.apiKey.trim(),
        timeoutMs: options.timeoutMs ?? SCRAPE_TIMEOUT_MS,
        maxRetries: 2,
      });
  }

  async scrapeUrl(url: string): Promise<FirecrawlScrapeResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        sourceUrl: url,
        markdown: "",
        truncated: false,
        warning: "Firecrawl rejected an unsafe or invalid company URL.",
        failure: "target",
      };
    }

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username ||
      parsedUrl.password ||
      !isPublicHostname(parsedUrl.hostname)
    ) {
      return {
        sourceUrl: url,
        markdown: "",
        truncated: false,
        warning: "Firecrawl rejected an unsafe or invalid company URL.",
        failure: "target",
      };
    }

    try {
      const result = await this.client.scrapeUrl(parsedUrl.toString(), { formats: ["markdown"] });
      const providerResult = result as { markdown?: unknown; success?: unknown; error?: unknown };
      if (providerResult.success === false || typeof providerResult.error === "string") {
        const message = typeof providerResult.error === "string" ? providerResult.error : "Firecrawl rejected the scrape.";
        const isClient = /invalid|unauthori[sz]ed|forbidden|\b400\b|\b401\b|\b403\b|\b404\b|\b422\b|api key|authentication/i.test(message);
        const isTransient = !isClient;
        return {
          sourceUrl: parsedUrl.toString(),
          markdown: "",
          truncated: false,
          warning: isTransient ? "Firecrawl was temporarily unavailable while scraping the website." : "Firecrawl rejected the website scrape request.",
          failure: isTransient ? "transient" : "provider",
        };
      }
      const markdown = typeof providerResult.markdown === "string" ? providerResult.markdown : "";
      const truncated = markdown.length > MAX_MARKDOWN_LENGTH;

      return {
        sourceUrl: parsedUrl.toString(),
        markdown: truncated ? markdown.slice(0, MAX_MARKDOWN_LENGTH) : markdown,
        truncated,
        ...(markdown ? {} : { warning: "Firecrawl returned no Markdown content." }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Firecrawl error";
      const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
      const isClient = status !== undefined
        ? status >= 400 && status < 500 && status !== 429
        : /invalid|unauthori[sz]ed|forbidden|\b400\b|\b401\b|\b403\b|\b404\b|\b422\b|api key|authentication/i.test(message);
      const isTransient = !isClient;
      const warning = isTransient
        ? (/timeout|timed out|abort/i.test(message)
            ? "Firecrawl timed out while scraping the website."
            : "Firecrawl was temporarily unavailable while scraping the website.")
        : "Firecrawl rejected the website scrape request.";

      console.warn("Firecrawl scrape failed", { url: parsedUrl.toString(), message });
      return {
        sourceUrl: parsedUrl.toString(),
        markdown: "",
        truncated: false,
        warning,
        failure: isTransient ? "transient" : "provider",
      };
    }
  }
}

let defaultClient: FirecrawlClient | undefined;

export function getFirecrawlClient(): FirecrawlClient {
  return (defaultClient ??= new FirecrawlClient({
    apiKey: process.env.FIRECRAWL_API_KEY ?? "",
  }));
}

export async function scrapeDomain(domain: string): Promise<FirecrawlScrapeResult> {
  const candidate = domain.trim();
  const normalizedDomain = (() => {
    try {
      const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
      return url.hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return candidate.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0].toLowerCase();
    }
  })();
  const sourceUrl = `https://${normalizedDomain}`;

  if (!isPublicHostname(normalizedDomain)) {
    return {
      sourceUrl,
      markdown: "",
      truncated: false,
      warning: "Firecrawl rejected an unsafe or invalid company domain.",
    };
  }

  try {
    return await getFirecrawlClient().scrapeUrl(sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Firecrawl is unavailable";
    return {
      sourceUrl,
      markdown: "",
      truncated: false,
      warning: message.includes("not configured")
        ? "Firecrawl is not configured."
        : "Firecrawl was unavailable.",
      failure: message.includes("not configured") ? "configuration" : "transient",
    };
  }
}
