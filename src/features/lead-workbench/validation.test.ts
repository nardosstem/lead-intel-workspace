import { describe, expect, it } from "vitest";

import {
  contactInputSchema,
  inviteMemberSchema,
  organizationRoles,
  researchCompanySchema,
  scoreIcpSchema,
  updateMemberRoleSchema,
  updateMemberStatusSchema,
  workspaceSettingsSchema,
} from "./validation";
import { assertMemberStatusChange, assertRoleChangeAllowed, RolePolicyError } from "./server/role-policy";

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
    expect(
      scoreIcpSchema.safeParse({
        companyId: "10000000-0000-4000-8000-000000000001",
        companyData: { name: "Acme", website: "http://localhost:3000" },
      }).success,
    ).toBe(false);
  });

  it("bounds persisted workspace defaults", () => {
    expect(
      workspaceSettingsSchema.safeParse({ defaultStage: "qualified", followUpDays: 14 }).success,
    ).toBe(true);
    expect(
      workspaceSettingsSchema.safeParse({ defaultStage: "new", followUpDays: 0 }).success,
    ).toBe(false);
  });
});

describe("organization governance validation", () => {
  it("keeps the role vocabulary explicit and validates role updates", () => {
    expect(organizationRoles).toEqual(["owner", "admin", "member"]);
    expect(updateMemberRoleSchema.safeParse({
      targetUserId: "00000000-0000-4000-8000-000000000001",
      role: "admin",
    }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({
      targetUserId: "not-a-uuid",
      role: "owner",
    }).success).toBe(false);
    expect(updateMemberStatusSchema.safeParse({
      targetUserId: "00000000-0000-4000-8000-000000000001",
      isActive: false,
    }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({
      targetUserId: "00000000-0000-4000-8000-000000000001",
      role: "superadmin",
    }).success).toBe(false);
  });

  it("normalizes and restricts invitation roles", () => {
    const parsed = inviteMemberSchema.safeParse({ email: "  Teammate@Example.com ", role: "admin" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ email: "teammate@example.com", role: "admin" });
    expect(inviteMemberSchema.safeParse({ email: "not-an-email", role: "member" }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: "person@example.com", role: "owner" }).success).toBe(false);
  });

  it("prevents admins from granting owner access or changing owners", () => {
    expect(() => assertRoleChangeAllowed({
      actorRole: "admin",
      targetRole: "member",
      requestedRole: "owner",
      ownerCount: 2,
    })).toThrowError(new RolePolicyError("Only the organization owner can grant owner access.", "authorization"));
    expect(() => assertRoleChangeAllowed({
      actorRole: "admin",
      targetRole: "owner",
      requestedRole: "admin",
      ownerCount: 2,
    })).toThrowError(/Only the organization owner can change an owner/);
  });

  it("prevents demoting the last owner", () => {
    expect(() => assertRoleChangeAllowed({
      actorRole: "owner",
      targetRole: "owner",
      requestedRole: "member",
      ownerCount: 1,
    })).toThrowError(/at least one owner/);
    expect(() => assertRoleChangeAllowed({
      actorRole: "owner",
      targetRole: "owner",
      requestedRole: "admin",
      ownerCount: 2,
    })).not.toThrow();
  });

  it("prevents self-lockout and owner deactivation", () => {
    expect(() => assertMemberStatusChange({
      actorUserId: "user-1",
      actorRole: "owner",
      targetUserId: "user-1",
      targetRole: "owner",
      requestedActive: false,
    })).toThrowError(/cannot deactivate your own/);
    expect(() => assertMemberStatusChange({
      actorUserId: "user-1",
      actorRole: "owner",
      targetUserId: "user-2",
      targetRole: "owner",
      requestedActive: false,
    })).toThrowError(/Demote an owner/);
    expect(() => assertMemberStatusChange({
      actorUserId: "user-1",
      actorRole: "admin",
      targetUserId: "user-2",
      targetRole: "owner",
      requestedActive: true,
    })).not.toThrow();
  });
});
