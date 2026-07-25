import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";

import {
  auditLogs,
  leadSignals,
  newsItems,
  companies,
  contacts,
  getDatabase,
  organizations,
  organizationInvitations,
  users,
  pipeline,
} from "@/lib/db";
import type { PipelineStage } from "@/lib/db/pipeline";

import { getLeadContext } from "./context";
import {
  emptyWorkbenchSnapshot,
  type CompanyRecord,
  type ContactRecord,
  type AuditRecord,
  type OrganizationMemberRecord,
  type OrganizationInvitationRecord,
  type PipelineRecord,
  defaultWorkbenchQuery,
  type WorkbenchPageInfo,
  type WorkbenchQuery,
  type WorkbenchSnapshot,
} from "../types";
import type { LeadSignal, LeadSignalType } from "../signal-types";

const MAX_COMPANY_OPTIONS = 5_000;
const RECENT_COMPANY_LIMIT = 5;
const DUE_PIPELINE_LIMIT = 20;
const SIGNAL_HISTORY_LIMIT = 200;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function pageInfo(page: number, pageSize: number, total: number): WorkbenchPageInfo {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function countValue(row: { count: number | string } | undefined): number {
  return Number(row?.count ?? 0);
}

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

function toLeadSignalRecord(row: {
  signal: typeof leadSignals.$inferSelect;
  article: typeof newsItems.$inferSelect | null;
}): LeadSignal | null {
  const signalType = row.signal.signalType === "unclassified" ? "other" : row.signal.signalType;
  const allowed: readonly LeadSignalType[] = [
    "ai_deployment",
    "vendor_partnership",
    "manual_review_hiring",
    "public_failure",
    "automation_commitment",
    "other",
  ];
  if (!allowed.includes(signalType as LeadSignalType)) return null;

  return {
    id: row.signal.id,
    signalType: signalType as LeadSignalType,
    title: row.article?.title ?? `${signalType.replaceAll("_", " ")} signal`,
    summary: row.signal.rationale ?? row.signal.recommendedAction ?? row.signal.evidence ?? "Signal detected.",
    workflow: row.signal.workflow,
    decisionMaker: row.signal.decisionMakerRole,
    confidence: row.signal.confidence,
    evidence: row.signal.evidence,
    sourceName: row.article?.publisher ?? row.article?.sourceDomain ?? null,
    sourceUrl: row.article?.canonicalUrl ?? null,
    publishedAt: row.article?.publishedAt?.toISOString() ?? null,
    createdAt: row.signal.createdAt.toISOString(),
    status: row.signal.status,
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
    metadata: row.log.metadata,
    createdAt: row.log.createdAt.toISOString(),
  };
}

export async function getWorkbenchSnapshot(
  query: WorkbenchQuery = defaultWorkbenchQuery,
): Promise<WorkbenchSnapshot> {
  const context = await getLeadContext();

  if (!context) {
    return emptyWorkbenchSnapshot;
  }

  const db = getDatabase();
  const companySearch = query.companySearch
    ? `%${escapeLike(query.companySearch)}%`
    : null;
  const contactSearch = query.contactSearch
    ? `%${escapeLike(query.contactSearch)}%`
    : null;
  const companyWhere = and(
    eq(companies.organizationId, context.organizationId),
    companySearch
      ? or(
          ilike(companies.name, companySearch),
          ilike(companies.domain, companySearch),
          ilike(companies.website, companySearch),
          ilike(companies.industry, companySearch),
          ilike(companies.location, companySearch),
          ilike(companies.status, companySearch),
        )
      : undefined,
    query.companyStatus ? eq(companies.status, query.companyStatus) : undefined,
  );
  const contactWhere = and(
    eq(contacts.organizationId, context.organizationId),
    query.contactCompanyId
      ? eq(contacts.companyId, query.contactCompanyId)
      : undefined,
    contactSearch
      ? or(
          ilike(contacts.name, contactSearch),
          ilike(contacts.title, contactSearch),
          ilike(contacts.email, contactSearch),
          ilike(contacts.linkedin, contactSearch),
          ilike(contacts.notes, contactSearch),
          ilike(companies.name, contactSearch),
          ilike(companies.domain, contactSearch),
        )
      : undefined,
  );
  const pipelineWhere = eq(pipeline.organizationId, context.organizationId);
  const activePipelineWhere = and(
    pipelineWhere,
    notInArray(pipeline.stage, ["won", "lost"]),
  );
  const duePipelineWhere = and(
    activePipelineWhere,
    isNotNull(pipeline.nextFollowUpAt),
    lte(pipeline.nextFollowUpAt, new Date()),
  );

  const [
    organizationRows,
    memberRows,
    invitationRows,
    companyRows,
    companyTotalRows,
    contactRows,
    contactTotalRows,
    pipelineRows,
    pipelineTotalRows,
    companyOptions,
    totalCompanyRows,
    totalContactRows,
    activePipelineRows,
    followUpRows,
    processingCompanyRows,
    newSignalRows,
    stageCountRows,
    recentCompanyRows,
    duePipelineRows,
    auditRows,
    signalRows,
  ] = await Promise.all([
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
      .where(companyWhere)
      .orderBy(desc(companies.createdAt), desc(companies.id))
      .limit(query.pageSize)
      .offset((query.companiesPage - 1) * query.pageSize),
    db
      .select({ count: count() })
      .from(companies)
      .where(companyWhere),
    db
      .select({ contact: contacts, company: companies })
      .from(contacts)
      .innerJoin(
        companies,
        and(
          eq(contacts.companyId, companies.id),
          eq(contacts.organizationId, companies.organizationId),
          eq(companies.organizationId, context.organizationId),
        ),
      )
      .where(contactWhere)
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(query.pageSize)
      .offset((query.contactsPage - 1) * query.pageSize),
    db
      .select({ count: count() })
      .from(contacts)
      .innerJoin(
        companies,
        and(
          eq(contacts.companyId, companies.id),
          eq(contacts.organizationId, companies.organizationId),
          eq(companies.organizationId, context.organizationId),
        ),
      )
      .where(contactWhere),
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
      .where(pipelineWhere)
      .orderBy(desc(pipeline.updatedAt), desc(pipeline.id))
      .limit(query.pageSize)
      .offset((query.pipelinePage - 1) * query.pageSize),
    db
      .select({ count: count() })
      .from(pipeline)
      .where(pipelineWhere),
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId))
      .orderBy(asc(companies.name), asc(companies.id))
      .limit(MAX_COMPANY_OPTIONS),
    db
      .select({ count: count() })
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId)),
    db
      .select({ count: count() })
      .from(contacts)
      .where(eq(contacts.organizationId, context.organizationId)),
    db
      .select({ count: count() })
      .from(pipeline)
      .where(activePipelineWhere),
    db
      .select({ count: count() })
      .from(pipeline)
      .where(duePipelineWhere),
    db
      .select({ count: count() })
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, context.organizationId),
          eq(companies.enrichmentStatus, "processing"),
        ),
      ),
    db
      .select({ count: count() })
      .from(leadSignals)
      .where(and(eq(leadSignals.organizationId, context.organizationId), eq(leadSignals.status, "new"))),
    db
      .select({ stage: pipeline.stage, count: count() })
      .from(pipeline)
      .where(pipelineWhere)
      .groupBy(pipeline.stage),
    db
      .select()
      .from(companies)
      .where(eq(companies.organizationId, context.organizationId))
      .orderBy(desc(companies.createdAt), desc(companies.id))
      .limit(RECENT_COMPANY_LIMIT),
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
      .where(duePipelineWhere)
      .orderBy(asc(pipeline.nextFollowUpAt), desc(pipeline.updatedAt))
      .limit(DUE_PIPELINE_LIMIT),
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
    db
      .select({ signal: leadSignals, article: newsItems })
      .from(leadSignals)
      .leftJoin(
        newsItems,
        and(
          eq(leadSignals.newsItemId, newsItems.id),
          eq(leadSignals.organizationId, newsItems.organizationId),
          eq(newsItems.organizationId, context.organizationId),
        ),
      )
      .where(eq(leadSignals.organizationId, context.organizationId))
      .orderBy(desc(leadSignals.createdAt))
      .limit(SIGNAL_HISTORY_LIMIT),
  ]);
  const currentUserRole =
    memberRows.find((member) => member.id === context.userId)?.role ?? "member";

  const stageCounts: Record<PipelineStage, number> = {
    new: 0,
    researching: 0,
    qualified: 0,
    contacted: 0,
    replied: 0,
    meeting: 0,
    won: 0,
    lost: 0,
  };
  for (const row of stageCountRows) {
    stageCounts[row.stage] = countValue(row);
  }
  const companyTotal = countValue(companyTotalRows[0]);
  const contactTotal = countValue(contactTotalRows[0]);
  const pipelineTotal = countValue(pipelineTotalRows[0]);
  const signalsByCompanyId: Record<string, LeadSignal[]> = {};
  for (const row of signalRows) {
    const signal = toLeadSignalRecord(row);
    if (!signal) continue;
    (signalsByCompanyId[row.signal.companyId] ??= []).push(signal);
  }

  return {
    settings: {
      organizationName: organizationRows[0]?.name ?? "Lead Intel Workspace",
      currentUserId: context.userId,
      defaultStage: organizationRows[0]?.defaultStage ?? "new",
      followUpDays: organizationRows[0]?.followUpDays ?? 7,
      currentUserRole,
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
    pendingInvitations:
      currentUserRole === "member"
        ? []
        : invitationRows.flatMap((invitation): OrganizationInvitationRecord[] =>
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
    relatedCompanies: Array.from(
      new Map(contactRows.map((row) => [row.company.id, toCompanyRecord(row.company)])).values(),
    ),
    contacts: contactRows.map((row) => toContactRecord(row.contact, row.company.name)),
    pipeline: pipelineRows.map(toPipelineRecord),
    auditLogs: auditRows.map(toAuditRecord),
    companyOptions,
    metrics: {
      totalCompanies: countValue(totalCompanyRows[0]),
      totalContacts: countValue(totalContactRows[0]),
      totalPipeline: pipelineTotal,
      activePipeline: countValue(activePipelineRows[0]),
      followUpsDue: countValue(followUpRows[0]),
      processingCompanies: countValue(processingCompanyRows[0]),
      newSignals: countValue(newSignalRows[0]),
      stageCounts,
      recentlyAdded: recentCompanyRows.map(toCompanyRecord),
      duePipeline: duePipelineRows.map(toPipelineRecord),
    },
    signalsByCompanyId,
    pagination: {
      companies: pageInfo(query.companiesPage, query.pageSize, companyTotal),
      contacts: pageInfo(query.contactsPage, query.pageSize, contactTotal),
      pipeline: pageInfo(query.pipelinePage, query.pageSize, pipelineTotal),
    },
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
