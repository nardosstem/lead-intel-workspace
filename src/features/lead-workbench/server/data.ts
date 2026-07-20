import "server-only";

import { and, asc, desc, eq, gt } from "drizzle-orm";

import {
  auditLogs,
  companies,
  contacts,
  getDatabase,
  organizations,
  organizationInvitations,
  users,
  pipeline,
} from "@/lib/db";

import { getLeadContext } from "./context";
import {
  emptyWorkbenchSnapshot,
  type CompanyRecord,
  type ContactRecord,
  type AuditRecord,
  type OrganizationMemberRecord,
  type OrganizationInvitationRecord,
  type PipelineRecord,
  type WorkbenchSnapshot,
} from "../types";

function toIso(value: Date): string {
  return value.toISOString();
}

export function toCompanyRecord(company: typeof companies.$inferSelect): CompanyRecord {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    industry: company.industry,
    size: company.size,
    location: company.location,
    status: company.status,
    enrichmentStatus: company.enrichmentStatus,
    enrichmentError: company.enrichmentError,
    icpScore: company.icpScore,
    icpRationale: company.icpRationale,
    icpSignals: [...company.icpSignals],
    researchSummary: company.researchSummary,
    researchPainPoints: [...company.researchPainPoints],
    researchSignals: [...company.researchSignals],
    callPrep: company.callPrep,
    painPoints: [...company.painPoints],
    outreachDraft: company.outreachDraft,
    enrichedAt: company.enrichedAt?.toISOString() ?? null,
    createdAt: toIso(company.createdAt),
    updatedAt: toIso(company.updatedAt),
  };
}

export function toContactRecord(
  contact: typeof contacts.$inferSelect,
  companyName: string,
): ContactRecord {
  return {
    id: contact.id,
    companyId: contact.companyId,
    companyName,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    linkedin: contact.linkedin,
    notes: contact.notes,
    outreachDraft: contact.outreachDraft,
    createdAt: toIso(contact.createdAt),
    updatedAt: toIso(contact.updatedAt),
  };
}

export function toPipelineRecord(row: {
  pipeline: typeof pipeline.$inferSelect;
  companyName: string | null;
  contactName: string | null;
}): PipelineRecord {
  return {
    id: row.pipeline.id,
    companyId: row.pipeline.companyId,
    contactId: row.pipeline.contactId,
    targetName: row.companyName ?? row.contactName ?? "Unnamed lead",
    targetType: row.pipeline.companyId ? "company" : "contact",
    stage: row.pipeline.stage,
    nextFollowUpAt: row.pipeline.nextFollowUpAt?.toISOString() ?? null,
    lastActivityAt: row.pipeline.lastActivityAt?.toISOString() ?? null,
    notes: row.pipeline.notes,
    createdAt: toIso(row.pipeline.createdAt),
    updatedAt: toIso(row.pipeline.updatedAt),
  };
}

function toAuditRecord(row: {
  log: typeof auditLogs.$inferSelect;
  actorName: string | null;
  actorEmail: string | null;
}): AuditRecord {
  return {
    id: row.log.id,
    action: row.log.action,
    entityType: row.log.entityType,
    entityId: row.log.entityId,
    actorUserId: row.log.actorUserId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    changes: row.log.changes,
    createdAt: row.log.createdAt.toISOString(),
  };
}

export async function getWorkbenchSnapshot(): Promise<WorkbenchSnapshot> {
  const context = await getLeadContext();

  if (!context) {
    return emptyWorkbenchSnapshot;
  }

  const db = getDatabase();
  const [organizationRows, memberRows, invitationRows, companyRows, contactRows, pipelineRows, auditRows] = await Promise.all([
    db
      .select({
        name: organizations.name,
        defaultStage: organizations.defaultPipelineStage,
        followUpDays: organizations.defaultFollowUpDays,
      })
      .from(organizations)
      .where(eq(organizations.id, context.organizationId))
      .limit(1),
    db
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
      .where(eq(users.organizationId, context.organizationId))
      .orderBy(asc(users.createdAt)),
    db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, context.organizationId),
          eq(organizationInvitations.status, "pending"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(organizationInvitations.createdAt)),
    db
      .select()
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId))
      .orderBy(desc(companies.createdAt)),
    db
      .select({ contact: contacts, companyName: companies.name })
      .from(contacts)
      .innerJoin(
        companies,
        and(
          eq(contacts.companyId, companies.id),
          eq(contacts.organizationId, companies.organizationId),
          eq(companies.organizationId, context.organizationId),
        ),
      )
      .where(eq(contacts.organizationId, context.organizationId))
      .orderBy(desc(contacts.createdAt)),
    db
      .select({
        pipeline,
        companyName: companies.name,
        contactName: contacts.name,
      })
      .from(pipeline)
      .leftJoin(
        companies,
        and(
          eq(pipeline.companyId, companies.id),
          eq(pipeline.organizationId, companies.organizationId),
          eq(companies.organizationId, context.organizationId),
        ),
      )
      .leftJoin(
        contacts,
        and(
          eq(pipeline.contactId, contacts.id),
          eq(pipeline.organizationId, contacts.organizationId),
          eq(contacts.organizationId, context.organizationId),
        ),
      )
      .where(eq(pipeline.organizationId, context.organizationId))
      .orderBy(desc(pipeline.updatedAt)),
    db
      .select({
        log: auditLogs,
        actorName: users.fullName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(eq(auditLogs.organizationId, context.organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  ]);

  return {
    settings: {
      organizationName: organizationRows[0]?.name ?? "Lead Intel Workspace",
      currentUserId: context.userId,
      defaultStage: organizationRows[0]?.defaultStage ?? "new",
      followUpDays: organizationRows[0]?.followUpDays ?? 7,
      currentUserRole:
        memberRows.find((member) => member.id === context.userId)?.role ?? "member",
    },
    members: memberRows.map((member): OrganizationMemberRecord => ({
      id: member.id,
      email: member.email,
      fullName: member.fullName,
      role: member.role,
      isActive: member.isActive,
      deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
      createdAt: member.createdAt.toISOString(),
    })),
    pendingInvitations: invitationRows.flatMap((invitation): OrganizationInvitationRecord[] =>
      invitation.role === "owner"
        ? []
        : [{
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt.toISOString(),
            createdAt: invitation.createdAt.toISOString(),
          }],
    ),
    companies: companyRows.map(toCompanyRecord),
    contacts: contactRows.map((row) =>
      toContactRecord(row.contact, row.companyName),
    ),
    pipeline: pipelineRows.map(toPipelineRecord),
    auditLogs: auditRows.map(toAuditRecord),
  };
}

export async function getCompanyById(
  id: string,
): Promise<CompanyRecord | null> {
  const context = await getLeadContext();

  if (!context) {
    return null;
  }

  const rows = await getDatabase()
    .select()
    .from(companies)
    .where(
      and(eq(companies.id, id), eq(companies.organizationId, context.organizationId)),
    )
    .limit(1);

  return rows[0] ? toCompanyRecord(rows[0]) : null;
}
