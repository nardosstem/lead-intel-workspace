import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationUsageLimitError, organizationUsageLimit, usageDateKey } from "./usage";

afterEach(() => vi.unstubAllEnvs());

describe("organization usage limits", () => {
  it("uses conservative defaults and bounded environment overrides", () => {
    expect(organizationUsageLimit("domain_ingestion")).toBe(25);
    expect(organizationUsageLimit("news_scan")).toBe(1);
    expect(organizationUsageLimit("ai_action")).toBe(100);

    vi.stubEnv("LEAD_INGESTION_DAILY_LIMIT", "7");
    vi.stubEnv("NEWS_SCAN_DAILY_LIMIT", "not-a-number");
    vi.stubEnv("AI_ACTION_DAILY_LIMIT", "999999");

    expect(organizationUsageLimit("domain_ingestion")).toBe(7);
    expect(organizationUsageLimit("news_scan")).toBe(1);
    expect(organizationUsageLimit("ai_action")).toBe(10_000);
  });

  it("uses a stable UTC date key and exposes a safe limit error", () => {
    expect(usageDateKey(new Date("2026-08-05T23:59:59.000Z"))).toBe("2026-08-05");
    expect(usageDateKey(new Date("2026-08-06T00:00:00.000Z"))).toBe("2026-08-06");

    const error = new OrganizationUsageLimitError("news_scan", 1, "2026-08-05");
    expect(error.name).toBe("OrganizationUsageLimitError");
    expect(error.message).toContain("news scan daily limit of 1");
  });
});
