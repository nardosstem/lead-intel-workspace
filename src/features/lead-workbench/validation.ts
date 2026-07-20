import { z } from "zod";

import { pipelineStages } from "@/lib/db/pipeline";
import { isPublicHostname } from "@/lib/domains";

export const organizationRoles = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && organizationRoles.some((role) => role === value);
}

export function isInvitationRole(value: unknown): value is "admin" | "member" {
  return value === "admin" || value === "member";
}

export const companyStatuses = ["prospect", "customer", "inactive"] as const;
export type CompanyStatus = (typeof companyStatuses)[number];

const httpUrl = z
  .string()
  .trim()
  .max(2_048, "URL must be 2,048 characters or fewer.")
  .url()
  .refine((value) => /^https?:$/i.test(new URL(value).protocol), "Use an HTTP or HTTPS URL.")
  .refine((value) => {
    const url = new URL(value);
    return url.username.length === 0 && url.password.length === 0;
  }, "URLs cannot include embedded credentials.");

const httpsPublicUrl = httpUrl.refine((value) => {
  return (
    new URL(value).protocol === "https:" &&
    isPublicHostname(new URL(value).hostname)
  );
}, "Use a public HTTPS URL.");

const publicCompanyUrl = httpUrl.refine((value) => {
  return isPublicHostname(new URL(value).hostname);
}, "Use a public company URL.");

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpUrl.optional(),
);

const optionalHttpsUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpsPublicUrl.optional(),
);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export const companyDataSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: z.preprocess(
    (value) => (value === "" ? undefined : value),
    publicCompanyUrl.optional(),
  ),
  industry: optionalText(120),
  size: optionalText(80),
  location: optionalText(160),
  status: optionalText(40),
});

const contactDataSchema = z.object({
  name: z.string().trim().min(1).max(160),
  title: optionalText(160),
  email: optionalText(320),
  notes: optionalText(5_000),
});

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  website: optionalUrl,
  industry: optionalText(120),
  size: optionalText(80),
  location: optionalText(160),
  status: z.enum(companyStatuses).default("prospect"),
});

export const updateCompanyInputSchema = companyInputSchema.extend({
  id: z.uuid(),
});

export const contactInputSchema = z.object({
  companyId: z.uuid(),
  name: z.string().trim().min(1, "Contact name is required").max(160),
  title: optionalText(160),
  email: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.email().optional(),
  ),
  linkedin: optionalHttpsUrl,
  notes: optionalText(5000),
});

export const updateContactInputSchema = contactInputSchema.extend({
  id: z.uuid(),
});

export const updatePipelineSchema = z.object({
  id: z.uuid(),
  stage: z.enum(pipelineStages),
  nextFollowUpAt: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.coerce.date().nullable(),
  ),
});

export const workspaceSettingsSchema = z.object({
  defaultStage: z.enum(pipelineStages),
  followUpDays: z.coerce.number().int().min(1).max(90),
});

export const updateMemberRoleSchema = z.object({
  targetUserId: z.uuid(),
  role: z.enum(organizationRoles),
});

export const updateMemberStatusSchema = z.object({
  targetUserId: z.uuid(),
  isActive: z.boolean(),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(["admin", "member"] as const),
});

export const researchCompanySchema = z.object({
  companyId: z.uuid(),
  websiteUrl: httpsPublicUrl,
});

export const scoreIcpSchema = z.object({
  companyId: z.uuid(),
  companyData: companyDataSchema,
});

export const draftOutreachSchema = z.object({
  contactId: z.uuid(),
  contactData: contactDataSchema,
  companyData: companyDataSchema,
});

export const callPrepSchema = z.object({
  companyId: z.uuid(),
  companyData: companyDataSchema,
});

export type CompanyInput = z.infer<typeof companyInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;

/** Canonical hostname used by ingestion deduplication and external providers. */
export function normalizeCompanyDomain(website: string | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
