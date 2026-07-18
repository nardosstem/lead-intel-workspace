"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  companies,
  contacts,
  pipeline,
} from "@/lib/db";

import { parseCompaniesCsv } from "./csv";
import { withLeadMutation } from "./context";
import { getWorkbenchSnapshot, toCompanyRecord, toContactRecord } from "./data";
import {
  companyInputSchema,
  contactInputSchema,
  updateCompanyInputSchema,
  updateContactInputSchema,
  updatePipelineSchema,
} from "../validation";
import type {
  ActionResult,
  CompanyRecord,
  ContactRecord,
  WorkbenchSnapshot,
} from "../types";

function validationFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
    }
  }

  return {
    ok: false,
    error: "Please correct the highlighted fields.",
    fieldErrors,
  };
}

function actionFailure(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return validationFailure(error);
  }

  if (
    error instanceof Error &&
    (error.name === "AuthenticationRequiredError" ||
      error.message.includes("organization profile"))
  ) {
    return { ok: false, error: "Sign in with an organization account to manage leads." };
  }

  console.error(error);
  return { ok: false, error: "The lead operation could not be completed." };
}

export async function getLeads(): Promise<WorkbenchSnapshot> {
  return getWorkbenchSnapshot();
}

export async function createCompany(
  input: unknown,
): Promise<ActionResult<CompanyRecord>> {
  const parsed = companyInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const inserted = await tx
          .insert(companies)
          .values({ ...parsed.data, organizationId: context.organizationId })
          .returning();
        const company = inserted[0];
        if (!company) {
          throw new Error("Company insert returned no row.");
        }

        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          companyId: company.id,
          stage: "new",
        });

        return toCompanyRecord(company);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateCompany(
  input: unknown,
): Promise<ActionResult<CompanyRecord>> {
  const parsed = updateCompanyInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const { id, ...values } = parsed.data;
        const updated = await tx
          .update(companies)
          .set(values)
          .where(and(eq(companies.id, id), eq(companies.organizationId, context.organizationId)))
          .returning();
        const company = updated[0];
        if (!company) {
          throw new Error("Company not found.");
        }
        return toCompanyRecord(company);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteCompany(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Invalid company id." };
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const deleted = await tx
          .delete(companies)
          .where(and(eq(companies.id, parsed.data), eq(companies.organizationId, context.organizationId)))
          .returning({ id: companies.id });
        if (!deleted[0]) {
          throw new Error("Company not found.");
        }
        return deleted[0];
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createContact(
  input: unknown,
): Promise<ActionResult<ContactRecord>> {
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const company = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, parsed.data.companyId), eq(companies.organizationId, context.organizationId)))
          .limit(1);
        if (!company[0]) {
          throw new Error("Company not found.");
        }

        const inserted = await tx
          .insert(contacts)
          .values({ ...parsed.data, organizationId: context.organizationId })
          .returning();
        const contact = inserted[0];
        if (!contact) {
          throw new Error("Contact insert returned no row.");
        }

        await tx.insert(pipeline).values({
          organizationId: context.organizationId,
          contactId: contact.id,
          stage: "new",
        });

        return toContactRecord(contact, company[0].name);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateContact(
  input: unknown,
): Promise<ActionResult<ContactRecord>> {
  const parsed = updateContactInputSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const { id, ...values } = parsed.data;
        const company = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, values.companyId), eq(companies.organizationId, context.organizationId)))
          .limit(1);
        if (!company[0]) {
          throw new Error("Company not found.");
        }

        const updated = await tx
          .update(contacts)
          .set(values)
          .where(and(eq(contacts.id, id), eq(contacts.organizationId, context.organizationId)))
          .returning();
        const contact = updated[0];
        if (!contact) {
          throw new Error("Contact not found.");
        }
        return toContactRecord(contact, company[0].name);
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteContact(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Invalid contact id." };
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const deleted = await tx
          .delete(contacts)
          .where(and(eq(contacts.id, parsed.data), eq(contacts.organizationId, context.organizationId)))
          .returning({ id: contacts.id });
        if (!deleted[0]) {
          throw new Error("Contact not found.");
        }
        return deleted[0];
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updatePipeline(
  input: unknown,
): Promise<ActionResult<{ id: string; stage: string; nextFollowUpAt: string | null }>> {
  const parsed = updatePipelineSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    return {
      ok: true,
      data: await withLeadMutation(async (tx, context) => {
        const updated = await tx
          .update(pipeline)
          .set({
            stage: parsed.data.stage,
            nextFollowUpAt: parsed.data.nextFollowUpAt,
            lastActivityAt: new Date(),
          })
          .where(and(eq(pipeline.id, parsed.data.id), eq(pipeline.organizationId, context.organizationId)))
          .returning({
            id: pipeline.id,
            stage: pipeline.stage,
            nextFollowUpAt: pipeline.nextFollowUpAt,
          });
        const row = updated[0];
        if (!row) {
          throw new Error("Pipeline record not found.");
        }
        return {
          id: row.id,
          stage: row.stage,
          nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
        };
      }),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function importCompaniesCsv(
  csvText: string,
): Promise<ActionResult<{ imported: number; errors: { row: number; message: string }[] }>> {
  if (typeof csvText !== "string") {
    return { ok: false, error: "CSV content is required." };
  }

  try {
    const parsed = parseCompaniesCsv(csvText);
    const imported = await withLeadMutation(async (tx, context) => {
      let count = 0;
      for (const row of parsed.rows) {
        const inserted = await tx
          .insert(companies)
          .values({ ...row, organizationId: context.organizationId })
          .returning({ id: companies.id });
        const company = inserted[0];
        if (company) {
          await tx.insert(pipeline).values({
            organizationId: context.organizationId,
            companyId: company.id,
            stage: "new",
          });
          count += 1;
        }
      }
      return count;
    });

    return { ok: true, data: { imported, errors: parsed.errors } };
  } catch (error) {
    return actionFailure(error);
  }
}
