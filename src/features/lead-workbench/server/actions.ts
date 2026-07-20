"use server";

import { and, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  auditLogs,
  companies,
  contacts,
  organizations,
  organizationInvitations,
  pipeline,
  users,
} from "@/lib/db";

import { parseCompaniesCsv } from "./csv";
import {
  requireLeadAdminContext,
  requireLeadAdminTransaction,
  withLeadMutation,
  withLeadMutationContext,
} from "./context";
import { getWorkbenchSnapshot, toCompanyRecord, toContactRecord } from "./data";
import { assertMemberStatusChange, assertRoleChangeAllowed, RolePolicyError } from "./role-policy";
import {
  InvitationConflictError,
  InvitationDeliveryError,
  INVITATION_LIFETIME_MS,
  normalizeInvitationEmail,
  sendOrganizationInvitation,
} from "@/lib/auth/invitations";
import { SupabaseAdminConfigurationError } from "@/lib/auth/admin";
import {
  companyInputSchema,
  contactInputSchema,
  updateCompanyInputSchema,
  updateContactInputSchema,
  updatePipelineSchema,
  updateMemberRoleSchema,
  updateMemberStatusSchema,
  inviteMemberSchema,
  normalizeCompanyDomain,
  workspaceSettingsSchema,
} from "../validation";
import type { PipelineStage } from "@/lib/db/pipeline";
import type {
  ActionResult,
  CompanyRecord,
  ContactRecord,
  WorkbenchSnapshot,
  WorkspaceSettings,
  OrganizationMemberRecord,
  OrganizationInvitationRecord,
} from "../types";

function validationFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
    }
  }

  return {
    ok: false,
    error: "Please correct the highlighted fields.",
    fieldErrors,
  };
}

function actionFailure(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return validationFailure(error);
  }

  if (
    error instanceof Error &&
    (error.name === "AuthenticationRequiredError" ||
      error.message.includes("organization profile"))
  ) {
    return { ok: false, error: "Sign in with an organization account to manage leads." };
  }

  if (error instanceof Error && error.name === "AuthorizationRequiredError") {
    return { ok: false, error: "Only organization owners and admins can perform this action." };
  }

  if (error instanceof Error && error.name === "WorkspaceAccessDisabledError") {
    return { ok: false, error: "Workspace access is disabled for this account." };
  }

  if (error instanceof RolePolicyError && error.kind === "authorization") {
    return { ok: false, error: error.message };
  }

  if (error instanceof RolePolicyError && error.kind === "invariant") {
    return { ok: false, error: error.message };
  }

  if (error instanceof InvitationConflictError) {
    return { ok: false, error: error.message };
  }

  if (error instanceof SupabaseAdminConfigurationError) {
    return { ok: false, error: error.message };
  }

  if (error instanceof InvitationDeliveryError) {
    return { ok: false, error: "The invitation email could not be sent. Try again later." };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "companies_organization_domain_uidx"
  ) {
    return { ok: false, error: "A company with that domain already exists." };
  }

  console.error("Lead operation failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "The lead operation could not be completed." };
}

export async function getLeads(): Promise<WorkbenchSnapshot> {
  return getWorkbenchSnapshot();
}

