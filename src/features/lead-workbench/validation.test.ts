import { describe, expect, it } from "vitest";

import { contactInputSchema, researchCompanySchema } from "./validation";

describe("lead input URL validation", () => {
  it("rejects executable schemes and private research hosts", () => {
    expect(
      contactInputSchema.safeParse({
        companyId: "10000000-0000-4000-8000-000000000001",
        name: "Alex",
        linkedin: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      researchCompanySchema.safeParse({ websiteUrl: "http://localhost:8787" }).success,
    ).toBe(false);
    expect(
      researchCompanySchema.safeParse({ websiteUrl: "https://[::1]" }).success,
    ).toBe(false);
  });

  it("accepts a public HTTPS research URL", () => {
    expect(
      researchCompanySchema.safeParse({ websiteUrl: "https://acme.com/about" }).success,
    ).toBe(true);
  });
});
