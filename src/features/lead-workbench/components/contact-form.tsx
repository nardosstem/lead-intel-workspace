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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import { createContact, updateContact } from "../server/actions";
import type { ActionResult, CompanyRecord, ContactRecord } from "../types";

export function ContactForm({
  companies,
  initial,
  onSaved,
  onCancel,
}: Readonly<{
  companies: CompanyRecord[];
  initial?: ContactRecord;
  onSaved: (contact: ContactRecord) => void;
  onCancel?: () => void;
}>) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      ...(initial ? { id: initial.id } : {}),
      companyId: form.get("companyId"),
      name: form.get("name"),
      title: form.get("title"),
      email: form.get("email"),
      linkedin: form.get("linkedin"),
      notes: form.get("notes"),
    };

    startTransition(async () => {
      const result: ActionResult<ContactRecord> = initial
        ? await updateContact(input)
        : await createContact(input);
      if (result.ok) {
        toast.success(initial ? "Contact updated" : "Contact added");
        onSaved(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        Add a company before adding a contact.
      </div>
    );
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
          <span className="font-medium">Company</span>
          <Select name="companyId" defaultValue={initial?.companyId} required>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  {company.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Name</span>
          <Input name="name" required defaultValue={initial?.name} placeholder="Alex Morgan" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Title</span>
          <Input name="title" defaultValue={initial?.title ?? ""} placeholder="VP of Sales" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Email</span>
          <Input name="email" type="email" defaultValue={initial?.email ?? ""} placeholder="alex@example.com" />
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">LinkedIn</span>
          <Input name="linkedin" type="url" defaultValue={initial?.linkedin ?? ""} placeholder="https://linkedin.com/in/alex" />
        </label>
        <label className="space-y-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Notes</span>
          <Textarea name="notes" defaultValue={initial?.notes ?? ""} placeholder="Context for future research…" rows={4} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : initial ? "Save changes" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
