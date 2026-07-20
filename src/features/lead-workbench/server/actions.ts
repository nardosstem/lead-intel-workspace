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
  normalizeCompanyDomain,
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

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "companies_organization_domain_uidx"
  ) {
    return { ok: false, error: "A company with that domain already exists." };
  }

  console.error("Lead operation failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
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
          .values({
            ...parsed.data,
            domain: normalizeCompanyDomain(parsed.data.website),
            organizationId: context.organizationId,
          })
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
        const updateValues = Object.hasOwn(parsed.data, "website")
          ? { ...values, domain: normalizeCompanyDomain(values.website) }
          : values;
        const updated = await tx
          .update(companies)
          .set(updateValues)
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
        const current = await tx
          .select({
            id: pipeline.id,
            companyId: pipeline.companyId,
            contactId: pipeline.contactId,
          })
          .from(pipeline)
          .where(
            and(
              eq(pipeline.id, parsed.data.id),
              eq(pipeline.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        const target = current[0];
        if (!target) {
          throw new Error("Pipeline record not found.");
        }

        if (target.companyId) {
          const company = await tx
            .select({ id: companies.id })
            .from(companies)
            .where(
              and(
                eq(companies.id, target.companyId),
                eq(companies.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!company[0]) throw new Error("Pipeline target is outside the organization.");
        } else if (target.contactId) {
          const contact = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                eq(contacts.id, target.contactId),
                eq(contacts.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!contact[0]) throw new Error("Pipeline target is outside the organization.");
        }

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
        if (!row) throw new Error("Pipeline record not found.");
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
    const importResult = await withLeadMutation(async (tx, context) => {
      let count = 0;
      const errors = [...parsed.errors];
      for (const [index, row] of parsed.rows.entries()) {
        const rowNumber = parsed.rowNumbers[index] ?? index + 2;
        try {
          await tx.transaction(async (savepoint) => {
            const inserted = await savepoint
              .insert(companies)
              .values({
                ...row,
                domain: normalizeCompanyDomain(row.website),
                organizationId: context.organizationId,
              })
              .returning({ id: companies.id });
            const company = inserted[0];
            if (!company) throw new Error("Company insert returned no row.");
            await savepoint.insert(pipeline).values({
              organizationId: context.organizationId,
              companyId: company.id,
              stage: "new",
            });
          });
          count += 1;
        } catch (error) {
          const constraint =
            typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string"
              ? error.constraint
              : null;
          errors.push({
            row: rowNumber,
            message: constraint === "companies_organization_domain_uidx"
              ? "A company with this domain already exists in the workspace."
              : "This company row could not be imported.",
          });
        }
      }
      return { count, errors };
    });

    return { ok: true, data: { imported: importResult.count, errors: importResult.errors } };
  } catch (error) {
    return actionFailure(error);
  }
}
