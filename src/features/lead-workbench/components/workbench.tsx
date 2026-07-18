"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Plus,
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

import { companyStatuses } from "../validation";
import { pipelineStages, type PipelineStage } from "@/lib/db/schema";
import {
  deleteCompany,
  deleteContact,
  getLeads,
  updatePipeline,
} from "../server/actions";
import type {
  CompanyRecord,
  ContactRecord,
  AuditRecord,
  PipelineRecord,
  WorkbenchSnapshot,
} from "../types";
import { CompanyForm } from "./company-form";
import { ContactForm } from "./contact-form";
import { CsvImport } from "./csv-import";
import { AiActionButtons } from "./ai-actions";
import { LeadTable, type LeadTableColumn, type LeadTableFilter } from "./lead-table";

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

function isDue(value: string | null): boolean {
  return Boolean(value && new Date(value).getTime() <= Date.now());
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
  const recent = data.companies.slice(0, 5);
  const due = data.pipeline.filter((item) => isDue(item.nextFollowUpAt));
  const activePipeline = data.pipeline.filter(
    (item) => item.stage !== "won" && item.stage !== "lost",
  );
  const stageCounts = pipelineStages.map((stage) => ({
    stage,
    count: data.pipeline.filter((item) => item.stage === stage).length,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total leads"
          value={data.companies.length + data.contacts.length}
          hint={`${data.companies.length} companies · ${data.contacts.length} contacts`}
          icon={Target}
        />
        <KpiCard
          label="Active pipeline"
          value={activePipeline.length}
          hint={`${data.pipeline.length} tracked records total`}
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
          value={due.length}
          hint={due.length ? "Needs attention today" : "You are all caught up"}
          icon={CalendarClock}
          tone={due.length ? "warning" : "default"}
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
                    style={{ width: `${data.pipeline.length ? Math.max((count / data.pipeline.length) * 100, count ? 4 : 0) : 0}%` }}
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
}: Readonly<{
  data: WorkbenchSnapshot;
  onSelect: (item: PipelineRecord) => void;
  onStageChange: (item: PipelineRecord, stage: PipelineStage) => void;
}>) {
  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-3">
      {pipelineStages.map((stage) => {
        const items = data.pipeline.filter((item) => item.stage === stage);
        return (
          <section key={stage} className="w-72 shrink-0 rounded-xl bg-muted/50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <StagePill stage={stage} />
              <span className="text-xs text-muted-foreground">{items.length}</span>
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
                      <Select value={item.stage} onValueChange={(value) => value && onStageChange(item, value as PipelineStage)}>
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
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">No leads here</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AuditView({ logs }: Readonly<{ logs: AuditRecord[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit history</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          A tenant-scoped record of company, contact, and pipeline changes.
        </p>
      </CardHeader>
      <CardContent>
        {logs.length ? (
          <div className="divide-y rounded-lg border">
            {logs.map((log) => (
              <details key={log.id} className="group p-4">
                <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {log.action}
                  </span>
                  <span className="font-medium">{log.entityType}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{log.entityId}</span>
                  <time className="text-xs text-muted-foreground" dateTime={log.createdAt}>
                    {fullDate(log.createdAt)}
                  </time>
                </summary>
                <pre className="mt-3 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                  {JSON.stringify(log.changes, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Mutations will appear here once your organization starts working leads.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsView() {
  const [defaultStage, setDefaultStage] = useState<PipelineStage>("new");
  const [followUpDays, setFollowUpDays] = useState("7");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace preferences</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Defaults for this browser session. Organization-level settings can be persisted when that schema is introduced.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Default pipeline stage</span>
            <Select value={defaultStage} onValueChange={(value) => value && setDefaultStage(value as PipelineStage)}>
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
              />
              <span className="text-sm text-muted-foreground">days after first touch</span>
            </div>
          </label>
          <Button type="button" onClick={() => toast.success("Workspace preferences saved for this session")}>
            Save preferences
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
            ["AI provider", "Claude MCP actions are available when CLAUDE_MCP_ENDPOINT is configured."],
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
}: Readonly<{
  initialData: WorkbenchSnapshot;
  initialView?: WorkbenchView;
}>) {
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<WorkbenchView>(initialView);
  const [isRefreshing, startRefresh] = useTransition();
  const [companyDialog, setCompanyDialog] = useState<"create" | "edit" | null>(null);
  const [contactDialog, setContactDialog] = useState<"create" | "edit" | null>(null);
  const [editingCompany, setEditingCompany] = useState<CompanyRecord | null>(null);
  const [editingContact, setEditingContact] = useState<ContactRecord | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRecord | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRecord | null>(null);

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
              setSelectedCompany(row);
            }}
          >
            View <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [],
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
      { key: "linkedin", label: "LinkedIn", searchValue: (row) => row.linkedin ?? "", render: (row) => row.linkedin ? <a href={row.linkedin} target="_blank" rel="noreferrer" className="text-primary hover:underline">Profile</a> : "—" },
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
      options: data.companies.map((company) => ({ label: company.name, value: company.id })),
    },
  ];

  function refresh() {
    startRefresh(async () => {
      const next = await getLeads();
      setData(next);
    });
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
          row.id === item.id ? { ...row, stage: result.data.stage as PipelineStage, nextFollowUpAt: result.data.nextFollowUpAt } : row,
        ),
      }));
      setSelectedPipeline((current) =>
        current?.id === item.id
          ? { ...current, stage: result.data.stage as PipelineStage, nextFollowUpAt: result.data.nextFollowUpAt }
          : current,
      );
      toast.success(`Moved to ${stageLabels[stage]}`);
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
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
            Refresh
          </Button>
          <CsvImport onImported={refresh} />
          <Button type="button" size="sm" onClick={() => setCompanyDialog("create")}>
            <Plus className="size-4" aria-hidden="true" />
            Add company
          </Button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Lead workbench views">
        {(["dashboard", "pipeline", "companies", "contacts", "audit", "settings"] as WorkbenchView[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
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
      {view === "pipeline" && <PipelineView data={data} onSelect={setSelectedPipeline} onStageChange={changePipelineStage} />}
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
            <LeadTable rows={data.companies} columns={companyColumns} filters={companyFilters} searchPlaceholder="Search companies…" onSelect={setSelectedCompany} emptyMessage="No companies match those filters." />
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
            <Button type="button" size="sm" onClick={() => setContactDialog("create")} disabled={!data.companies.length}>
              <Plus className="size-4" aria-hidden="true" /> Add contact
            </Button>
          </CardHeader>
          <CardContent>
            <LeadTable rows={data.contacts} columns={contactColumns} filters={contactFilters} searchPlaceholder="Search contacts…" onSelect={setSelectedContact} emptyMessage="No contacts match those filters." />
          </CardContent>
        </Card>
      )}
      {view === "audit" && <AuditView logs={data.auditLogs} />}
      {view === "settings" && <SettingsView />}

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
            companies={data.companies}
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
              </div>
              <AiActionButtons company={selectedCompany} />
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
              {data.companies.find((company) => company.id === selectedContact.companyId) && (
                <AiActionButtons
                  company={data.companies.find((company) => company.id === selectedContact.companyId)!}
                  contact={selectedContact}
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
                  <Select value={selectedPipeline.stage} onValueChange={(value) => value && changePipelineStage(selectedPipeline, value as PipelineStage)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{pipelineStages.map((stage) => <SelectItem key={stage} value={stage}>{stageLabels[stage]}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">Next follow-up</p>
                  <p className="mt-1 font-medium">{fullDate(selectedPipeline.nextFollowUpAt)}</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
