import "server-only";

import { isPublicHostname } from "@/lib/domains";

import { newsArticleSchema, type NewsArticle } from "./types";

const MAX_XML_BYTES = 2_000_000;
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 2_000;

export type RssParserOptions = Readonly<{
  sourceUrl?: string;
  discoveredAt?: Date;
  maxItems?: number;
}>;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
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
}>;

export class RssClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RssFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetch(url: string, options: RssParserOptions = {}): Promise<NewsArticle[]> {
    const parsedUrl = new URL(url);
    if (
      (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") ||
      parsedUrl.username ||
      parsedUrl.password ||
      !isPublicHostname(parsedUrl.hostname)
    ) {
      throw new Error("RSS feed URL must use HTTP or HTTPS.");
    }
    const response = await this.fetchImpl(parsedUrl.toString(), {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}.`);
    const xml = await response.text();
    return parseRss(xml, { ...options, sourceUrl: parsedUrl.toString() });
  }
}
