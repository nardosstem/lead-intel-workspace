import { describe, expect, it } from "vitest";

import { newsScanRequested } from "@/inngest/client";

import { scanNewsRequested, scanNewsScheduled } from "./scan-news";

describe("news scan workflows", () => {
  it("registers a singleton weekly schedule and tenant concurrency key", () => {
    expect(scanNewsScheduled.opts.concurrency).toEqual({ limit: 1, scope: "fn" });
    expect(scanNewsScheduled.opts.triggers).toHaveLength(1);
    expect(scanNewsRequested.opts.concurrency).toEqual({
      limit: 1,
      key: "event.data.organizationId",
      scope: "fn",
    });
  });

  it("validates manual scan events at the event boundary", async () => {
    const event = newsScanRequested.create({
      organizationId: "00000000-0000-4000-8000-000000000001",
      actorUserId: "00000000-0000-4000-8000-000000000002",
    });

    await expect(event.validate()).resolves.toBeUndefined();
    const invalidEvent = newsScanRequested.create({
      organizationId: "not-a-uuid",
      actorUserId: "also-not-a-uuid",
    });
    await expect(invalidEvent.validate()).rejects.toThrow();
  });
});
