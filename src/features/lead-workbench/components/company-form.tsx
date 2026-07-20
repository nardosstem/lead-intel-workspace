"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { companyStatuses } from "../validation";
import { createCompany, updateCompany } from "../server/actions";
import type { ActionResult, CompanyRecord } from "../types";

function FieldError({ message }: Readonly<{ message?: string }>) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

export function CompanyForm({
  initial,
  onSaved,
  onCancel,
}: Readonly<{
  initial?: CompanyRecord;
  onSaved: (company: CompanyRecord) => void;
  onCancel?: () => void;
}>) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      ...(initial ? { id: initial.id } : {}),
      name: form.get("name"),
      website: form.get("website"),
      industry: form.get("industry"),
      size: form.get("size"),
      location: form.get("location"),
      status: form.get("status"),
    };

    startTransition(async () => {
      try {
        const result: ActionResult<CompanyRecord> = initial
          ? await updateCompany(input)
          : await createCompany(input);
        if (result.ok) {
          toast.success(initial ? "Company updated" : "Company added");
          onSaved(result.data);
          return;
        }
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      } catch {
        setError("The company could not be saved. Check your connection and try again.");
        setFieldErrors({});
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Company name</span>
          <Input name="name" required defaultValue={initial?.name} placeholder="Acme, Inc." />
          <FieldError message={fieldErrors.name?.[0]} />
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Website</span>
          <Input name="website" type="url" defaultValue={initial?.website ?? ""} placeholder="https://example.com" />
          <FieldError message={fieldErrors.website?.[0]} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Industry</span>
          <Input name="industry" defaultValue={initial?.industry ?? ""} placeholder="B2B SaaS" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Company size</span>
          <Input name="size" defaultValue={initial?.size ?? ""} placeholder="51-200" />
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Location</span>
          <Input name="location" defaultValue={initial?.location ?? ""} placeholder="New York, NY" />
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Status</span>
          <Select name="status" defaultValue={initial?.status ?? "prospect"}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose status" />
            </SelectTrigger>
            <SelectContent>
              {companyStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status[0].toUpperCase() + status.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : initial ? "Save changes" : "Add company"}
        </Button>
      </div>
    </form>
  );
}
