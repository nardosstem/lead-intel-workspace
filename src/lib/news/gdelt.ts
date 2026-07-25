import "server-only";

import { z } from "zod";

import { isPublicHostname } from "@/lib/domains";

import {
  newsArticleSchema,
  newsSearchOptionsSchema,
  type NewsArticle,
  type NewsSearchOptions,
  type NewsSource,
  NewsSourceError,
} from "./types";

const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RECORDS = 50;
const MAX_RESPONSE_BYTES = 2_000_000;

const gdeltArticleSchema = z
  .object({
    url: z.string().max(4_096),
    title: z.string().max(2_000).optional().default(""),
    seendate: z.string().max(32).optional(),
    domain: z.string().max(500).optional(),
    language: z.string().max(120).optional(),
    sourcecountry: z.string().max(120).optional(),
    sourcecollection: z.string().max(120).optional(),
    url_mobile: z.string().max(4_096).optional(),
    socialimage: z.string().max(4_096).optional(),
    snippet: z.string().max(10_000).optional(),
  })
  .passthrough();

const gdeltResponseSchema = z
  .object({
    articles: z.array(gdeltArticleSchema).default([]),
  })
  .passthrough();

export type GdeltClientOptions = Readonly<{
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

function formatGdeltDate(value: Date): string {
  return value.toISOString().replace(/\D/g, "").slice(0, 14);
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  // GDELT normally returns YYYYMMDDhhmmss, but some feeds return ISO dates.
  const compact = /^(\d{4})(\d{2})(\d{2})(?:T)?(\d{2})(\d{2})(\d{2})Z?$/i.exec(value);
  const candidate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      !isPublicHostname(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 2_048 ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | undefined, articleUrl: string): string | null {
  const candidate = value?.trim() || (() => {
    try {
      return new URL(articleUrl).hostname;
    } catch {
      return null;
    }
  })();
  if (!candidate) return null;
  const hostname = candidate.toLowerCase().replace(/^www\./, "");
  return isPublicHostname(hostname) ? hostname.slice(0, 253) : null;
}

function toArticle(article: z.infer<typeof gdeltArticleSchema>, discoveredAt: Date): NewsArticle | null {
  const canonicalUrl = normalizeUrl(article.url);
  if (!canonicalUrl) return null;
  const title = article.title.trim().slice(0, 500);
  if (!title) return null;

  return newsArticleSchema.parse({
    canonicalUrl,
    title,
    publisher: normalizeDomain(article.domain, canonicalUrl),
    sourceDomain: normalizeDomain(article.domain, canonicalUrl),
    sourceType: "gdelt",
    publishedAt: toDate(article.seendate),
    discoveredAt,
    excerpt: article.snippet?.trim().slice(0, 2_000) || null,
    metadata: {
      ...(article.language ? { language: article.language.slice(0, 120) } : {}),
      ...(article.sourcecountry
        ? { sourceCountry: article.sourcecountry.slice(0, 120) }
        : {}),
      ...(article.sourcecollection
        ? { sourceCollection: article.sourcecollection.slice(0, 120) }
        : {}),
      ...(article.url_mobile ? { mobileUrl: article.url_mobile.slice(0, 500) } : {}),
      ...(article.socialimage ? { socialImage: article.socialimage.slice(0, 500) } : {}),
    },
  });
}

export class GdeltClient implements NewsSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GdeltClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? GDELT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(options: NewsSearchOptions): Promise<NewsArticle[]> {
    const parsedOptions = newsSearchOptionsSchema.parse(options);
    if (
      parsedOptions.startDate &&
      parsedOptions.endDate &&
      parsedOptions.startDate > parsedOptions.endDate
    ) {
      throw new NewsSourceError("gdelt", "GDELT startDate cannot be after endDate.", 400);
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set("query", parsedOptions.query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", String(parsedOptions.maxRecords ?? DEFAULT_MAX_RECORDS));
    url.searchParams.set("sort", "HybridRel");
    if (parsedOptions.startDate) url.searchParams.set("startdatetime", formatGdeltDate(parsedOptions.startDate));
    if (parsedOptions.endDate) url.searchParams.set("enddatetime", formatGdeltDate(parsedOptions.endDate));

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed";
      throw new NewsSourceError("gdelt", `GDELT request failed: ${message}`);
    }

    const responseText = await response.text();
    if (responseText.length > MAX_RESPONSE_BYTES) {
      throw new NewsSourceError("gdelt", "GDELT response exceeded the configured size limit.", response.status);
    }

    let responseBody: unknown;
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new NewsSourceError("gdelt", "GDELT returned invalid JSON.", response.status);
    }
    if (!response.ok) {
      throw new NewsSourceError("gdelt", `GDELT returned HTTP ${response.status}.`, response.status);
    }

    const parsedResponse = gdeltResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new NewsSourceError("gdelt", "GDELT returned an unexpected response shape.", response.status);
    }

    const discoveredAt = new Date();
    const seenUrls = new Set<string>();
    return parsedResponse.data.articles
      .map((article) => toArticle(article, discoveredAt))
      .filter((article): article is NewsArticle => {
        if (!article || seenUrls.has(article.canonicalUrl)) return false;
        seenUrls.add(article.canonicalUrl);
        return true;
      });
  }
}

let defaultClient: GdeltClient | undefined;

export function getGdeltClient(): GdeltClient {
  return (defaultClient ??= new GdeltClient());
}

export async function searchGdelt(
  query: string,
  options: Omit<NewsSearchOptions, "query"> = {},
  source: NewsSource = getGdeltClient(),
): Promise<NewsArticle[]> {
  return source.search({ ...options, query });
}

export { NewsSourceError } from "./types";
