import { afterEach, describe, expect, it, vi } from "vitest";

import { newsScanRequested } from "@/inngest/client";

import {
  __newsScanInternals,
  scanNewsOrganizationScheduled,
  scanNewsRequested,
  scanNewsScheduled,
} from "./scan-news";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("news scan workflows", () => {
  it("registers a singleton weekly schedule and tenant concurrency key", () => {
    expect(scanNewsScheduled.opts.concurrency).toEqual({ limit: 1, scope: "fn" });
    expect(scanNewsScheduled.opts.triggers).toHaveLength(1);
    expect(scanNewsRequested.opts.concurrency).toEqual({
      limit: 1,
      key: "event.data.organizationId",
      scope: "fn",
    });
    expect(scanNewsRequested.opts.idempotency).toBe("event.data.runId");
    expect(scanNewsOrganizationScheduled.opts.idempotency).toBe("event.data.runId");
  });

  it("validates manual scan events at the event boundary", async () => {
    const event = newsScanRequested.create({
      organizationId: "00000000-0000-4000-8000-000000000001",
      actorUserId: "00000000-0000-4000-8000-000000000002",
      runId: "00000000-0000-4000-8000-000000000003",
      force: false,
    });

    await expect(event.validate()).resolves.toBeUndefined();
    const invalidEvent = newsScanRequested.create({
      organizationId: "not-a-uuid",
      actorUserId: "also-not-a-uuid",
      runId: "still-not-a-uuid",
      force: false,
    });
    await expect(invalidEvent.validate()).rejects.toThrow();
  });

  it("supports an explicit immediate-scan flag", async () => {
    const event = newsScanRequested.create({
      organizationId: "00000000-0000-4000-8000-000000000001",
      actorUserId: "00000000-0000-4000-8000-000000000002",
      runId: "00000000-0000-4000-8000-000000000003",
      force: true,
    });
    await expect(event.validate()).resolves.toBeUndefined();
  });

  it("requires explicit opt-in before autonomous scans can run", () => {
    vi.stubEnv("NEWS_SCAN_ENABLED", "");
    expect(__newsScanInternals.scanEnabled()).toBe(false);

    vi.stubEnv("NEWS_SCAN_ENABLED", "0");
    expect(__newsScanInternals.scanEnabled()).toBe(false);

    vi.stubEnv("NEWS_SCAN_ENABLED", "1");
    expect(__newsScanInternals.scanEnabled()).toBe(true);
  });

  it("retains non-fatal Firecrawl warnings and does not count empty scrapes as fetched", () => {
    const outcome = __newsScanInternals.applyScrapeResult(
      {
        canonicalUrl: "https://news.example.com/acme",
        title: "Acme news",
        publisher: "Example News",
        sourceDomain: "news.example.com",
        sourceType: "gdelt",
        publishedAt: null,
        discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
        excerpt: "A short excerpt",
        metadata: {},
      },
      {
        sourceUrl: "https://news.example.com/acme",
        markdown: "",
        truncated: false,
        warning: "Firecrawl timed out while scraping the website.",
      },
    );

    expect(outcome.fetched).toBe(false);
    expect(outcome.warning).toMatch(/timed out/i);
    expect(outcome.article.excerpt).toBe("A short excerpt");
  });
});
