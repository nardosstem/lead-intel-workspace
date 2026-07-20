import { describe, expect, it } from "vitest";

import { INVITATION_LIFETIME_MS, normalizeInvitationEmail } from "./invitations";

describe("organization invitation helpers", () => {
  it("normalizes email addresses before persistence and provider calls", () => {
    expect(normalizeInvitationEmail("  Teammate@Example.COM ")).toBe("teammate@example.com");
  });

  it("uses a bounded seven-day invitation lifetime", () => {
    expect(INVITATION_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });
});
