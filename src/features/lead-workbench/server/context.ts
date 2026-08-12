import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getCurrentUser, requireCurrentUser } from "@/lib/auth/user";
import { isPublicSignupEnabled } from "@/lib/public-env";
import { auditLogs, getDatabase, organizations, users, type Database } from "@/lib/db";

export type LeadContext = Readonly<{
  userId: string;
  organizationId: string;
}>;

type DatabaseTransactionCallback = Parameters<Database["transaction"]>[0];
export type LeadTransaction = Parameters<DatabaseTransactionCallback>[0];

export async function getLeadContext(): Promise<LeadContext | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const db = getDatabase();
  const profile = await db
    .select({ organizationId: users.organizationId, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const organizationId = profile[0]?.organizationId;

  return organizationId && profile[0]?.isActive && profile[0]?.passwordSetupAt
    ? { userId: user.id, organizationId }
    : null;
}

/**
 * Creates the application profile required by a newly authenticated user.
 *
 * The first local user is attached to the seeded demo organization when it is
 * still empty. Other users receive an isolated workspace. This keeps local
 * onboarding self-serve without ever sharing a populated tenant.
 */
export async function ensureLeadContext(): Promise<LeadContext | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const db = getDatabase();
  const existingProfile = await db
    .select({ organizationId: users.organizationId, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (existingProfile[0]) {
    return existingProfile[0].isActive && existingProfile[0].passwordSetupAt
      ? { userId: user.id, organizationId: existingProfile[0].organizationId }
      : null;
  }

  // A Supabase-invited user must pass through the invitation callback so the
  // pending organization invitation is atomically accepted before a profile
  // can exist. Never auto-provision an invitee whose callback query was
  // tampered with or whose invitation has expired.
  if (user.invited_at) return null;

  // Keep self-service onboarding available in local development while making
  // production sign-up an explicit deployment decision.
  if (!isPublicSignupEnabled()) return null;

  const email = user.email ?? `${user.id}@local.invalid`;
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    typeof metadata?.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name.trim().slice(0, 160)
      : null;

  return db.transaction(async (tx) => {
    // Serialize first-login provisioning so two simultaneous sign-ups cannot
    // both claim the empty seeded demo organization.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('lead-intel-profile-provisioning', 0))`,
    );

    const recheckedProfile = await tx
      .select({ organizationId: users.organizationId, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (recheckedProfile[0]) {
      return recheckedProfile[0].isActive && recheckedProfile[0].passwordSetupAt
        ? { userId: user.id, organizationId: recheckedProfile[0].organizationId }
        : null;
    }

    const demoOrganization = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, "lead-intel-demo"))
      .limit(1);

    let organizationId: string | undefined = demoOrganization[0]?.id;
    let organizationCreated = false;

    if (organizationId) {
      const demoMembers = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.organizationId, organizationId))
        .limit(1);

      if (demoMembers[0]) {
        organizationId = undefined;
      }
    }

    if (!organizationId) {
      const workspaceSlug = `workspace-${user.id}`;
      const insertedOrganization = await tx
        .insert(organizations)
        .values({
          name: fullName ? `${fullName}'s Workspace` : "Lead Intel Workspace",
          slug: workspaceSlug,
        })
        .onConflictDoNothing({ target: organizations.slug })
        .returning({ id: organizations.id });

      organizationId = insertedOrganization[0]?.id;
      organizationCreated = Boolean(organizationId);

      if (!organizationId) {
        const existingOrganization = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, workspaceSlug))
          .limit(1);
        organizationId = existingOrganization[0]?.id;
      }
    }

    if (!organizationId) {
      throw new Error("Unable to provision an organization workspace.");
    }

    const insertedProfile = await tx
      .insert(users)
      .values({
        id: user.id,
        organizationId,
        email,
        fullName,
        role: "owner",
        passwordSetupAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: users.id, organizationId: users.organizationId });

    if (insertedProfile[0]) {
      const provisioningAuditRows = [
        ...(organizationCreated
          ? [{
              organizationId,
              actorUserId: user.id,
              action: "workspace_created",
              entityType: "organization",
              entityId: organizationId,
              changes: { name: fullName ? `${fullName}'s Workspace` : "Lead Intel Workspace" },
              metadata: { source: "first-login-provisioning" },
            }]
          : []),
        {
          organizationId,
          actorUserId: user.id,
          action: "member_provisioned",
          entityType: "user",
          entityId: user.id,
          changes: { role: "owner", email },
          metadata: { source: "first-login-provisioning" },
        },
      ];
      await tx.insert(auditLogs).values(provisioningAuditRows);
    }

    const profile = await tx
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!profile[0]) {
      throw new Error("Unable to provision an application user profile.");
    }

    return { userId: user.id, organizationId: profile[0].organizationId };
  });
}

