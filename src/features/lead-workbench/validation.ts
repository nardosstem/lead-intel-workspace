import { z } from "zod";

import { pipelineStages } from "@/lib/db/pipeline";

export const organizationRoles = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

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
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    new URL(value).protocol === "https:" &&
    hostname !== "localhost" &&
    hostname !== "0.0.0.0" &&
    hostname !== "::1" &&
    !hostname.includes(":") &&
    !hostname.endsWith(".local") &&
    !/^10(?:\.\d{1,3}){3}$/.test(hostname) &&
    !/^127(?:\.\d{1,3}){3}$/.test(hostname) &&
    !/^169\.254(?:\.\d{1,3}){2}$/.test(hostname) &&
    !/^192\.168(?:\.\d{1,3}){2}$/.test(hostname) &&
    !/^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(hostname)
  );
}, "Use a public HTTPS URL.");

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

const companyDataSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optionalUrl,
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
