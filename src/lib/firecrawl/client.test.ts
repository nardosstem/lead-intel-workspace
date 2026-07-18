import { describe, expect, it } from "vitest";

import { FirecrawlClient, scrapeDomain } from "./client";

describe("Firecrawl client", () => {
  it("returns a non-fatal warning when Firecrawl is not configured", async () => {
    const result = await scrapeDomain("example.com");

    expect(result.sourceUrl).toBe("https://example.com");
    expect(result.markdown).toBe("");
    expect(result.warning).toMatch(/Firecrawl is not configured/i);
  });

  it("converts provider timeouts into a warning and empty Markdown", async () => {
    const client = new FirecrawlClient({
      apiKey: "firecrawl-test-key",
      client: {
        scrapeUrl: async () => {
          throw new Error("request timed out");
        },
      },
    });

    const result = await client.scrapeUrl("https://example.com");

    expect(result.markdown).toBe("");
    expect(result.warning).toMatch(/timed out/i);
  });

  it("returns Markdown from the SDK and requests the Markdown format", async () => {
    let requestedOptions: unknown;
    const client = new FirecrawlClient({
      apiKey: "firecrawl-test-key",
      client: {
        scrapeUrl: async (_url, options) => {
          requestedOptions = options;
          return { markdown: "# Acme\n\nWe build workflow software." };
        },
      },
    });

    const result = await client.scrapeUrl("https://acme.com");

    expect(result.markdown).toContain("# Acme");
    expect(result.warning).toBeUndefined();
    expect(requestedOptions).toEqual({ formats: ["markdown"] });
  });
});
