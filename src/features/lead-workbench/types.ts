import type { PipelineStage } from "@/lib/db/pipeline";

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

export type WorkbenchSnapshot = {
  settings: WorkspaceSettings;
  members: OrganizationMemberRecord[];
  pendingInvitations: OrganizationInvitationRecord[];
  companies: CompanyRecord[];
  contacts: ContactRecord[];
  pipeline: PipelineRecord[];
  auditLogs: AuditRecord[];
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
  contacts: [],
  pipeline: [],
  auditLogs: [],
};
