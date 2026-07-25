"use client";

import {
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  ExternalLink,
  Handshake,
  ListChecks,
  Radar,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  formatSignalConfidence,
  formatSignalDate,
  leadSignalTypeLabels,
  safeSignalSourceHref,
  type LeadSignal,
  type LeadSignalType,
} from "../signal-types";

const signalIcons: Readonly<Record<LeadSignalType, typeof Radar>> = {
  ai_deployment: Bot,
  vendor_partnership: Handshake,
  manual_review_hiring: BriefcaseBusiness,
  public_failure: ShieldAlert,
  automation_commitment: Radar,
  other: AlertTriangle,
};

export type SignalPanelProps = Readonly<{
  signals?: readonly LeadSignal[];
  lastScannedAt?: string | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}>;

function SignalCard({ signal }: Readonly<{ signal: LeadSignal }>) {
  const Icon = signalIcons[signal.signalType];
  const sourceHref = safeSignalSourceHref(signal.sourceUrl);
  const publishedDate = formatSignalDate(signal.publishedAt);
  const confidence = formatSignalConfidence(signal.confidence);

  return (
    <article className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {leadSignalTypeLabels[signal.signalType]}
            </span>
            {confidence ? <span className="text-xs text-muted-foreground">{confidence}</span> : null}
          </div>
          <h4 className="mt-2 text-sm font-medium">{signal.title}</h4>
          {signal.summary ? <p className="mt-1 text-sm text-muted-foreground">{signal.summary}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Likely workflow</p>
            <p className="mt-0.5 break-words font-medium">{signal.workflow ?? "Not mapped yet"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Likely decision-maker</p>
            <p className="mt-0.5 break-words font-medium">{signal.decisionMaker ?? "Not mapped yet"}</p>
          </div>
        </div>
      </div>

      {signal.evidence ? (
        <p className="mt-3 border-l-2 pl-3 text-xs italic text-muted-foreground">“{signal.evidence}”</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {publishedDate ? <time dateTime={signal.publishedAt ?? undefined}>Published {publishedDate}</time> : null}
        {sourceHref ? (
          <a
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {signal.sourceName ?? "View source"}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : signal.sourceName ? (
          <span>{signal.sourceName}</span>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Company-level signal history. It is intentionally data-in/data-out so the
 * scanner and persistence layer can be introduced without coupling the UI to
 * a provider, scheduler, or database query.
 */
export function SignalPanel({
  signals = [],
  lastScannedAt = null,
  isLoading = false,
  onRefresh,
}: SignalPanelProps) {
  const scannedDate = formatSignalDate(lastScannedAt);

  return (
    <Card aria-busy={isLoading}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Radar className="size-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">Signal monitor</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              News signals that may indicate a timely workflow conversation.
            </p>
            {scannedDate ? <p className="mt-1 text-xs text-muted-foreground">Last scanned {scannedDate}</p> : null}
          </div>
        </div>
        {onRefresh ? (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Scanning…" : "Scan now"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading && signals.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" role="status">
            Looking for recent company signals…
          </div>
        ) : signals.length ? (
          <div className="space-y-3" aria-label="Company signals">
            {signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Radar className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No signals yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Weekly monitoring will surface AI deployments, partnerships, hiring signals, public failures, and automation commitments here.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
