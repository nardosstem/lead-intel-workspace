import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { getDatabase, auditLogs, organizationInvitations, users } from "@/lib/db";

import { getPublicEnvironment } from "@/lib/public-env";
import { getSupabaseAdminClient, SupabaseAdminConfigurationError } from "./admin";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export class InvitationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationDeliveryError";
  }
}

export class InvitationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationConflictError";
  }
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationRedirectUrl(): string {
  const appUrl = getPublicEnvironment().appUrl;
  if (!appUrl) {
    throw new SupabaseAdminConfigurationError(
      "Member invitations require NEXT_PUBLIC_APP_URL on the server.",
    );
  }

  const redirectUrl = new URL("/auth/callback", appUrl);
  redirectUrl.searchParams.set("next", "/leads");
  return redirectUrl.toString();
}

export async function sendOrganizationInvitation(email: string): Promise<void> {
  const normalizedEmail = normalizeInvitationEmail(email);
  const { error } = await getSupabaseAdminClient().auth.admin.inviteUserByEmail(
    normalizedEmail,
    { redirectTo: invitationRedirectUrl() },
  );

  if (error) {
    throw new InvitationDeliveryError("Supabase could not send the invitation email.");
  }
}

export async function acceptPendingOrganizationInvitation(input: Readonly<{
  userId: string;
  email: string;
}>): Promise<{ accepted: boolean; organizationId?: string }> {
  const email = normalizeInvitationEmail(input.email);
  const db = getDatabase();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`invite-email:${email}`}, 0))`,
    );

    const existingProfile = await tx
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    const invitations = await tx
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.email, email),
          eq(organizationInvitations.status, "pending"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(organizationInvitations.createdAt))
      .limit(2);
    if (invitations.length > 1) {
      throw new InvitationConflictError("Multiple pending invitations require administrator review.");
    }

    const invitation = invitations[0];
    if (!invitation) return { accepted: false };

    if (existingProfile[0] && existingProfile[0].organizationId !== invitation.organizationId) {
      throw new InvitationConflictError(
        "This account already belongs to another organization.",
      );
    }

    if (!existingProfile[0]) {
      await tx.insert(users).values({
        id: input.userId,
        organizationId: invitation.organizationId,
        email,
        role: invitation.role,
        isActive: true,
      });
    }

    await tx
      .update(organizationInvitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(organizationInvitations.id, invitation.id),
          eq(organizationInvitations.status, "pending"),
        ),
      );

    await tx.insert(auditLogs).values({
      organizationId: invitation.organizationId,
      actorUserId: input.userId,
      action: "member_invitation_accepted",
      entityType: "organization_invitation",
      entityId: invitation.id,
      changes: {
        status: "accepted",
        role: invitation.role,
        email,
      },
      metadata: { source: "supabase-auth-callback" },
    });

    return { accepted: true, organizationId: invitation.organizationId };
  });
}

export { INVITATION_LIFETIME_MS };
