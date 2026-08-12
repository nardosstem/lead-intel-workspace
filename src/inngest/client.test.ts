import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertInngestDeploymentConfiguration,
  isLocalInngestDevelopment,
  leadIngestRequested,
} from "./client";

afterEach(() => vi.unstubAllEnvs());

describe("lead.ingest.requested event", () => {
  it("validates the tenant-scoped workflow payload", async () => {
    const event = leadIngestRequested.create({
      domain: "acme.com",
      targetTitles: ["CEO", "Founder"],
      organizationId: "10000000-0000-4000-8000-000000000001",
      actorUserId: "10000000-0000-4000-8000-000000000002",
      runId: "10000000-0000-4000-8000-000000000003",
      usageDate: "2026-08-11",
    });

    await expect(event.validate()).resolves.toBeUndefined();
    expect(event.name).toBe("lead.ingest.requested");
  });

  it("rejects events without tenant identity", async () => {
    const event = leadIngestRequested.create({
      domain: "acme.com",
      targetTitles: ["CEO"],
      organizationId: "not-a-uuid",
      actorUserId: "not-a-uuid",
      runId: "not-a-uuid",
      usageDate: "2026-08-11",
    });

    await expect(event.validate()).rejects.toThrow(/organizationId|Invalid UUID/i);
  });
});

describe("Inngest deployment guards", () => {
  it("only treats the explicit local switch as development outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INNGEST_DEV", "1");
    expect(isLocalInngestDevelopment()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalInngestDevelopment()).toBe(false);
  });

  it("rejects development mode and missing signing credentials in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INNGEST_DEV", "1");
    expect(() => assertInngestDeploymentConfiguration()).toThrow(/INNGEST_DEV/);

    vi.stubEnv("INNGEST_DEV", "");
    expect(() => assertInngestDeploymentConfiguration()).toThrow(/EVENT_KEY/);

    vi.stubEnv("INNGEST_EVENT_KEY", "event");
    vi.stubEnv("INNGEST_SIGNING_KEY", "signing");
    expect(() => assertInngestDeploymentConfiguration()).not.toThrow();
  });
});
