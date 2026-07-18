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
  icpScore: number | null;
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
  changes: Record<string, unknown>;
  createdAt: string;
};

export type WorkbenchSnapshot = {
  companies: CompanyRecord[];
  contacts: ContactRecord[];
  pipeline: PipelineRecord[];
  auditLogs: AuditRecord[];
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

export const emptyWorkbenchSnapshot: WorkbenchSnapshot = {
  companies: [],
  contacts: [],
  pipeline: [],
  auditLogs: [],
};
