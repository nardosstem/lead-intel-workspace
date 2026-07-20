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
  actorUserId: string;
  actorRole: "owner" | "admin";
  targetUserId: string;
  targetRole: OrganizationRole;
  requestedRole: OrganizationRole;
  ownerCount: number;
}>): void {
  if (
    input.actorRole === "owner" &&
    input.actorUserId === input.targetUserId &&
    input.targetRole === "owner" &&
    input.requestedRole !== "owner"
  ) {
    throw new RolePolicyError("You cannot demote your own owner access.", "authorization");
  }
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

export function assertMemberStatusChange(input: Readonly<{
  actorUserId: string;
  actorRole: "owner" | "admin";
  targetUserId: string;
  targetRole: OrganizationRole;
  requestedActive: boolean;
}>): void {
  if (input.requestedActive) return;
  if (input.actorUserId === input.targetUserId) {
    throw new RolePolicyError("You cannot deactivate your own workspace access.", "authorization");
  }
  if (input.targetRole === "owner") {
    throw new RolePolicyError("Demote an owner before deactivating their access.", "authorization");
  }
}
