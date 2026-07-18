"use server";

import { z } from "zod";

import { AIProviderError } from "@/lib/ai";

import { getAIProvider } from "@/lib/ai/server";
import { requireLeadContext } from "./context";
import {
  callPrepSchema,
  draftOutreachSchema,
  researchCompanySchema,
  scoreIcpSchema,
} from "../validation";
import type { ActionResult } from "../types";

const researchResultSchema = z.object({
  summary: z.string().max(12_000),
  painPoints: z.array(z.string().max(500)).max(12),
  signals: z.array(z.string().max(500)).max(12),
});

const scoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().max(4_000),
  signals: z.array(z.string().max(500)).max(12),
});

function aiFailure(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return { ok: false, error: "The AI request contained invalid data." };
  }

  if (error instanceof AIProviderError) {
    return { ok: false, error: error.message };
  }

  if (error instanceof Error && error.name === "AuthenticationRequiredError") {
    return { ok: false, error: "Sign in with an organization account to use AI actions." };
  }

  console.error("AI action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, error: "The AI action could not be completed." };
}

export type ResearchResult = z.infer<typeof researchResultSchema> & {
  provider: string;
  model?: string;
};

export type ScoreResult = z.infer<typeof scoreResultSchema> & {
  provider: string;
  model?: string;
};

export async function researchCompany(
  input: unknown,
): Promise<ActionResult<ResearchResult>> {
  const parsed = researchCompanySchema.safeParse(input);
  if (!parsed.success) {
    return aiFailure(parsed.error);
  }

  try {
    const context = await requireLeadContext();
    const result = await getAIProvider().extractEntities({
      text: `Research the company website at ${parsed.data.websiteUrl}. Return a concise company summary, likely operational or commercial pain points, and evidence signals. Fetch only public information available at that URL.`,
      schema: researchResultSchema,
      instructions:
        "Use only public, non-sensitive information. Do not invent facts. Keep each pain point and signal concise.",
      context,
    });

    return {
      ok: true,
      data: {
        ...result.data,
        provider: result.provider,
        model: result.model,
      },
    };
  } catch (error) {
    return aiFailure(error);
  }
}

export async function scoreICP(
  input: unknown,
): Promise<ActionResult<ScoreResult>> {
  const parsed = scoreIcpSchema.safeParse(input);
  if (!parsed.success) {
    return aiFailure(parsed.error);
  }

  try {
    const context = await requireLeadContext();
    const result = await getAIProvider().extractEntities({
      text: `Score this company against the workspace's ideal customer profile. Company data: ${JSON.stringify(parsed.data.companyData)}`,
      schema: scoreResultSchema,
      instructions:
        "Return a calibrated 0-100 score, a short rationale, and the strongest positive or negative signals. Be explicit about uncertainty.",
      context,
    });

    return {
      ok: true,
      data: {
        ...result.data,
        provider: result.provider,
        model: result.model,
      },
    };
  } catch (error) {
    return aiFailure(error);
  }
}

export async function draftOutreach(
  input: unknown,
): Promise<ActionResult<{ draft: string; provider: string; model?: string }>> {
  const parsed = draftOutreachSchema.safeParse(input);
  if (!parsed.success) {
    return aiFailure(parsed.error);
  }

  try {
    const context = await requireLeadContext();
    const result = await getAIProvider().generateDraft({
      purpose: "Write an initial concise outreach email to this contact.",
      sourceText: JSON.stringify({
        contact: parsed.data.contactData,
        company: parsed.data.companyData,
      }),
      instructions:
        "Return only the email copy. Include a clear subject line and a low-friction call to action. Do not claim an existing relationship or invent company facts.",
      tone: "specific, respectful, concise, founder-led",
      context,
    });

    return {
      ok: true,
      data: { draft: result.data, provider: result.provider, model: result.model },
    };
  } catch (error) {
    return aiFailure(error);
  }
}

export async function generateCallPrep(
  input: unknown,
): Promise<ActionResult<{ prep: string; provider: string; model?: string }>> {
  const parsed = callPrepSchema.safeParse(input);
  if (!parsed.success) {
    return aiFailure(parsed.error);
  }

  try {
    const context = await requireLeadContext();
    const result = await getAIProvider().generateDraft({
      purpose: "Create a compact call preparation sheet for this company.",
      sourceText: JSON.stringify(parsed.data.companyData),
      instructions:
        "Return sections for company context, likely priorities, discovery questions, risks, and a suggested next step. Use bullets and clearly label assumptions.",
      tone: "practical, evidence-aware, concise",
      context,
    });

    return {
      ok: true,
      data: { prep: result.data, provider: result.provider, model: result.model },
    };
  } catch (error) {
    return aiFailure(error);
  }
}
