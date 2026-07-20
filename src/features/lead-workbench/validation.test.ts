import { describe, expect, it } from "vitest";

import {
  contactInputSchema,
  researchCompanySchema,
  scoreIcpSchema,
} from "./validation";

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
      researchCompanySchema.safeParse({ companyId: "10000000-0000-4000-8000-000000000001", websiteUrl: "http://localhost:8787" }).success,
    ).toBe(false);
    expect(
      researchCompanySchema.safeParse({ companyId: "10000000-0000-4000-8000-000000000001", websiteUrl: "https://[::1]" }).success,
    ).toBe(false);
    expect(
      researchCompanySchema.safeParse({ companyId: "10000000-0000-4000-8000-000000000001", websiteUrl: "https://user:pass@acme.com" }).success,
    ).toBe(false);
  });

  it("accepts a public HTTPS research URL", () => {
    expect(
      researchCompanySchema.safeParse({ companyId: "10000000-0000-4000-8000-000000000001", websiteUrl: "https://acme.com/about" }).success,
    ).toBe(true);
  });

  it("bounds AI payload fields", () => {
    expect(
      researchCompanySchema.safeParse({ companyId: "10000000-0000-4000-8000-000000000001", websiteUrl: `https://acme.com/${"x".repeat(2_049)}` }).success,
    ).toBe(false);
    expect(
      scoreIcpSchema.safeParse({
        companyId: "10000000-0000-4000-8000-000000000001",
        companyData: { name: "x".repeat(201) },
      }).success,
    ).toBe(false);
    expect(
      scoreIcpSchema.safeParse({
        companyId: "10000000-0000-4000-8000-000000000001",
        companyData: { name: "Acme", website: "https://user:pass@acme.com" },
      }).success,
    ).toBe(false);
  });
});
