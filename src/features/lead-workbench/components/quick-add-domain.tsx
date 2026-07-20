"use client";

import { Loader2, Radar } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { triggerDomainIngestion } from "../actions";

export function QuickAddDomain({ onStarted }: Readonly<{ onStarted?: () => void }>) {
  const [domain, setDomain] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedDomain = domain.trim();
    if (!submittedDomain) return;

    startTransition(async () => {
      try {
        const result = await triggerDomainIngestion(submittedDomain);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }

        setDomain("");
        onStarted?.();
        toast.success(result.data.message);
      } catch {
        toast.error("Ingestion could not be started. Check your connection and try again.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-initial"
      aria-label="Quick add domain"
    >
      <div className="relative min-w-48 flex-1 sm:w-56 sm:flex-none">
        <Radar
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="stripe.com"
          aria-label="Company domain"
          autoComplete="url"
          disabled={isPending}
          className="pl-8"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={isPending || !domain.trim()}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Radar className="size-4" aria-hidden="true" />
        )}
        {isPending ? "Starting…" : "Quick add"}
      </Button>
    </form>
  );
}
