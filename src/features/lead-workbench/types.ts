import type { PipelineStage } from "@/lib/db/pipeline";

export type WorkbenchPageInfo = Readonly<{
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}>;

export type WorkbenchQuery = Readonly<{
  companiesPage: number;
  contactsPage: number;
  pipelinePage: number;
  pageSize: number;
  companySearch: string;
  companyStatus?: string;
  contactSearch: string;
  contactCompanyId?: string;
}>;

export const defaultWorkbenchQuery: WorkbenchQuery = {
  companiesPage: 1,
  contactsPage: 1,
  pipelinePage: 1,
  pageSize: 50,
  companySearch: "",
  contactSearch: "",
};

export type CompanyRecord = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  status: string;
  enrichmentStatus: string;
  enrichmentError: string | null;
  icpScore: number | null;
  icpRationale: string | null;
  icpSignals: string[];
  researchSummary: string | null;
  researchPainPoints: string[];
  researchSignals: string[];
  callPrep: string | null;
  painPoints: string[];
  outreachDraft: string | null;
  enrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactRecord = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  notes: string | null;
  outreachDraft: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineRecord = {
  id: string;
  companyId: string | null;
  contactId: string | null;
  targetName: string;
  targetType: "company" | "contact";
  stage: PipelineStage;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditRecord = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type OrganizationMemberRecord = {
  id: string;
  email: string;
  fullName: string | null;
  role: "owner" | "admin" | "member";
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
};

export type OrganizationInvitationRecord = {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
};

export type CompanyOption = Readonly<{
  id: string;
  name: string;
}>;

export type WorkbenchMetrics = Readonly<{
  totalCompanies: number;
  totalContacts: number;
  totalPipeline: number;
  activePipeline: number;
  followUpsDue: number;
  processingCompanies: number;
  newSignals: number;
  stageCounts: Readonly<Record<PipelineStage, number>>;
  recentlyAdded: CompanyRecord[];
  duePipeline: PipelineRecord[];
}>;

export type WorkbenchSnapshot = {
  settings: WorkspaceSettings;
  members: OrganizationMemberRecord[];
  pendingInvitations: OrganizationInvitationRecord[];
  companies: CompanyRecord[];
  relatedCompanies: CompanyRecord[];
  contacts: ContactRecord[];
  pipeline: PipelineRecord[];
  auditLogs: AuditRecord[];
  companyOptions: CompanyOption[];
  metrics: WorkbenchMetrics;
  signalsByCompanyId: Readonly<Record<string, import("./signal-types").LeadSignal[]>>;
  pagination: Readonly<{
    companies: WorkbenchPageInfo;
    contacts: WorkbenchPageInfo;
    pipeline: WorkbenchPageInfo;
  }>;
};

export type WorkspaceSettings = {
  organizationName: string;
  currentUserId: string | null;
  defaultStage: PipelineStage;
  followUpDays: number;
  currentUserRole: "owner" | "admin" | "member";
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

export const emptyWorkbenchSnapshot: WorkbenchSnapshot = {
  settings: {
    organizationName: "Lead Intel Workspace",
    currentUserId: null,
    defaultStage: "new",
    followUpDays: 7,
    currentUserRole: "member",
  },
  members: [],
  pendingInvitations: [],
  companies: [],
  relatedCompanies: [],
  contacts: [],
  pipeline: [],
  auditLogs: [],
  companyOptions: [],
  metrics: {
    totalCompanies: 0,
    totalContacts: 0,
    totalPipeline: 0,
    activePipeline: 0,
    followUpsDue: 0,
    processingCompanies: 0,
    newSignals: 0,
    stageCounts: {
      new: 0,
      researching: 0,
      qualified: 0,
      contacted: 0,
      replied: 0,
      meeting: 0,
      won: 0,
      lost: 0,
    },
    recentlyAdded: [],
    duePipeline: [],
  },
  signalsByCompanyId: {},
  pagination: {
    companies: { page: 1, pageSize: 50, total: 0, pageCount: 1 },
    contacts: { page: 1, pageSize: 50, total: 0, pageCount: 1 },
    pipeline: { page: 1, pageSize: 50, total: 0, pageCount: 1 },
  },
};
