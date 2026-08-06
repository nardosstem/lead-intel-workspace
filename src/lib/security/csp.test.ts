import { describe, expect, it } from "vitest";

import { createContentSecurityNonce, createContentSecurityPolicy } from "./csp";

describe("content security policy", () => {
  it("creates unique nonces and binds production scripts to them", () => {
    const first = createContentSecurityNonce();
    const second = createContentSecurityNonce();

    expect(first).not.toBe(second);
    expect(createContentSecurityPolicy(first, false)).toContain(`'nonce-${first}'`);
    expect(createContentSecurityPolicy(first, false)).not.toContain("'unsafe-eval'");
  });

  it("keeps local Supabase development connections available", () => {
    const policy = createContentSecurityPolicy("test-nonce", true);

    expect(policy).toContain("http://localhost:54321");
    expect(policy).toContain("https://*.supabase.co");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
