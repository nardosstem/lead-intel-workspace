import type { OrganizationRole } from "../validation";

export class RolePolicyError extends Error {
  constructor(
    message: string,
    readonly kind: "authorization" | "invariant",
  ) {
    super(message);
    this.name = "RolePolicyError";
  }
}

/**
 * Applies the role governance rules independently of persistence so callers
 * can validate a requested change before opening a database mutation.
 */
export function assertRoleChangeAllowed(input: Readonly<{
  actorRole: "owner" | "admin";
  targetRole: OrganizationRole;
  requestedRole: OrganizationRole;
  ownerCount: number;
}>): void {
  if (input.requestedRole === "owner" && input.actorRole !== "owner") {
    throw new RolePolicyError("Only the organization owner can grant owner access.", "authorization");
  }
  if (input.targetRole === "owner" && input.actorRole !== "owner") {
    throw new RolePolicyError("Only the organization owner can change an owner.", "authorization");
  }
  if (input.targetRole === "owner" && input.requestedRole !== "owner" && input.ownerCount <= 1) {
    throw new RolePolicyError("An organization must keep at least one owner.", "invariant");
  }
}
