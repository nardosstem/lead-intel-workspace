import "server-only";

import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

type ResolvedAddress = Readonly<{ address: string; family: number }>;
type RssLookup = (
  hostname: string,
  options: Readonly<{ all: true; verbatim: true }>,
) => Promise<ResolvedAddress[]>;

const safeDnsLookup: LookupFunction = (hostname, _options, callback) => {
  void lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        callback(new Error("RSS feed host resolved to a private address."), "", 0);
        return;
      }
      const address = addresses[0];
      callback(null, address.address, address.family);
    })
    .catch((error: unknown) => callback(error instanceof Error ? error : new Error("RSS host resolution failed."), "", 0));
};

const rssDispatcher = new Agent({ connect: { lookup: safeDnsLookup } });

function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return undiciFetch(input as string | URL, { ...(init as Record<string, unknown>), dispatcher: rssDispatcher } as never) as unknown as Promise<Response>;
}

import { isPublicHostname } from "@/lib/domains";

import {
  newsArticleSchema,
  NewsSourceError,
  type NewsArticle,
} from "./types";

const MAX_XML_BYTES = 2_000_000;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 2_000;

export type RssParserOptions = Readonly<{
  sourceUrl?: string;
  discoveredAt?: Date;
  maxItems?: number;
}>;

function decodeXml(value: string): string {
  const decodeCodePoint = (raw: string, radix: number): string => {
    const codePoint = Number.parseInt(raw, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : "";
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(code, 10))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => decodeCodePoint(code, 16));
}

function stripMarkup(value: string): string {
  return decodeXml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function firstTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1]).trim() : null;
}

function firstAttribute(block: string, tag: string, attribute: string): string | null {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] ? decodeXml(match[1]).trim() : null;
}

function extractLink(block: string): string | null {
  const atomLink = firstAttribute(block, "link", "href");
  if (atomLink) return atomLink;
  return firstTag(block, "link") ?? firstTag(block, "guid");
}

function normalizeUrl(value: string, sourceUrl?: string): string | null {
  try {
    const url = new URL(value, sourceUrl);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    if (!isPublicHostname(url.hostname)) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 2_048 ? normalized : null;
  } catch {
    return null;
  }
}

function sourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").slice(0, 253);
  } catch {
    return null;
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseItem(block: string, sourceUrl: string | undefined, discoveredAt: Date): NewsArticle | null {
  const canonicalUrl = normalizeUrl(extractLink(block) ?? "", sourceUrl);
  const title = stripMarkup(firstTag(block, "title") ?? "");
  if (!canonicalUrl || !title) return null;

  const publisher = stripMarkup(firstTag(block, "source") ?? "") || null;
  const date = firstTag(block, "pubDate") ?? firstTag(block, "published") ?? firstTag(block, "updated");
  const excerpt = stripMarkup(
    firstTag(block, "description") ?? firstTag(block, "summary") ?? "",
  ) || null;

  return newsArticleSchema.parse({
    canonicalUrl,
    title,
    publisher: publisher?.slice(0, 160) ?? null,
    sourceDomain: sourceDomain(canonicalUrl),
    sourceType: "rss",
    publishedAt: parseDate(date),
    discoveredAt,
    excerpt,
    metadata: {
      ...(sourceUrl ? { feedUrl: sourceUrl.slice(0, 500) } : {}),
    },
  });
}

/** Parse common RSS 2.0 and Atom feeds without adding an XML dependency. */
export function parseRss(xml: string, options: RssParserOptions = {}): NewsArticle[] {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
    throw new Error("RSS feed exceeded the configured size limit.");
  }
  const discoveredAt = options.discoveredAt ?? new Date();
  const maxItems = Math.min(Math.max(options.maxItems ?? MAX_ITEMS, 1), MAX_ITEMS);
  const itemBlocks = [
    ...Array.from(xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi), (match) => match[0]),
    ...Array.from(xml.matchAll(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi), (match) => match[0]),
  ];
  const seenUrls = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const block of itemBlocks) {
    if (articles.length >= maxItems) break;
    const article = parseItem(block, options.sourceUrl, discoveredAt);
    if (!article || seenUrls.has(article.canonicalUrl)) continue;
    seenUrls.add(article.canonicalUrl);
    articles.push(article);
  }
  return articles;
}

export type RssFetcherOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lookupImpl?: RssLookup;
}>;

export class RssClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly lookupImpl: RssLookup;

  constructor(options: RssFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? safeFetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.lookupImpl = options.lookupImpl ?? (lookup as unknown as RssLookup);
  }

  async fetch(url: string, options: RssParserOptions = {}): Promise<NewsArticle[]> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new NewsSourceError("rss", "RSS feed URL is invalid.", 400);
    }
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username ||
      parsedUrl.password ||
      !isPublicHostname(parsedUrl.hostname)
    ) {
      throw new NewsSourceError("rss", "RSS feed URL must use a public HTTP or HTTPS host.", 400);
    }
    try {
      const addresses = await this.lookupImpl(parsedUrl.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new NewsSourceError("rss", "RSS feed host resolves to a private or unavailable address.", 400);
      }
    } catch (error) {
      if (error instanceof NewsSourceError) throw error;
      throw new NewsSourceError("rss", "RSS feed host could not be resolved safely.");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(parsedUrl.toString(), {
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
        // Do not follow a user-configured feed through a redirect into a
        // private host. A redirect must be reviewed and saved explicitly.
        redirect: "error",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed";
      throw new NewsSourceError("rss", `RSS request failed: ${message}`);
    }
    if (!response.ok) {
      throw new NewsSourceError("rss", `RSS feed returned HTTP ${response.status}.`, response.status);
    }
    try {
      const xml = await response.text();
      return parseRss(xml, { ...options, sourceUrl: parsedUrl.toString() });
    } catch (error) {
      if (error instanceof NewsSourceError) throw error;
      const message = error instanceof Error ? error.message : "RSS feed could not be parsed.";
      throw new NewsSourceError("rss", message, response.status);
    }
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = parts;
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) ||
      (first === 192 && second === 0) || (first === 198 && second >= 18 && second <= 19) ||
      (first === 100 && second >= 64 && second <= 127);
  }
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff");
}

export const __rssInternals = { isPrivateAddress };
