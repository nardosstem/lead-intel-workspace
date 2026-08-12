"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Plus,
  Rss,
  RefreshCw,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

import { companyStatuses, isInvitationRole, isOrganizationRole } from "../validation";
import { triggerDomainIngestion, triggerNewsScan } from "../actions";
import { isPipelineStage, pipelineStages, type PipelineStage } from "@/lib/db/pipeline";
import {
  deleteCompany,
  deleteContact,
  getLeads,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  updateMemberStatus,
  setCompanyMonitoring,
  updateLeadSignalStatus,
  updateWorkspaceSettings,
  updatePipeline,
} from "../server/actions";
import type {
  CompanyRecord,
  ContactRecord,
  AuditRecord,
  OrganizationMemberRecord,
  OrganizationInvitationRecord,
  PipelineRecord,
  WorkbenchSnapshot,
  WorkbenchQuery,
  WorkspaceSettings,
} from "../types";
import { defaultWorkbenchQuery } from "../types";
import { CompanyForm } from "./company-form";
import { ContactForm } from "./contact-form";
import { CsvImport } from "./csv-import";
import { AiActionButtons } from "./ai-actions";
import {
  LeadTable,
  type LeadTableColumn,
  type LeadTableFilter,
  type LeadTableQuery,
} from "./lead-table";
import { QuickAddDomain } from "./quick-add-domain";
import { SignalPanel } from "./signal-panel";
import type { LeadSignal } from "../signal-types";

export type WorkbenchView =
  | "dashboard"
  | "pipeline"
  | "companies"
  | "contacts"
  | "audit"
  | "settings";

const stageLabels: Record<PipelineStage, string> = {
  new: "New",
  researching: "Researching",
  qualified: "Qualified",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
};

const stageColors: Record<PipelineStage, string> = {
  new: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  researching: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  qualified: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  contacted: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  replied: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  meeting: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  lost: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const statusLabels: Record<string, string> = {
  prospect: "Prospect",
  customer: "Customer",
  inactive: "Inactive",
};

const DUE_PIPELINE_DISPLAY_LIMIT = 20;

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function fullDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not scheduled";
}

function dateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isDue(value: string | null): boolean {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

function safeLinkedInHref(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function StatusPill({ value }: Readonly<{ value: string }>) {
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {statusLabels[value] ?? value}
    </span>
  );
}

function StagePill({ stage }: Readonly<{ stage: PipelineStage }>) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${stageColors[stage]}`}>
      {stageLabels[stage]}
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: Readonly<{
  label: string;
  value: string | number;
  hint: string;
  icon: typeof Building2;
  tone?: "default" | "warning" | "success";
}>) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <div
            className={`flex size-9 items-center justify-center rounded-lg ${
              tone === "warning"
                ? "bg-amber-500/10 text-amber-600"
                : tone === "success"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-primary/10 text-primary"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardView({
  data,
  onPipelineSelect,
}: Readonly<{
  data: WorkbenchSnapshot;
  onPipelineSelect: (item: PipelineRecord) => void;
}>) {
  const recent = data.metrics.recentlyAdded;
  const due = data.metrics.duePipeline.filter((item) => isDue(item.nextFollowUpAt));
  const stageCounts = pipelineStages.map((stage) => ({
    stage,
    count: data.metrics.stageCounts[stage],
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Total leads"
          value={data.metrics.totalCompanies + data.metrics.totalContacts}
          hint={`${data.metrics.totalCompanies} companies · ${data.metrics.totalContacts} contacts`}
          icon={Target}
        />
        <KpiCard
          label="Active pipeline"
          value={data.metrics.activePipeline}
          hint={`${data.metrics.totalPipeline} tracked records total`}
          icon={CircleDollarSign}
          tone="success"
        />
        <KpiCard
          label="Recently added"
          value={recent.length}
          hint={recent[0] ? `Latest on ${shortDate(recent[0].createdAt)}` : "No companies yet"}
          icon={Clock3}
        />
        <KpiCard
          label="Follow-ups due"
          value={data.metrics.followUpsDue}
          hint={data.metrics.followUpsDue > DUE_PIPELINE_DISPLAY_LIMIT
            ? `Needs attention today · showing first ${DUE_PIPELINE_DISPLAY_LIMIT}`
            : data.metrics.followUpsDue
              ? "Needs attention today"
              : "You are all caught up"}
          icon={CalendarClock}
          tone={due.length ? "warning" : "default"}
        />
        <KpiCard
          label="New signals"
          value={data.metrics.newSignals}
          hint={data.metrics.newSignals ? "Review this week’s intelligence" : "No unreviewed signals"}
          icon={Rss}
          tone={data.metrics.newSignals ? "warning" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Pipeline by stage</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Where active leads sit today.</p>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-3">
            {stageCounts.map(({ stage, count }) => (
              <button
                key={stage}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
                onClick={() => {
                  const item = data.pipeline.find((row) => row.stage === stage);
                  if (item) onPipelineSelect(item);
                }}
              >
                <StagePill stage={stage} />
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${data.metrics.totalPipeline ? Math.max((count / data.metrics.totalPipeline) * 100, count ? 4 : 0) : 0}%` }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-medium">{count}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently added</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">The latest companies in your workspace.</p>
          </CardHeader>
          <CardContent>
            {recent.length ? (
              <div className="space-y-3">
                {recent.map((company) => (
                  <div key={company.id} className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                      <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{company.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {company.industry ?? "Industry not set"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{shortDate(company.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Add a company to start building your pipeline.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-ups due</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Prioritize the next conversations.</p>
        </CardHeader>
        <CardContent>
          {due.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {due.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
                  onClick={() => onPipelineSelect(item)}
                >
                  <CalendarClock className="size-4 text-amber-600" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.targetName}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No follow-ups are due.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineView({
  data,
  onSelect,
  onStageChange,
  onPageChange,
  isLoading,
}: Readonly<{
  data: WorkbenchSnapshot;
  onSelect: (item: PipelineRecord) => void;
  onStageChange: (item: PipelineRecord, stage: PipelineStage) => void;
  onPageChange: (page: number) => void;
  isLoading: boolean;
}>) {
  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3">
      {pipelineStages.map((stage) => {
        const items = data.pipeline.filter((item) => item.stage === stage);
        const totalForStage = data.metrics.stageCounts[stage];
        return (
          <section key={stage} className="w-72 shrink-0 rounded-xl bg-muted/50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <StagePill stage={stage} />
              <span className="text-xs text-muted-foreground">{totalForStage}</span>
            </div>
            <div className="space-y-2">
              {items.length ? (
                items.map((item) => (
                  <Card key={item.id} className="bg-card">
                    <CardContent className="space-y-3 p-3">
                      <button type="button" className="block w-full text-left" onClick={() => onSelect(item)}>
                        <p className="truncate text-sm font-medium">{item.targetName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.targetType === "company" ? "Company" : "Contact"}
                          {item.nextFollowUpAt ? ` · ${shortDate(item.nextFollowUpAt)}` : ""}
                        </p>
                      </button>
                      <Select value={item.stage} onValueChange={(value) => isPipelineStage(value) && onStageChange(item, value)}>
                        <SelectTrigger className="h-7 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelineStages.map((option) => (
                            <SelectItem key={option} value={option}>
                              {stageLabels[option]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ))
              ) : totalForStage > 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  Leads on another page
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">No leads here</div>
              )}
            </div>
          </section>
        );
      })}
      {data.pagination.pipeline.pageCount > 1 ? (
        <div className="flex shrink-0 items-center gap-2 self-end pb-3 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(data.pagination.pipeline.page - 1)}
            disabled={isLoading || data.pagination.pipeline.page <= 1}
          >
            Previous
          </Button>
          <span aria-live="polite">
            Page {data.pagination.pipeline.page} of {data.pagination.pipeline.pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(data.pagination.pipeline.page + 1)}
            disabled={isLoading || data.pagination.pipeline.page >= data.pagination.pipeline.pageCount}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AuditView({ logs }: Readonly<{ logs: AuditRecord[] }>) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLogs = normalizedQuery
    ? logs.filter((log) =>
        [log.action, log.entityType, log.entityId, log.actorName, log.actorEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery)),
      )
    : logs;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit history</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          A tenant-scoped record of company, contact, and pipeline changes.
        </p>
      </CardHeader>
      <CardContent>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search actions, entities, or actors…"
          aria-label="Search audit history"
          className="mb-4"
        />
        {filteredLogs.length ? (
          <div className="divide-y rounded-lg border">
            {filteredLogs.map((log) => (
              <details key={log.id} className="group p-4">
                <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {log.action}
                  </span>
                  <span className="font-medium">{log.entityType}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{log.entityId}</span>
                  <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline" title={log.actorEmail ?? log.actorUserId ?? undefined}>
                    {log.actorName ?? log.actorEmail ?? "System"}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={log.createdAt}>
                    {fullDate(log.createdAt)}
                  </time>
                </summary>
                <pre className="mt-3 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                  {JSON.stringify({ changes: log.changes, metadata: log.metadata }, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {logs.length ? "No audit entries match this search." : "Mutations will appear here once your organization starts working leads."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsView({
  settings,
  members,
  pendingInvitations,
  onSaved,
  onMemberUpdated,
  onInvitationCreated,
  onInvitationRevoked,
}: Readonly<{
  settings: WorkspaceSettings;
  members: OrganizationMemberRecord[];
  pendingInvitations: OrganizationInvitationRecord[];
  onSaved: (settings: WorkspaceSettings) => void;
  onMemberUpdated: (member: OrganizationMemberRecord) => void;
  onInvitationCreated: (invitation: OrganizationInvitationRecord) => void;
  onInvitationRevoked: (invitationId: string) => void;
}>) {
  const [defaultStage, setDefaultStage] = useState<PipelineStage>(settings.defaultStage);
  const [followUpDays, setFollowUpDays] = useState(String(settings.followUpDays));
  const [isPending, startTransition] = useTransition();
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, startInviteTransition] = useTransition();

  function changeMemberRole(memberId: string, role: OrganizationMemberRecord["role"]) {
    const member = members.find((candidate) => candidate.id === memberId);
    if (member && (role === "owner" || member.role === "owner") &&
      !window.confirm(`Confirm changing ${member.email}'s role to ${role}.`)) {
      return;
    }
    setMemberError(null);
    setPendingMemberId(memberId);
    startTransition(async () => {
      try {
        const result = await updateMemberRole({ targetUserId: memberId, role });
        if (!result.ok) {
          setMemberError(result.error);
          return;
        }
        onMemberUpdated(result.data);
        toast.success("Member role updated");
      } catch {
        setMemberError("Member role could not be updated. Try again.");
      } finally {
        setPendingMemberId(null);
      }
    });
  }

  function changeMemberStatus(member: OrganizationMemberRecord) {
    const nextActive = !member.isActive;
    if (!nextActive && !window.confirm(`Deactivate ${member.email}'s workspace access?`)) return;
    setMemberError(null);
    setPendingMemberId(member.id);
    startTransition(async () => {
      try {
        const result = await updateMemberStatus({ targetUserId: member.id, isActive: nextActive });
        if (!result.ok) {
          setMemberError(result.error);
          return;
        }
        onMemberUpdated(result.data);
        toast.success(nextActive ? "Member access restored" : "Member access deactivated");
      } catch {
        setMemberError("Member access could not be updated. Try again.");
      } finally {
        setPendingMemberId(null);
      }
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateWorkspaceSettings({
          defaultStage,
          followUpDays,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onSaved(result.data);
        toast.success("Workspace preferences saved");
      } catch {
        setError("Preferences could not be saved. Try again.");
      }
    });
  }

  function submitInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    startInviteTransition(async () => {
      try {
        const result = await inviteMember({ email: inviteEmail, role: inviteRole });
        if (!result.ok) {
          setInviteError(result.error);
          return;
        }
        onInvitationCreated(result.data);
        setInviteEmail("");
        toast.success("Invitation sent");
      } catch {
        setInviteError("The invitation could not be sent. Try again.");
      }
    });
  }

  function revokePendingInvitation(invitation: OrganizationInvitationRecord) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    setInviteError(null);
    startInviteTransition(async () => {
      try {
        const result = await revokeInvitation(invitation.id);
        if (!result.ok) {
          setInviteError(result.error);
          return;
        }
        onInvitationRevoked(invitation.id);
        toast.success("Invitation revoked");
      } catch {
        setInviteError("The invitation could not be revoked. Try again.");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members and access</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Owners and admins can manage workspace roles. Members can manage leads but cannot change organization defaults.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {memberError ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{memberError}</p> : null}
          {members.length ? members.map((member) => (
            <div key={member.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.fullName ?? member.email}
                  {member.id === settings.currentUserId ? <span className="ml-2 text-xs font-normal text-muted-foreground">You</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                <p className={member.isActive ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-destructive"}>
                  {member.isActive ? "Active" : "Deactivated"}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={member.role}
                  onValueChange={(value) => isOrganizationRole(value) && changeMemberRole(member.id, value)}
                  disabled={settings.currentUserRole === "member" || !member.isActive || pendingMemberId === member.id || (member.role === "owner" && settings.currentUserRole !== "owner")}
                >
                  <SelectTrigger className="w-full sm:w-32" aria-label={`Role for ${member.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="owner" disabled={settings.currentUserRole !== "owner"}>Owner</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => changeMemberStatus(member)}
                  disabled={settings.currentUserRole === "member" || (member.role === "owner" && member.isActive) || pendingMemberId === member.id}
                >
                  {member.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No organization members found.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite teammates</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite a teammate by email. They will join this organization after accepting the Supabase email.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {inviteError ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{inviteError}</p> : null}
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submitInvitation}>
            <label className="min-w-0 flex-1 space-y-1.5 text-sm">
              <span className="font-medium">Email address</span>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@company.com"
                autoComplete="email"
                required
                disabled={settings.currentUserRole === "member" || isInviting}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Role</span>
              <Select value={inviteRole} onValueChange={(value) => isInvitationRole(value) && setInviteRole(value)} disabled={settings.currentUserRole === "member" || isInviting}>
                <SelectTrigger className="w-full sm:w-32" aria-label="Invitation role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button type="submit" disabled={settings.currentUserRole === "member" || isInviting}>
              {isInviting ? "Sending…" : "Send invite"}
            </Button>
          </form>
          {pendingInvitations.length ? (
            <div className="space-y-2" aria-label="Pending invitations">
              <p className="text-sm font-medium">Pending invitations</p>
              {pendingInvitations.map((invitation) => (
                <div key={invitation.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="block truncate">{invitation.email}</span>
                    <span className="text-xs text-muted-foreground">{invitation.role} · expires {shortDate(invitation.expiresAt)}</span>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => revokePendingInvitation(invitation)} disabled={settings.currentUserRole === "member" || isInviting}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          )}
          {settings.currentUserRole === "member" ? <p className="text-xs text-muted-foreground">Only owners and admins can invite teammates.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace preferences</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Persisted organization defaults used for newly created companies and contacts.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Default pipeline stage</span>
            <Select value={defaultStage} onValueChange={(value) => isPipelineStage(value) && setDefaultStage(value)} disabled={settings.currentUserRole === "member"}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{pipelineStages.map((stage) => <SelectItem key={stage} value={stage}>{stageLabels[stage]}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Default follow-up window</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={90}
                value={followUpDays}
                onChange={(event) => setFollowUpDays(event.target.value)}
                className="w-24"
                aria-label="Default follow-up days"
                disabled={settings.currentUserRole === "member"}
              />
              <span className="text-sm text-muted-foreground">days after first touch</span>
            </div>
          </label>
          <Button type="button" onClick={save} disabled={isPending || settings.currentUserRole === "member"}>
            {isPending ? "Saving…" : "Save preferences"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foundation settings</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Operational guarantees already enabled for this workspace.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ["Dark mode", "Use the theme control in the global header."],
            ["Audit history", "Company, contact, and pipeline mutations are recorded by database triggers."],
            ["Organization scope", "Every query and mutation is constrained to the authenticated organization."],
            ["AI provider", "Gemini is the default provider for public research; Claude MCP is an optional private-data fallback."],
          ].map(([label, description]) => (
            <div key={label} className="flex gap-3 rounded-lg border p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function LeadWorkbench({
  initialData,
  initialView = "dashboard",
  signalsByCompanyId = {},
}: Readonly<{
  initialData: WorkbenchSnapshot;
  initialView?: WorkbenchView;
  /** Optional server-provided signal history; the panel remains empty until monitoring is enabled. */
  signalsByCompanyId?: Readonly<Record<string, readonly LeadSignal[]>>;
}>) {
  const [data, setData] = useState(initialData);
  const [listQuery, setListQuery] = useState<WorkbenchQuery>(defaultWorkbenchQuery);
  const [view, setView] = useState<WorkbenchView>(initialView);
  const [isRefreshing, startRefresh] = useTransition();
  const [companyDialog, setCompanyDialog] = useState<"create" | "edit" | null>(null);
  const [contactDialog, setContactDialog] = useState<"create" | "edit" | null>(null);
  const [editingCompany, setEditingCompany] = useState<CompanyRecord | null>(null);
  const [editingContact, setEditingContact] = useState<ContactRecord | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRecord | null>(null);
  const [rssFeedUrl, setRssFeedUrl] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRecord | null>(null);
  const [isPollingIngestion, setIsPollingIngestion] = useState(false);
  const latestReadRef = useRef(0);
  const router = useRouter();

  const openCompany = useCallback((company: CompanyRecord) => {
    setSelectedCompany(company);
    setRssFeedUrl(data.monitoringByCompanyId[company.id]?.rssFeedUrl ?? "");
  }, [data.monitoringByCompanyId]);

  const hasActiveEnrichment = data.metrics.processingCompanies > 0;
  const companyOptions = useMemo(() => {
    const options = new Map(data.companyOptions.map((company) => [company.id, company]));
    for (const company of data.relatedCompanies) {
      options.set(company.id, { id: company.id, name: company.name });
    }
    return [...options.values()];
  }, [data.companyOptions, data.relatedCompanies]);

  useEffect(() => {
    if (!hasActiveEnrichment) return;

    const refreshTimer = window.setInterval(() => {
      const readId = ++latestReadRef.current;
      void getLeads(listQuery)
        .then((next) => {
          if (readId === latestReadRef.current) setData(next);
        })
        .catch(() => {
          // The foreground workspace remains usable with its last known data;
          // the next manual refresh will surface a current server response.
        });
    }, 5_000);

    return () => window.clearInterval(refreshTimer);
  }, [hasActiveEnrichment, listQuery]);

  useEffect(() => {
    if (!isPollingIngestion) return;

    let attempts = 0;
    const poll = () => {
      attempts += 1;
      const readId = ++latestReadRef.current;
      void getLeads(listQuery)
        .then((next) => {
          if (readId === latestReadRef.current) setData(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (attempts >= 15) setIsPollingIngestion(false);
        });
    };

    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => window.clearInterval(timer);
  }, [isPollingIngestion, listQuery]);

  const companyColumns = useMemo<LeadTableColumn<CompanyRecord>[]>(
    () => [
      {
        key: "name",
        label: "Company",
        searchValue: (row) => `${row.name} ${row.website ?? ""}`,
        render: (row) => (
          <div className="min-w-44">
            <p className="font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.website ?? "Website not set"}</p>
          </div>
        ),
      },
      { key: "industry", label: "Industry", searchValue: (row) => row.industry ?? "", render: (row) => row.industry ?? "—" },
      { key: "location", label: "Location", searchValue: (row) => row.location ?? "", render: (row) => row.location ?? "—" },
      { key: "status", label: "Status", searchValue: (row) => row.status, render: (row) => <StatusPill value={row.status} /> },
      { key: "createdAt", label: "Added", searchValue: (row) => row.createdAt, render: (row) => shortDate(row.createdAt) },
      {
        key: "actions",
        label: "",
        render: (row) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              openCompany(row);
            }}
          >
            View <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [openCompany],
  );

  const contactColumns = useMemo<LeadTableColumn<ContactRecord>[]>(
    () => [
      {
        key: "name",
        label: "Contact",
        searchValue: (row) => `${row.name} ${row.email ?? ""}`,
        render: (row) => (
          <div className="min-w-44">
            <p className="font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.email ?? "Email not set"}</p>
          </div>
        ),
      },
      { key: "company", label: "Company", searchValue: (row) => row.companyName, render: (row) => row.companyName },
      { key: "title", label: "Title", searchValue: (row) => row.title ?? "", render: (row) => row.title ?? "—" },
      {
        key: "linkedin",
        label: "LinkedIn",
        searchValue: (row) => row.linkedin ?? "",
        render: (row) => {
          const href = safeLinkedInHref(row.linkedin);
          return href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              Profile
            </a>
          ) : "—";
        },
      },
      { key: "createdAt", label: "Added", searchValue: (row) => row.createdAt, render: (row) => shortDate(row.createdAt) },
      {
        key: "actions",
        label: "",
        render: (row) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedContact(row);
            }}
          >
            View <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [],
  );

  const companyFilters: LeadTableFilter<CompanyRecord>[] = [
    {
      key: "status",
      label: "Status",
      value: (row) => row.status,
      options: companyStatuses.map((status) => ({ label: statusLabels[status], value: status })),
    },
  ];
  const contactFilters: LeadTableFilter<ContactRecord>[] = [
    {
      key: "company",
      label: "Company",
      value: (row) => row.companyId,
      options: companyOptions.map((company) => ({ label: company.name, value: company.id })),
    },
  ];

  function refresh(query = listQuery) {
    const readId = ++latestReadRef.current;
    setListQuery(query);
    startRefresh(async () => {
      try {
        const next = await getLeads(query);
        if (readId === latestReadRef.current) setData(next);
      } catch {
        toast.error("Could not refresh the workspace. Try again.");
      }
    });
  }

  function loadListQuery(query: WorkbenchQuery) {
    const readId = ++latestReadRef.current;
    setListQuery(query);
    startRefresh(async () => {
      try {
        const next = await getLeads(query);
        if (readId === latestReadRef.current) setData(next);
      } catch {
        toast.error("Could not load that page. Try again.");
      }
    });
  }

  function changeCompanyQuery(tableQuery: LeadTableQuery) {
    loadListQuery({
      ...listQuery,
      companiesPage: tableQuery.page,
      companySearch: tableQuery.query,
      companyStatus: tableQuery.filters.status || undefined,
    });
  }

  function changeContactQuery(tableQuery: LeadTableQuery) {
    loadListQuery({
      ...listQuery,
      contactsPage: tableQuery.page,
      contactSearch: tableQuery.query,
      contactCompanyId: tableQuery.filters.company || undefined,
    });
  }

  function changePipelinePage(page: number) {
    loadListQuery({ ...listQuery, pipelinePage: page });
  }

  function changeView(nextView: WorkbenchView) {
    setView(nextView);
    router.replace(nextView === "dashboard" ? "/leads" : `/leads?view=${nextView}`, { scroll: false });
  }

  function updateCompanyInState(company: CompanyRecord) {
    setData((current) => ({
      ...current,
      companies: current.companies.some((row) => row.id === company.id)
        ? current.companies.map((row) => (row.id === company.id ? company : row))
        : [company, ...current.companies],
    }));
    setSelectedCompany(null);
    setEditingCompany(null);
    setCompanyDialog(null);
    refresh();
  }

  function updateContactInState(contact: ContactRecord) {
    setData((current) => ({
      ...current,
      contacts: current.contacts.some((row) => row.id === contact.id)
        ? current.contacts.map((row) => (row.id === contact.id ? contact : row))
        : [contact, ...current.contacts],
    }));
    setSelectedContact(null);
    setEditingContact(null);
    setContactDialog(null);
    refresh();
  }

  function changePipelineStage(item: PipelineRecord, stage: PipelineStage) {
    startRefresh(async () => {
      const result = await updatePipeline({ id: item.id, stage, nextFollowUpAt: item.nextFollowUpAt });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setData((current) => ({
        ...current,
        pipeline: current.pipeline.map((row) =>
          row.id === item.id ? { ...row, stage: result.data.stage, nextFollowUpAt: result.data.nextFollowUpAt } : row,
        ),
      }));
      setSelectedPipeline((current) =>
        current?.id === item.id
          ? { ...current, stage: result.data.stage, nextFollowUpAt: result.data.nextFollowUpAt }
          : current,
      );
      toast.success(`Moved to ${stageLabels[stage]}`);
      refresh();
    });
  }

  function changePipelineFollowUp(item: PipelineRecord, value: string) {
    startRefresh(async () => {
      const result = await updatePipeline({
        id: item.id,
        stage: item.stage,
        nextFollowUpAt: value ? new Date(value).toISOString() : null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setData((current) => ({
        ...current,
        pipeline: current.pipeline.map((row) =>
          row.id === item.id
            ? { ...row, nextFollowUpAt: result.data.nextFollowUpAt }
            : row,
        ),
      }));
      setSelectedPipeline((current) =>
        current?.id === item.id
          ? { ...current, nextFollowUpAt: result.data.nextFollowUpAt }
          : current,
      );
      toast.success(value ? "Follow-up scheduled" : "Follow-up cleared");
      refresh();
    });
  }

  function retryEnrichment(company: CompanyRecord) {
    const domain = company.domain ?? company.website;
    if (!domain) {
      toast.error("Add a company website before retrying enrichment.");
      return;
    }

    startRefresh(async () => {
      const result = await triggerDomainIngestion(domain);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setSelectedCompany((current) =>
        current?.id === company.id
          ? { ...current, enrichmentStatus: "processing", enrichmentError: null }
          : current,
      );
      toast.success(result.data.message);
      refresh();
    });
  }

  function startNewsScan() {
    startRefresh(async () => {
      const result = await triggerNewsScan();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message);
    });
  }

  function monitorCompany(company: CompanyRecord) {
    startRefresh(async () => {
      const result = await setCompanyMonitoring({ companyId: company.id, enabled: true });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Company added to weekly signal monitoring");
      refresh();
    });
  }

  function pauseCompanyMonitoring(company: CompanyRecord) {
    startRefresh(async () => {
      const result = await setCompanyMonitoring({ companyId: company.id, enabled: false });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Company removed from weekly signal monitoring");
      refresh();
    });
  }

  function saveCompanyMonitoring(company: CompanyRecord) {
    startRefresh(async () => {
      const result = await setCompanyMonitoring({
        companyId: company.id,
        enabled: true,
        rssFeedUrl: rssFeedUrl.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Monitoring settings saved");
      refresh();
    });
  }

  function changeSignalStatus(signalId: string, status: "reviewed" | "dismissed") {
    startRefresh(async () => {
      const result = await updateLeadSignalStatus({ id: signalId, status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setData((current) => ({
        ...current,
        signalsByCompanyId: Object.fromEntries(
          Object.entries(current.signalsByCompanyId).map(([companyId, signals]) => [
            companyId,
            signals.map((signal) => signal.id === signalId ? { ...signal, status } : signal),
          ]),
        ),
        metrics: {
          ...current.metrics,
          newSignals: Math.max(0, current.metrics.newSignals - 1),
        },
      }));
      toast.success(status === "reviewed" ? "Signal marked reviewed" : "Signal dismissed");
    });
  }

  function confirmDeleteCompany(company: CompanyRecord) {
    if (!window.confirm(`Delete ${company.name} and its contacts?`)) return;
    startRefresh(async () => {
      const result = await deleteCompany(company.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Company deleted");
        setSelectedCompany(null);
        refresh();
      }
    });
  }

  function confirmDeleteContact(contact: ContactRecord) {
    if (!window.confirm(`Delete ${contact.name}?`)) return;
    startRefresh(async () => {
      const result = await deleteContact(contact.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Contact deleted");
        setSelectedContact(null);
        refresh();
      }
    });
  }

  const pageTitle: Record<WorkbenchView, string> = {
    dashboard: "Overview",
    pipeline: "Pipeline",
    companies: "Companies",
    contacts: "Contacts",
    audit: "Audit history",
    settings: "Settings",
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Lead intelligence workbench</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{pageTitle[view]}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Research, qualify, and move every opportunity forward from one focused workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => refresh()} disabled={isRefreshing}>
            <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
            Refresh
          </Button>
          {view === "dashboard" && (
            <QuickAddDomain
              onStarted={() => {
                setIsPollingIngestion(true);
                refresh();
              }}
            />
          )}
          {view === "dashboard" && (
            <Button type="button" variant="outline" size="sm" onClick={startNewsScan} disabled={isRefreshing}>
              <Rss className={isRefreshing ? "size-4 animate-pulse" : "size-4"} aria-hidden="true" />
              Scan news
            </Button>
          )}
          <CsvImport onImported={refresh} />
          <Button type="button" size="sm" onClick={() => setCompanyDialog("create")}>
            <Plus className="size-4" aria-hidden="true" />
            Add company
          </Button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Lead workbench views">
        {(["dashboard", "pipeline", "companies", "contacts", "audit", "settings"] satisfies WorkbenchView[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => changeView(item)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              view === item ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            aria-current={view === item ? "page" : undefined}
          >
            {pageTitle[item]}
          </button>
        ))}
      </nav>

      {view === "dashboard" && <DashboardView data={data} onPipelineSelect={setSelectedPipeline} />}
      {view === "pipeline" && (
        <PipelineView
          data={data}
          onSelect={setSelectedPipeline}
          onStageChange={changePipelineStage}
          onPageChange={changePipelinePage}
          isLoading={isRefreshing}
        />
      )}
      {view === "companies" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Company directory</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Search by name, industry, location, or status.</p>
            </div>
            <Button type="button" size="sm" onClick={() => setCompanyDialog("create")}>
              <Plus className="size-4" aria-hidden="true" /> Add company
            </Button>
          </CardHeader>
          <CardContent>
            <LeadTable
              rows={data.companies}
              columns={companyColumns}
              filters={companyFilters}
              searchPlaceholder="Search companies…"
              onSelect={openCompany}
              pagination={data.pagination.companies}
              onQueryChange={changeCompanyQuery}
              queryState={{
                query: listQuery.companySearch,
                filters: { status: listQuery.companyStatus ?? "" },
              }}
              isLoading={isRefreshing}
              emptyMessage="No companies match those filters."
            />
          </CardContent>
        </Card>
      )}
      {view === "contacts" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Contact directory</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Search people and filter by company.</p>
            </div>
            <Button type="button" size="sm" onClick={() => setContactDialog("create")} disabled={!data.metrics.totalCompanies}>
              <Plus className="size-4" aria-hidden="true" /> Add contact
            </Button>
          </CardHeader>
          <CardContent>
            <LeadTable
              rows={data.contacts}
              columns={contactColumns}
              filters={contactFilters}
              searchPlaceholder="Search contacts…"
              onSelect={setSelectedContact}
              pagination={data.pagination.contacts}
              onQueryChange={changeContactQuery}
              queryState={{
                query: listQuery.contactSearch,
                filters: { company: listQuery.contactCompanyId ?? "" },
              }}
              isLoading={isRefreshing}
              emptyMessage="No contacts match those filters."
            />
          </CardContent>
        </Card>
      )}
      {view === "audit" && <AuditView logs={data.auditLogs} />}
      {view === "settings" && (
        <SettingsView
          key={`${data.settings.defaultStage}-${data.settings.followUpDays}-${data.members.map((member) => `${member.id}:${member.role}:${member.isActive}`).join(",")}-${data.pendingInvitations.map((invitation) => invitation.id).join(",")}`}
          settings={data.settings}
          members={data.members}
          pendingInvitations={data.pendingInvitations}
          onSaved={(settings) => setData((current) => ({ ...current, settings }))}
          onMemberUpdated={(updatedMember) => setData((current) => ({
            ...current,
            settings: updatedMember.id === current.settings.currentUserId
              ? { ...current.settings, currentUserRole: updatedMember.role }
              : current.settings,
            members: current.members.map((member) => member.id === updatedMember.id ? updatedMember : member),
          }))}
          onInvitationCreated={(invitation) => setData((current) => ({
            ...current,
            pendingInvitations: [invitation, ...current.pendingInvitations.filter((item) => item.id !== invitation.id)],
          }))}
          onInvitationRevoked={(invitationId) => setData((current) => ({
            ...current,
            pendingInvitations: current.pendingInvitations.filter((invitation) => invitation.id !== invitationId),
          }))}
        />
      )}

      <Dialog open={companyDialog !== null} onOpenChange={(open) => !open && setCompanyDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{companyDialog === "edit" ? "Edit company" : "Add company"}</DialogTitle>
            <DialogDescription>Keep company context structured so research and follow-up stay useful.</DialogDescription>
          </DialogHeader>
          <CompanyForm
            initial={companyDialog === "edit" ? editingCompany ?? undefined : undefined}
            onSaved={updateCompanyInState}
            onCancel={() => setCompanyDialog(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={contactDialog !== null} onOpenChange={(open) => !open && setContactDialog(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{contactDialog === "edit" ? "Edit contact" : "Add contact"}</DialogTitle>
            <DialogDescription>Capture the person and context that make the next touch relevant.</DialogDescription>
          </DialogHeader>
          <ContactForm
            companies={companyOptions}
            initial={contactDialog === "edit" ? editingContact ?? undefined : undefined}
            onSaved={updateContactInState}
            onCancel={() => setContactDialog(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={selectedCompany !== null} onOpenChange={(open) => !open && setSelectedCompany(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selectedCompany && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedCompany.name}</DialogTitle>
                <DialogDescription>{selectedCompany.website ?? "No website provided"}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Industry</p><p className="mt-1 font-medium">{selectedCompany.industry ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Size</p><p className="mt-1 font-medium">{selectedCompany.size ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Location</p><p className="mt-1 font-medium">{selectedCompany.location ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><div className="mt-1"><StatusPill value={selectedCompany.status} /></div></div>
                <div><p className="text-xs text-muted-foreground">Enrichment</p><p className="mt-1 font-medium capitalize">{selectedCompany.enrichmentStatus}</p></div>
                <div><p className="text-xs text-muted-foreground">ICP score</p><p className="mt-1 font-medium">{selectedCompany.icpScore ?? "—"}{selectedCompany.icpScore === null ? "" : "/100"}</p></div>
              </div>
              <SignalPanel
                signals={data.signalsByCompanyId[selectedCompany.id] ?? signalsByCompanyId[selectedCompany.id] ?? []}
                lastScannedAt={data.monitoringByCompanyId[selectedCompany.id]?.lastScannedAt}
                onStatusChange={changeSignalStatus}
              />
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Weekly signal monitoring</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.monitoringByCompanyId[selectedCompany.id]?.enabled
                      ? "Monitoring is enabled for this company."
                      : "Monitoring is paused for this company."} Track public AI, hiring, partnership, failure, and automation signals.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => data.monitoringByCompanyId[selectedCompany.id]?.enabled
                    ? pauseCompanyMonitoring(selectedCompany)
                    : monitorCompany(selectedCompany)}
                  disabled={isRefreshing}
                >
                  <Rss className="size-4" aria-hidden="true" />
                  {data.monitoringByCompanyId[selectedCompany.id]?.enabled ? "Pause monitoring" : "Monitor company"}
                </Button>
                <div className="flex w-full flex-wrap items-center gap-2 pt-2">
                  <Input
                    value={rssFeedUrl}
                    onChange={(event) => setRssFeedUrl(event.target.value)}
                    placeholder="Optional public RSS feed URL"
                    aria-label="Company RSS feed URL"
                    className="min-w-56 flex-1"
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={() => saveCompanyMonitoring(selectedCompany)} disabled={isRefreshing}>
                    Save feed
                  </Button>
                </div>
              </div>
              {selectedCompany.enrichmentError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
                  <p className="font-medium">Enrichment failed</p>
                  <p className="mt-1 text-destructive/80">{selectedCompany.enrichmentError}. Retry after checking provider configuration.</p>
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => retryEnrichment(selectedCompany)} disabled={isRefreshing}>
                    <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
                    Retry enrichment
                  </Button>
                </div>
              ) : null}
              {selectedCompany.painPoints.length > 0 && (
                <div className="rounded-lg border p-4 text-sm">
                  <p className="font-medium">Likely pain points</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {selectedCompany.painPoints.map((painPoint) => <li key={painPoint}>{painPoint}</li>)}
                  </ul>
                </div>
              )}
              {selectedCompany.researchSummary ? (
                <details className="rounded-lg border p-4 text-sm" open>
                  <summary className="cursor-pointer font-medium">Company research</summary>
                  <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{selectedCompany.researchSummary}</p>
                  {selectedCompany.researchSignals.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
                      {selectedCompany.researchSignals.map((signal) => <li key={signal}>{signal}</li>)}
                    </ul>
                  ) : null}
                </details>
              ) : null}
              {selectedCompany.icpRationale ? (
                <details className="rounded-lg border p-4 text-sm">
                  <summary className="cursor-pointer font-medium">ICP rationale</summary>
                  <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{selectedCompany.icpRationale}</p>
                  {selectedCompany.icpSignals.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
                      {selectedCompany.icpSignals.map((signal) => <li key={signal}>{signal}</li>)}
                    </ul>
                  ) : null}
                </details>
              ) : null}
              {selectedCompany.callPrep ? (
                <details className="rounded-lg border p-4 text-sm">
                  <summary className="cursor-pointer font-medium">Call preparation</summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">{selectedCompany.callPrep}</pre>
                </details>
              ) : null}
              {selectedCompany.outreachDraft && (
                <details className="rounded-lg border p-4 text-sm">
                  <summary className="cursor-pointer font-medium">Generated outreach draft</summary>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">{selectedCompany.outreachDraft}</pre>
                </details>
              )}
              <AiActionButtons company={selectedCompany} onCompleted={refresh} />
              <DialogFooter>
                <Button type="button" variant="destructive" onClick={() => confirmDeleteCompany(selectedCompany)}>Delete</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingCompany(selectedCompany);
                    setSelectedCompany(null);
                    setCompanyDialog("edit");
                  }}
                >
                  Edit company
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={selectedContact !== null} onOpenChange={(open) => !open && setSelectedContact(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selectedContact && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedContact.name}</DialogTitle>
                <DialogDescription>{selectedContact.title ?? "Contact"} · {selectedContact.companyName}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
                <p><span className="text-muted-foreground">Email:</span> {selectedContact.email ?? "—"}</p>
                <p><span className="text-muted-foreground">LinkedIn:</span> {selectedContact.linkedin ?? "—"}</p>
                <p><span className="text-muted-foreground">Notes:</span> {selectedContact.notes ?? "—"}</p>
              </div>
              {selectedContact.outreachDraft ? (
                <details className="rounded-lg border p-4 text-sm" open>
                  <summary className="cursor-pointer font-medium">Generated outreach draft</summary>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground">{selectedContact.outreachDraft}</pre>
                </details>
              ) : null}
              {(data.relatedCompanies.find((company) => company.id === selectedContact.companyId) ??
                data.companies.find((company) => company.id === selectedContact.companyId)) && (
                <AiActionButtons
                  company={data.relatedCompanies.find((company) => company.id === selectedContact.companyId) ??
                    data.companies.find((company) => company.id === selectedContact.companyId)!}
                  contact={selectedContact}
                  onCompleted={refresh}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="destructive" onClick={() => confirmDeleteContact(selectedContact)}>Delete</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingContact(selectedContact);
                    setSelectedContact(null);
                    setContactDialog("edit");
                  }}
                >
                  Edit contact
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={selectedPipeline !== null} onOpenChange={(open) => !open && setSelectedPipeline(null)}>
        <DialogContent className="max-w-lg">
          {selectedPipeline && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedPipeline.targetName}</DialogTitle>
                <DialogDescription>Pipeline record · {selectedPipeline.targetType}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <StagePill stage={selectedPipeline.stage} />
                  <span className="text-xs text-muted-foreground">Updated {fullDate(selectedPipeline.updatedAt)}</span>
                </div>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Stage</span>
                  <Select value={selectedPipeline.stage} onValueChange={(value) => isPipelineStage(value) && changePipelineStage(selectedPipeline, value)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{pipelineStages.map((stage) => <SelectItem key={stage} value={stage}>{stageLabels[stage]}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <div className="rounded-lg border p-3 text-sm">
                  <label className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">Next follow-up</span>
                    <Input
                      type="datetime-local"
                      value={dateTimeLocalValue(selectedPipeline.nextFollowUpAt)}
                      onChange={(event) => changePipelineFollowUp(selectedPipeline, event.target.value)}
                      disabled={isRefreshing}
                      aria-label="Next follow-up date and time"
                    />
                  </label>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {fullDate(selectedPipeline.nextFollowUpAt)}
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
