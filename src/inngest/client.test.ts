import { describe, expect, it } from "vitest";

import { leadIngestRequested } from "./client";

describe("lead.ingest.requested event", () => {
  it("validates the tenant-scoped workflow payload", async () => {
    const event = leadIngestRequested.create({
      domain: "acme.com",
      targetTitles: ["CEO", "Founder"],
      organizationId: "10000000-0000-4000-8000-000000000001",
      actorUserId: "10000000-0000-4000-8000-000000000002",
      runId: "10000000-0000-4000-8000-000000000003",
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
    });

    await expect(event.validate()).rejects.toThrow(/organizationId|Invalid UUID/i);
  });
});
