import { describe, expect, it } from "vitest";

import { GdeltClient, NewsSourceError, searchGdelt } from "./gdelt";
import { parseRss, RssClient } from "./rss";
import { newsArticleSchema, signalExtractionSchema } from "./types";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GDELT news source", () => {
  it("builds a bounded article search and normalizes provider metadata", async () => {
    let requestUrl = "";
    const client = new GdeltClient({
      baseUrl: "https://gdelt.test/doc",
      fetchImpl: async (input) => {
        requestUrl = String(input);
        return jsonResponse({
          articles: [
            {
              url: "https://news.example.com/story#section",
              title: "Acme deploys AI review tooling",
              seendate: "20260725120000",
              domain: "news.example.com",
              language: "English",
              sourcecountry: "United States",
              snippet: "Acme is reducing manual review volume.",
            },
            {
              url: "https://news.example.com/story#duplicate",
              title: "Duplicate article",
            },
            {
              url: "http://localhost/private",
              title: "Unsafe article",
            },
          ],
        });
      },
    });

    const [article] = await client.search({
      query: '"Acme" automation',
      maxRecords: 10,
      startDate: new Date("2026-07-20T00:00:00.000Z"),
      endDate: new Date("2026-07-25T00:00:00.000Z"),
    });

    expect(new URL(requestUrl).searchParams.get("query")).toBe('"Acme" automation');
    expect(new URL(requestUrl).searchParams.get("maxrecords")).toBe("10");
    expect(new URL(requestUrl).searchParams.get("startdatetime")).toBe("20260720000000");
    expect(article?.canonicalUrl).toBe("https://news.example.com/story");
    expect(article?.sourceType).toBe("gdelt");
    expect(article?.sourceDomain).toBe("news.example.com");
    expect(article?.publishedAt?.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    expect(article?.metadata.language).toBe("English");
  });

  it("rejects invalid ranges and provider failures without leaking response bodies", async () => {
    const client = new GdeltClient({
      fetchImpl: async () => jsonResponse({ message: "provider internals" }, 503),
    });

    await expect(
      client.search({
        query: "acme",
        startDate: new Date("2026-07-25T00:00:00.000Z"),
        endDate: new Date("2026-07-20T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ source: "gdelt", status: 400 });
    await expect(client.search({ query: "acme" })).rejects.toEqual(
      expect.objectContaining({ source: "gdelt", status: 503 }),
    );
    await expect(searchGdelt(" ")).rejects.toThrow();
    expect(new NewsSourceError("gdelt", "x")).toBeInstanceOf(Error);
  });
});

describe("RSS source", () => {
  const feed = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[Acme partners with a new AI vendor]]></title>
        <link>https://example.com/news/acme?utm_source=feed#read</link>
        <description><![CDATA[<p>Acme selected a vendor &amp; will automate reviews.</p>]]></description>
        <pubDate>Sat, 25 Jul 2026 12:00:00 GMT</pubDate>
        <source>Example News</source>
      </item>
      <item><title>Missing URL</title><description>Should be skipped</description></item>
    </channel></rss>`;

  it("parses RSS 2.0 entries, strips markup, and bounds the result", () => {
    const discoveredAt = new Date("2026-07-25T13:00:00.000Z");
    const [article] = parseRss(feed, {
      sourceUrl: "https://example.com/feed.xml",
      discoveredAt,
      maxItems: 1,
    });

    expect(article?.canonicalUrl).toBe("https://example.com/news/acme?utm_source=feed");
    expect(article?.sourceType).toBe("rss");
    expect(article?.publisher).toBe("Example News");
    expect(article?.excerpt).toBe("Acme selected a vendor & will automate reviews.");
    expect(article?.publishedAt?.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    expect(article?.discoveredAt).toBe(discoveredAt);
  });

  it("supports Atom links and fetches feeds with a timeout", async () => {
    let fetched = "";
    const client = new RssClient({
      fetchImpl: async (input) => {
        fetched = String(input);
        return new Response(
          `<feed><entry><title>Atom story</title><link href="https://news.example.com/atom"/><updated>2026-07-25T12:00:00Z</updated></entry></feed>`,
          { status: 200 },
        );
      },
    });

    const [article] = await client.fetch("https://example.com/feed.xml");
    expect(fetched).toBe("https://example.com/feed.xml");
    expect(article?.canonicalUrl).toBe("https://news.example.com/atom");
  });

  it("rejects oversized XML and unsafe feed schemes", async () => {
    expect(() => parseRss("x".repeat(2_000_001))).toThrow(/size limit/i);
    expect(parseRss(`<rss><item><title>Bad &#x110000; entity</title><link>https://example.com/story</link></item></rss>`)[0]?.title).toBe(
      "Bad entity",
    );
    const client = new RssClient();
    await expect(client.fetch("file:///tmp/feed.xml")).rejects.toThrow(/HTTP or HTTPS/i);
  });
});

describe("news and signal schemas", () => {
  it("rejects unbounded article metadata and invalid signal confidence", () => {
    expect(() =>
      newsArticleSchema.parse({
        canonicalUrl: "https://example.com/story",
        title: "Story",
        publisher: null,
        sourceDomain: "example.com",
        sourceType: "gdelt",
        publishedAt: null,
        discoveredAt: new Date(),
        excerpt: null,
        metadata: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, true])),
      }),
    ).toThrow(/20 fields/i);
    expect(() =>
      signalExtractionSchema.parse({
        overallRelevance: 101,
        signals: [],
      }),
    ).toThrow();
  });
});
