import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseAdminConfigurationError } from "./admin";
import {
  invitationRedirectUrl,
  INVITATION_LIFETIME_MS,
  normalizeInvitationEmail,
} from "./invitations";

afterEach(() => vi.unstubAllEnvs());

describe("organization invitation helpers", () => {
  it("normalizes email addresses before persistence and provider calls", () => {
    expect(normalizeInvitationEmail("  Teammate@Example.COM ")).toBe("teammate@example.com");
  });

  it("uses a bounded seven-day invitation lifetime", () => {
    expect(INVITATION_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("builds a safe callback URL from the explicit application origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    expect(invitationRedirectUrl()).toBe(
      "https://app.example.com/auth/callback?next=%2Fleads",
    );
  });

  it("fails closed when the callback origin is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(() => invitationRedirectUrl()).toThrow(SupabaseAdminConfigurationError);
  });
});
