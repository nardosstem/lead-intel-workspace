import { z } from "zod";

import { pipelineStages } from "@/lib/db/schema";

export const companyStatuses = ["prospect", "customer", "inactive"] as const;
export type CompanyStatus = (typeof companyStatuses)[number];

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

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
  linkedin: optionalUrl,
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

export const researchCompanySchema = z.object({
  websiteUrl: z.url(),
});

export const scoreIcpSchema = z.object({
  companyData: z.object({
    name: z.string().min(1),
    website: z.string().optional(),
    industry: z.string().optional(),
    size: z.string().optional(),
    location: z.string().optional(),
    status: z.string().optional(),
  }),
});

export const draftOutreachSchema = z.object({
  contactData: z.object({
    name: z.string().min(1),
    title: z.string().optional(),
    email: z.string().optional(),
    notes: z.string().optional(),
  }),
  companyData: scoreIcpSchema.shape.companyData,
});

export const callPrepSchema = z.object({
  companyData: scoreIcpSchema.shape.companyData,
});

export type CompanyInput = z.infer<typeof companyInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
