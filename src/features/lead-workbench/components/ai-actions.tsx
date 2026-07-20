"use client";

import { useState, useTransition } from "react";
import { Bot, FileText, FlaskConical, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  draftOutreach,
  generateCallPrep,
  researchCompany,
  scoreICP,
} from "../server/ai-actions";
import type { CompanyRecord, ContactRecord } from "../types";

function companyData(company: CompanyRecord) {
  return {
    name: company.name,
    website: company.website ?? undefined,
    industry: company.industry ?? undefined,
    size: company.size ?? undefined,
    location: company.location ?? undefined,
    status: company.status,
  };
}

function isActionResponse(
  value: unknown,
): value is
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }

  if (value.ok === false) {
    return "error" in value && typeof value.error === "string";
  }

  return (
    value.ok === true &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null
  );
}

export function AiActionButtons({
  company,
  contact,
  onCompleted,
}: Readonly<{
  company: CompanyRecord;
  contact?: ContactRecord;
  onCompleted?: () => void;
}>) {
  const [isPending, startTransition] = useTransition();
  const [resultTitle, setResultTitle] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  function showFailure(error: string) {
    toast.error(error);
    setResultTitle(null);
    setResultText(null);
  }

  function run(action: string, request: () => Promise<unknown>) {
    startTransition(async () => {
      const response = await request();
      if (!isActionResponse(response)) {
        showFailure("The AI action returned an invalid response.");
        return;
      }
      if (!response.ok) {
        showFailure(response.error);
        return;
      }

      const data = response.data as Record<string, unknown>;
      setResultTitle(action);
      setResultText(
        typeof data.draft === "string"
          ? data.draft
          : typeof data.prep === "string"
            ? data.prep
            : JSON.stringify(data, null, 2),
      );
      onCompleted?.();
      toast.success(`${action} is ready`);
    });
  }

  const details = companyData(company);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          disabled={isPending || !company.website}
          title={company.website ? undefined : "Add a website first"}
          onClick={() =>
            run("Company research", () => researchCompany({ companyId: company.id, websiteUrl: company.website }))
          }
        >
          <FlaskConical className="size-4" aria-hidden="true" />
          Research company
        </Button>
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          disabled={isPending}
          onClick={() =>
            run("ICP score", () => scoreICP({ companyId: company.id, companyData: details }))
          }
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Score ICP fit
        </Button>
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          disabled={isPending}
          onClick={() =>
            run("Call prep", () => generateCallPrep({ companyId: company.id, companyData: details }))
          }
        >
          <FileText className="size-4" aria-hidden="true" />
          Generate call prep
        </Button>
        {contact && (
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            disabled={isPending}
            onClick={() =>
              run("Outreach draft", () =>
                draftOutreach({
                  contactId: contact.id,
                  contactData: {
                    name: contact.name,
                    title: contact.title ?? undefined,
                    email: contact.email ?? undefined,
                    notes: contact.notes ?? undefined,
                  },
                  companyData: details,
                }),
              )
            }
          >
            <Mail className="size-4" aria-hidden="true" />
            Draft outreach
          </Button>
        )}
      </div>

      {isPending && (
        <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground" role="status">
          <Bot className="size-4 animate-pulse" aria-hidden="true" />
          Working with the AI provider…
        </div>
      )}

      {resultTitle && resultText && (
        <Card className="bg-muted/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{resultTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-muted-foreground">
              {resultText}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
