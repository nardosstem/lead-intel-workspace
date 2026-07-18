import "server-only";

import { and, desc, eq } from "drizzle-orm";

import {
  auditLogs,
  companies,
  contacts,
  getDatabase,
  pipeline,
} from "@/lib/db";

import { getLeadContext } from "./context";
import {
  emptyWorkbenchSnapshot,
  type CompanyRecord,
  type ContactRecord,
  type AuditRecord,
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
    website: company.website,
    industry: company.industry,
    size: company.size,
    location: company.location,
    status: company.status,
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

function toAuditRecord(log: typeof auditLogs.$inferSelect): AuditRecord {
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actorUserId: log.actorUserId,
    changes: log.changes,
    createdAt: log.createdAt.toISOString(),
  };
}

export async function getWorkbenchSnapshot(): Promise<WorkbenchSnapshot> {
  const context = await getLeadContext();

  if (!context) {
    return emptyWorkbenchSnapshot;
  }

  const db = getDatabase();
  const [companyRows, contactRows, pipelineRows, auditRows] = await Promise.all([
    db
      .select()
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId))
      .orderBy(desc(companies.createdAt)),
    db
      .select({ contact: contacts, companyName: companies.name })
      .from(contacts)
      .innerJoin(companies, eq(contacts.companyId, companies.id))
      .where(eq(contacts.organizationId, context.organizationId))
      .orderBy(desc(contacts.createdAt)),
    db
      .select({
        pipeline,
        companyName: companies.name,
        contactName: contacts.name,
      })
      .from(pipeline)
      .leftJoin(companies, eq(pipeline.companyId, companies.id))
      .leftJoin(contacts, eq(pipeline.contactId, contacts.id))
      .where(eq(pipeline.organizationId, context.organizationId))
      .orderBy(desc(pipeline.updatedAt)),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, context.organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  ]);

  return {
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