export async function updateWorkspaceSettings(
  input: unknown,
): Promise<ActionResult<WorkspaceSettings>> {
  const parsed = workspaceSettingsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const context = await requireLeadAdminContext();
    return {
      ok: true,
      data: await withLeadMutationContext(context, async (tx) => {
        const actor = await requireLeadAdminTransaction(tx, context);
        const updated = await tx
          .update(organizations)
          .set({
            defaultPipelineStage: parsed.data.defaultStage,
            defaultFollowUpDays: parsed.data.followUpDays,
          })
          .where(eq(organizations.id, context.organizationId))
          .returning({
            name: organizations.name,
            defaultStage: organizations.defaultPipelineStage,
            followUpDays: organizations.defaultFollowUpDays,
          });
        const organization = updated[0];
        if (!organization) throw new Error("Organization not found.");

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "settings_updated",
          entityType: "organization",
          entityId: context.organizationId,
          changes: {
            defaultStage: organization.defaultStage,
            followUpDays: organization.followUpDays,
          },
          metadata: { source: "lead-workbench-settings" },
        });

        return {
          organizationName: organization.name,
          currentUserId: context.userId,
          defaultStage: organization.defaultStage,
          followUpDays: organization.followUpDays,
          currentUserRole: actor.role,
        };
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

/** Updates a tenant member role without ever permitting cross-organization access. */
export async function updateMemberRole(
  input: unknown,
): Promise<ActionResult<OrganizationMemberRecord>> {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const context = await requireLeadAdminContext();

    return {
      ok: true,
      data: await withLeadMutationContext(context, async (tx) => {
        // Serialize role changes for this organization so two concurrent
        // demotions cannot both observe the same owner count.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`role:${context.organizationId}`}, 0))`,
        );
        const actor = await requireLeadAdminTransaction(tx, context);
        const targetRows = await tx
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            isActive: users.isActive,
            deactivatedAt: users.deactivatedAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(
            and(
              eq(users.id, parsed.data.targetUserId),
              eq(users.organizationId, context.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        const target = targetRows[0];
        if (!target) throw new Error("Organization member not found.");

        const ownerCount = await tx
          .select({ value: count(users.id) })
          .from(users)
          .where(
            and(
              eq(users.organizationId, context.organizationId),
              eq(users.role, "owner"),
            ),
          );
        assertRoleChangeAllowed({
          actorUserId: context.userId,
          actorRole: actor.role,
          targetUserId: target.id,
          targetRole: target.role,
          requestedRole: parsed.data.role,
          ownerCount: Number(ownerCount[0]?.value ?? 0),
        });

        const updated = await tx
          .update(users)
          .set({ role: parsed.data.role })
          .where(
            and(
              eq(users.id, target.id),
              eq(users.organizationId, context.organizationId),
            ),
          )
          .returning({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            isActive: users.isActive,
            deactivatedAt: users.deactivatedAt,
            createdAt: users.createdAt,
          });
        const member = updated[0];
        if (!member) throw new Error("Member role update returned no row.");

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "member_role_updated",
          entityType: "user",
          entityId: member.id,
          changes: { before: { role: target.role }, after: { role: member.role } },
          metadata: { source: "lead-workbench-settings" },
        });

        return {
          id: member.id,
          email: member.email,
          fullName: member.fullName,
          role: member.role,
          isActive: member.isActive,
          deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
          createdAt: member.createdAt.toISOString(),
        };
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

/** Deactivates or reactivates an existing organization member. */
export async function updateMemberStatus(
  input: unknown,
): Promise<ActionResult<OrganizationMemberRecord>> {
  const parsed = updateMemberStatusSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const context = await requireLeadAdminContext();
    return {
      ok: true,
      data: await withLeadMutationContext(context, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`role:${context.organizationId}`}, 0))`,
        );
        const actor = await requireLeadAdminTransaction(tx, context);
        const targetRows = await tx
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            isActive: users.isActive,
            deactivatedAt: users.deactivatedAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(
            and(
              eq(users.id, parsed.data.targetUserId),
              eq(users.organizationId, context.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        const target = targetRows[0];
        if (!target) throw new Error("Organization member not found.");

        assertMemberStatusChange({
          actorUserId: context.userId,
          actorRole: actor.role,
          targetUserId: target.id,
          targetRole: target.role,
          requestedActive: parsed.data.isActive,
        });

        if (target.isActive === parsed.data.isActive) {
          return {
            id: target.id,
            email: target.email,
            fullName: target.fullName,
            role: target.role,
            isActive: target.isActive,
            deactivatedAt: target.deactivatedAt?.toISOString() ?? null,
            createdAt: target.createdAt.toISOString(),
          };
        }

        const updated = await tx
          .update(users)
          .set({
            isActive: parsed.data.isActive,
            deactivatedAt: parsed.data.isActive ? null : new Date(),
          })
          .where(
            and(
              eq(users.id, target.id),
              eq(users.organizationId, context.organizationId),
            ),
          )
          .returning({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            isActive: users.isActive,
            deactivatedAt: users.deactivatedAt,
            createdAt: users.createdAt,
          });
        const member = updated[0];
        if (!member) throw new Error("Member access update returned no row.");

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: member.isActive ? "member_reactivated" : "member_deactivated",
          entityType: "user",
          entityId: member.id,
          changes: {
            before: { isActive: target.isActive },
            after: { isActive: member.isActive },
          },
          metadata: { source: "lead-workbench-settings" },
        });

        return {
          id: member.id,
          email: member.email,
          fullName: member.fullName,
          role: member.role,
          isActive: member.isActive,
          deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
          createdAt: member.createdAt.toISOString(),
        };
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

async function markInvitationFailed(
  context: { userId: string; organizationId: string },
  invitationId: string,
): Promise<void> {
  try {
    await withLeadMutationContext(context, async (tx) => {
      const updated = await tx
        .update(organizationInvitations)
        .set({ status: "failed" })
        .where(
          and(
            eq(organizationInvitations.id, invitationId),
            eq(organizationInvitations.organizationId, context.organizationId),
            eq(organizationInvitations.status, "pending"),
          ),
        )
        .returning({ id: organizationInvitations.id });
      if (!updated[0]) return;

      await tx.insert(auditLogs).values({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "member_invitation_failed",
        entityType: "organization_invitation",
        entityId: invitationId,
        changes: { status: "failed" },
        metadata: { source: "supabase-auth-invitation" },
      });
    }, { allowInactiveActor: true });
  } catch (cleanupError) {
    console.error("Invitation cleanup failed", {
      errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
    });
  }
}

export async function inviteMember(
  input: unknown,
): Promise<ActionResult<OrganizationInvitationRecord>> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const context = await requireLeadAdminContext();
    const email = normalizeInvitationEmail(parsed.data.email);
    let invitationId: string | undefined;

    try {
      const invitation = await withLeadMutationContext(context, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`invite-email:${email}`}, 0))`,
        );
        await requireLeadAdminTransaction(tx, context);

        const existingProfile = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);
        if (existingProfile[0]) {
          throw new InvitationConflictError(
            "That email already has an organization profile. Reactivate or manage the existing member instead.",
          );
        }

        const existingInvitation = await tx
          .select({ id: organizationInvitations.id })
          .from(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.email, email),
              eq(organizationInvitations.status, "pending"),
              gt(organizationInvitations.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (existingInvitation[0]) {
          throw new InvitationConflictError("A pending invitation already exists for that email.");
        }

        const inserted = await tx
          .insert(organizationInvitations)
          .values({
            organizationId: context.organizationId,
            invitedByUserId: context.userId,
            email,
            role: parsed.data.role,
            status: "pending",
            expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
          })
          .returning();
        const created = inserted[0];
        if (!created) throw new Error("Invitation insert returned no row.");

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "member_invitation_created",
          entityType: "organization_invitation",
          entityId: created.id,
          changes: { email, role: parsed.data.role, status: "pending" },
          metadata: { source: "lead-workbench-settings" },
        });

        return created;
      });
      invitationId = invitation.id;
      await sendOrganizationInvitation(email);

      return {
        ok: true,
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role === "owner" ? "member" : invitation.role,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        },
      };
    } catch (error) {
      if (invitationId) await markInvitationFailed(context, invitationId);
      throw error;
    }
  } catch (error) {
    return actionFailure(error);
  }
}

