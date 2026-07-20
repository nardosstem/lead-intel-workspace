import "server-only";

import { Firecrawl } from "@mendable/firecrawl-js";

import { isPublicHostname } from "@/lib/domains";

const SCRAPE_TIMEOUT_MS = 30_000;
const MAX_MARKDOWN_LENGTH = 60_000;

export type FirecrawlScrapeResult = Readonly<{
  sourceUrl: string;
  markdown: string;
  warning?: string;
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
      };
    }

    try {
      const result = await this.client.scrapeUrl(parsedUrl.toString(), { formats: ["markdown"] });
      const markdown = typeof result.markdown === "string" ? result.markdown : "";
      const truncated = markdown.length > MAX_MARKDOWN_LENGTH;

      return {
        sourceUrl: parsedUrl.toString(),
        markdown: truncated ? markdown.slice(0, MAX_MARKDOWN_LENGTH) : markdown,
        truncated,
        ...(markdown ? {} : { warning: "Firecrawl returned no Markdown content." }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Firecrawl error";
      const warning = /timeout|timed out|abort/i.test(message)
        ? "Firecrawl timed out while scraping the website. AI enrichment continued with Apollo data."
        : "Firecrawl could not scrape the website. AI enrichment continued with Apollo data.";

      console.warn("Firecrawl scrape failed", { url: parsedUrl.toString(), message });
      return {
        sourceUrl: parsedUrl.toString(),
        markdown: "",
        truncated: false,
        warning,
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
        ? "Firecrawl is not configured. AI enrichment continued with Apollo data."
        : "Firecrawl was unavailable. AI enrichment continued with Apollo data.",
    };
  }
}
