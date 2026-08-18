import "server-only";

import { z } from "zod";

import { isPublicHostname } from "@/lib/domains";
import type { ApolloLeadSource, ApolloPerson } from "@/lib/apollo/client";

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { return new URL(withProtocol).hostname.replace(/^www\./, ""); } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

const PROSPEO_BASE_URL = "https://api.prospeo.io";
const REQUEST_TIMEOUT_MS = 20_000;

const personSchema = z.object({
  person_id: z.string().min(1),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  current_job_title: z.string().nullable().optional(),
  email: z.object({ email: z.string().nullable().optional(), status: z.string().nullable().optional() }).nullable().optional(),
  location: z.object({ country: z.string().nullable().optional(), state: z.string().nullable().optional(), city: z.string().nullable().optional() }).nullable().optional(),
}).passthrough();

const companySchema = z.object({
  company_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  employee_count: z.number().nullable().optional(),
  location: z.object({ country: z.string().nullable().optional(), state: z.string().nullable().optional(), city: z.string().nullable().optional() }).nullable().optional(),
}).passthrough();

const searchResponseSchema = z.object({
  results: z.array(z.object({ person: personSchema, company: companySchema.nullable().optional() })).default([]),
}).passthrough();

const enrichResponseSchema = z.object({
  matched: z.array(z.object({ identifier: z.string(), person: personSchema, company: companySchema.nullable().optional() })).default([]),
}).passthrough();

export class ProspeoApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProspeoApiError";
    this.status = status;
  }
}

export class ProspeoConfigurationError extends Error {
  constructor() {
    super("Prospeo is not configured. Set PROSPEO_API_KEY before using Prospeo lead search.");
    this.name = "ProspeoConfigurationError";
  }
}

export type ProspeoClientOptions = Readonly<{
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

function asApolloPerson(person: z.infer<typeof personSchema>, company: z.infer<typeof companySchema> | null | undefined): ApolloPerson {
  const location = person.location;
  const organization = company
    ? {
        name: company.name ?? null,
        domain: company.website ?? null,
        primary_domain: company.website ?? null,
        website_url: company.website ?? null,
        linkedin_url: null,
        industry: company.industry ?? null,
        estimated_num_employees: company.employee_count ?? null,
        raw_address: null,
        city: company.location?.city ?? location?.city ?? null,
        state: company.location?.state ?? location?.state ?? null,
        country: company.location?.country ?? location?.country ?? null,
      }
    : undefined;
  return {
    id: person.person_id,
    first_name: person.first_name ?? null,
    last_name: person.last_name ?? null,
    name: person.full_name ?? null,
    title: person.current_job_title ?? null,
    email: person.email?.email ?? null,
    email_status: person.email?.status ?? null,
    linkedin_url: person.linkedin_url ?? null,
    organization_id: company?.company_id ?? null,
    organization_name: company?.name ?? null,
    organization: organization ?? null,
    city: location?.city ?? null,
    state: location?.state ?? null,
    country: location?.country ?? null,
  };
}

export class ProspeoClient implements ApolloLeadSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ProspeoClientOptions) {
    if (!options.apiKey.trim()) throw new ProspeoConfigurationError();
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? PROSPEO_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async searchDomain(domain: string, titles: string[]): Promise<ApolloPerson[]> {
    const normalizedDomain = normalizeDomain(domain);
    if (!isPublicHostname(normalizedDomain)) throw new ProspeoApiError("Prospeo domain is invalid.", 400);
    const include = titles.map((title) => title.trim()).filter(Boolean).slice(0, 10);
    const body = {
      page: 1,
      filters: {
        company: { websites: { include: [normalizedDomain] } },
        ...(include.length ? { person_job_title: { include, match_mode: "CONTAINS" } } : {}),
      },
    };
    const response = searchResponseSchema.parse(await this.request("/search-person", body));
    return response.results.slice(0, 5).map((result) => asApolloPerson(result.person, result.company));
  }

  async enrichContacts(contactIds: string[]): Promise<ApolloPerson[]> {
    const ids = [...new Set(contactIds)].filter(Boolean).slice(0, 5);
    if (!ids.length) return [];
    const response = enrichResponseSchema.parse(await this.request("/bulk-enrich-person", {
      only_verified_email: false,
      data: ids.map((personId) => ({ identifier: personId, person_id: personId })),
    }));
    return response.matched.map((result) => asApolloPerson(result.person, result.company));
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "X-KEY": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      throw new ProspeoApiError(`Prospeo request failed: ${error instanceof Error ? error.message : "network error"}`, 0);
    }
    const text = await response.text();
    let payload: unknown = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
    if (!response.ok) throw new ProspeoApiError(`Prospeo returned HTTP ${response.status}`, response.status);
    return payload;
  }
}

let defaultClient: ProspeoClient | undefined;
export function getProspeoClient(): ProspeoClient {
  return (defaultClient ??= new ProspeoClient({ apiKey: process.env.PROSPEO_API_KEY ?? "" }));
}