export async function revokeInvitation(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid invitation id." };

  try {
    const context = await requireLeadAdminContext();
    return {
      ok: true,
      data: await withLeadMutationContext(context, async (tx) => {
        await requireLeadAdminTransaction(tx, context);
        const updated = await tx
          .update(organizationInvitations)
          .set({ status: "revoked" })
          .where(
            and(
              eq(organizationInvitations.id, parsed.data),
              eq(organizationInvitations.organizationId, context.organizationId),
              eq(organizationInvitations.status, "pending"),
            ),
          )
          .returning({ id: organizationInvitations.id });
        const invitation = updated[0];
        if (!invitation) {
          throw new InvitationConflictError("That invitation is no longer pending.");
        }

        await tx.insert(auditLogs).values({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: "member_invitation_revoked",
          entityType: "organization_invitation",
          entityId: invitation.id,
          changes: { status: "revoked" },
          metadata: { source: "lead-workbench-settings" },
        });

        return invitation;
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createCompany(
  input: unknown,
): Promise<ActionResult<CompanyRecord>> {
  const parsed = companyInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const settings = await tx
          .select({
            defaultStage: organizations.defaultPipelineStage,
            followUpDays: organizations.defaultFollowUpDays,
          })
          .from(organizations)
          .where(eq(organizations.id, context.organizationId))
          .limit(1);
        const defaults = settings[0];
        const inserted = await tx
          .insert(companies)
          .values({
            ...parsed.data,
            domain: normalizeCompanyDomain(parsed.data.website),
            organizationId: context.organizationId,
          })
          .returning();
        const company = inserted[0];
        if (!company) {
          throw new Error("Company insert returned no row.");
        }

        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          companyId: company.id,
          stage: defaults?.defaultStage ?? "new",
          nextFollowUpAt: new Date(
            Date.now() + (defaults?.followUpDays ?? 7) * 24 * 60 * 60 * 1000,
          ),
        });

        return toCompanyRecord(company);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateCompany(
  input: unknown,
): Promise<ActionResult<CompanyRecord>> {
  const parsed = updateCompanyInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const { id, ...values } = parsed.data;
        const updateValues = Object.hasOwn(parsed.data, "website")
          ? { ...values, domain: normalizeCompanyDomain(values.website) }
          : values;
        const updated = await tx
          .update(companies)
          .set(updateValues)
          .where(and(eq(companies.id, id), eq(companies.organizationId, context.organizationId)))
          .returning();
        const company = updated[0];
        if (!company) {
          throw new Error("Company not found.");
        }
        return toCompanyRecord(company);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteCompany(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Invalid company id." };
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const deleted = await tx
          .delete(companies)
          .where(and(eq(companies.id, parsed.data), eq(companies.organizationId, context.organizationId)))
          .returning({ id: companies.id });
        if (!deleted[0]) {
          throw new Error("Company not found.");
        }
        return deleted[0];
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createContact(
  input: unknown,
): Promise<ActionResult<ContactRecord>> {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const settings = await tx
          .select({
            defaultStage: organizations.defaultPipelineStage,
            followUpDays: organizations.defaultFollowUpDays,
          })
          .from(organizations)
          .where(eq(organizations.id, context.organizationId))
          .limit(1);
        const defaults = settings[0];
        const company = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, parsed.data.companyId), eq(companies.organizationId, context.organizationId)))
          .limit(1);
        if (!company[0]) {
          throw new Error("Company not found.");
        }

        const inserted = await tx
          .insert(contacts)
          .values({ ...parsed.data, organizationId: context.organizationId })
          .returning();
        const contact = inserted[0];
        if (!contact) {
          throw new Error("Contact insert returned no row.");
        }

        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          contactId: contact.id,
          stage: defaults?.defaultStage ?? "new",
          nextFollowUpAt: new Date(
            Date.now() + (defaults?.followUpDays ?? 7) * 24 * 60 * 60 * 1000,
          ),
        });

        return toContactRecord(contact, company[0].name);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateContact(
  input: unknown,
): Promise<ActionResult<ContactRecord>> {
  const parsed = updateContactInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const { id, ...values } = parsed.data;
        const company = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, values.companyId), eq(companies.organizationId, context.organizationId)))
          .limit(1);
        if (!company[0]) {
          throw new Error("Company not found.");
        }

        const updated = await tx
          .update(contacts)
          .set(values)
          .where(and(eq(contacts.id, id), eq(contacts.organizationId, context.organizationId)))
          .returning();
        const contact = updated[0];
        if (!contact) {
          throw new Error("Contact not found.");
        }
        return toContactRecord(contact, company[0].name);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteContact(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Invalid contact id." };
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const deleted = await tx
          .delete(contacts)
          .where(and(eq(contacts.id, parsed.data), eq(contacts.organizationId, context.organizationId)))
          .returning({ id: contacts.id });
        if (!deleted[0]) {
          throw new Error("Contact not found.");
        }
        return deleted[0];
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updatePipeline(
  input: unknown,
): Promise<ActionResult<{ id: string; stage: PipelineStage; nextFollowUpAt: string | null }>> {
  const parsed = updatePipelineSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const current = await tx
          .select({
            id: pipeline.id,
            companyId: pipeline.companyId,
            contactId: pipeline.contactId,
          })
          .from(pipeline)
          .where(
            and(
              eq(pipeline.id, parsed.data.id),
              eq(pipeline.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        const target = current[0];
        if (!target) {
          throw new Error("Pipeline record not found.");
        }

        if (target.companyId) {
          const company = await tx
            .select({ id: companies.id })
            .from(companies)
            .where(
              and(
                eq(companies.id, target.companyId),
                eq(companies.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!company[0]) throw new Error("Pipeline target is outside the organization.");
        } else if (target.contactId) {
          const contact = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                eq(contacts.id, target.contactId),
                eq(contacts.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!contact[0]) throw new Error("Pipeline target is outside the organization.");
        }

        const updated = await tx
          .update(pipeline)
          .set({
            stage: parsed.data.stage,
            nextFollowUpAt: parsed.data.nextFollowUpAt,
            lastActivityAt: new Date(),
          })
          .where(and(eq(pipeline.id, parsed.data.id), eq(pipeline.organizationId, context.organizationId)))
          .returning({
            id: pipeline.id,
            stage: pipeline.stage,
            nextFollowUpAt: pipeline.nextFollowUpAt,
        });
        const row = updated[0];
        if (!row) throw new Error("Pipeline record not found.");
        return {
          id: row.id,
          stage: row.stage,
          nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
        };
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function importCompaniesCsv(
  csvText: string,
): Promise<ActionResult<{ imported: number; errors: { row: number; message: string }[] }>> {
  if (typeof csvText !== "string") {
    return { ok: false, error: "CSV content is required." };
  }

  try {
    let parsed: ReturnType<typeof parseCompaniesCsv>;
    try {
      parsed = parseCompaniesCsv(csvText);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The CSV could not be parsed.",
      };
    }
    const importResult = await withLeadMutation(async (tx, context) => {
      let count = 0;
      const errors = [...parsed.errors];
      const settings = await tx
        .select({
          defaultStage: organizations.defaultPipelineStage,
          followUpDays: organizations.defaultFollowUpDays,
        })
        .from(organizations)
        .where(eq(organizations.id, context.organizationId))
        .limit(1);
      const defaults = settings[0];
      for (const [index, row] of parsed.rows.entries()) {
        const rowNumber = parsed.rowNumbers[index] ?? index + 2;
        try {
          await tx.transaction(async (savepoint) => {
            const inserted = await savepoint
              .insert(companies)
              .values({
                ...row,
                domain: normalizeCompanyDomain(row.website),
                organizationId: context.organizationId,
              })
              .returning({ id: companies.id });
            const company = inserted[0];
            if (!company) throw new Error("Company insert returned no row.");
            await savepoint.insert(pipeline).values({
              organizationId: context.organizationId,
              companyId: company.id,
              stage: defaults?.defaultStage ?? "new",
              nextFollowUpAt: new Date(
                Date.now() + (defaults?.followUpDays ?? 7) * 24 * 60 * 60 * 1000,
              ),
            });
          });
          count += 1;
        } catch (error) {
          const constraint =
            typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string"
              ? error.constraint
              : null;
          errors.push({
            row: rowNumber,
            message: constraint === "companies_organization_domain_uidx"
              ? "A company with this domain already exists in the workspace."
              : "This company row could not be imported.",
          });
        }
      }
      return { count, errors };
    });

    return { ok: true, data: { imported: importResult.count, errors: importResult.errors } };
  } catch (error) {
    return actionFailure(error);
  }
}