export async function requireLeadContext(): Promise<LeadContext> {
  const user = await requireCurrentUser();
  const db = getDatabase();
  const profile = await db
    .select({ organizationId: users.organizationId, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const organizationId = profile[0]?.organizationId;

  if (!organizationId) {
    throw new Error("An organization profile is required for lead access.");
  }
  if (!profile[0]?.isActive) {
    const error = new Error("Workspace access is disabled for this account.");
    error.name = "WorkspaceAccessDisabledError";
    throw error;
  }
  if (!profile[0]?.passwordSetupAt) {
    const error = new Error("Password setup is required before workspace access.");
    error.name = "PasswordSetupRequiredError";
    throw error;
  }

  return { userId: user.id, organizationId };
}

/** Re-checks active membership inside the same transaction as a foreground mutation. */
export async function requireLeadTransaction(
  tx: LeadTransaction,
  context: LeadContext,
  options: Readonly<{ allowPasswordSetupIncomplete?: boolean }> = {},
): Promise<void> {
  const profile = await tx
    .select({ id: users.id, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(and(eq(users.id, context.userId), eq(users.organizationId, context.organizationId)))
    .for("update")
    .limit(1);
  const membership = profile[0];

  if (!membership) {
    throw new Error("An organization profile is required for lead access.");
  }
  if (!membership.isActive) {
    const error = new Error("Workspace access is disabled for this account.");
    error.name = "WorkspaceAccessDisabledError";
    throw error;
  }
  if (!membership.passwordSetupAt && !options.allowPasswordSetupIncomplete) {
    const error = new Error("Password setup is required before workspace access.");
    error.name = "PasswordSetupRequiredError";
    throw error;
  }
}

export async function requireLeadAdminContext(): Promise<LeadContext & { role: "owner" | "admin" }> {
  const user = await requireCurrentUser();
  const db = getDatabase();
  const profile = await db
    .select({ organizationId: users.organizationId, role: users.role, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const membership = profile[0];

  if (!membership?.organizationId) {
    throw new Error("An organization profile is required for lead access.");
  }
  if (!membership.isActive) {
    const error = new Error("Workspace access is disabled for this account.");
    error.name = "WorkspaceAccessDisabledError";
    throw error;
  }
  if (!membership.passwordSetupAt) {
    const error = new Error("Password setup is required before workspace access.");
    error.name = "PasswordSetupRequiredError";
    throw error;
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    const error = new Error("Organization administrator access is required.");
    error.name = "AuthorizationRequiredError";
    throw error;
  }

  return {
    userId: user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Re-checks and locks the actor membership inside the mutation transaction. */
export async function requireLeadAdminTransaction(
  tx: LeadTransaction,
  context: LeadContext,
): Promise<LeadContext & { role: "owner" | "admin" }> {
  const profile = await tx
    .select({ organizationId: users.organizationId, role: users.role, isActive: users.isActive, passwordSetupAt: users.passwordSetupAt })
    .from(users)
    .where(and(eq(users.id, context.userId), eq(users.organizationId, context.organizationId)))
    .for("update")
    .limit(1);
  const membership = profile[0];

  if (!membership) {
    throw new Error("An organization profile is required for lead access.");
  }
  if (!membership.isActive) {
    const error = new Error("Workspace access is disabled for this account.");
    error.name = "WorkspaceAccessDisabledError";
    throw error;
  }
  if (!membership.passwordSetupAt) {
    const error = new Error("Password setup is required before workspace access.");
    error.name = "PasswordSetupRequiredError";
    throw error;
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    const error = new Error("Organization administrator access is required.");
    error.name = "AuthorizationRequiredError";
    throw error;
  }

  return { ...context, role: membership.role };
}

/** Sets trigger context and executes a mutation in one transaction. */
export async function withLeadMutationContext<T>(
  context: LeadContext,
  operation: (tx: LeadTransaction, context: LeadContext) => Promise<T>,
  options: Readonly<{ allowInactiveActor?: boolean }> = {},
): Promise<T> {
  const db = getDatabase();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${context.userId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${context.organizationId}, true)`,
    );
    if (!options.allowInactiveActor) {
      await requireLeadTransaction(tx, context);
    }
    return operation(tx, context);
  });
}

/** Uses the current request identity for a foreground mutation. */
export async function withLeadMutation<T>(
  operation: (tx: LeadTransaction, context: LeadContext) => Promise<T>,
): Promise<T> {
  return withLeadMutationContext(await requireLeadContext(), operation);
}
