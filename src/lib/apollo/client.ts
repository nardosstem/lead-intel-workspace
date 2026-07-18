import "server-only";

import { z } from "zod";

const APOLLO_BASE_URL = "https://api.apollo.io";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_APOLLO_RESPONSE_BYTES = 2_000_000;

const nullableString = z.string().nullable().optional();

const apolloOrganizationSchema = z
  .object({
    name: nullableString,
    domain: nullableString,
    primary_domain: nullableString,
    website_url: nullableString,
    linkedin_url: nullableString,
    industry: nullableString,
    estimated_num_employees: z.number().nullable().optional(),
    employee_count: z.number().nullable().optional(),
    raw_address: nullableString,
    city: nullableString,
    state: nullableString,
    country: nullableString,
  })
  .passthrough();

const apolloPersonSchema = z
  .object({
    id: z.string().min(1),
    first_name: nullableString,
    last_name: nullableString,
    name: nullableString,
    title: nullableString,
    email: nullableString,
    email_status: nullableString,
    linkedin_url: nullableString,
    organization_id: nullableString,
    organization_name: nullableString,
    organization: apolloOrganizationSchema.nullable().optional(),
    city: nullableString,
    state: nullableString,
    country: nullableString,
  })
  .passthrough();

const apolloSearchResponseSchema = z
  .object({
    people: z.array(apolloPersonSchema).default([]),
  })
  .passthrough();

const apolloEnrichmentResponseSchema = z
  .object({
    matches: z.array(apolloPersonSchema).default([]),
  })
  .passthrough();

export type ApolloPerson = z.infer<typeof apolloPersonSchema>;
export type ApolloOrganization = z.infer<typeof apolloOrganizationSchema>;

export type ApolloCompanyPayload = Readonly<{
  name: string;
  website: string;
  industry: string | null;
  size: string | null;
  location: string | null;
}>;

export type ApolloContactPayload = Readonly<{
  apolloId: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  notes: string | null;
}>;

export type ApolloLeadBatch = Readonly<{
  domain: string;
  company: ApolloCompanyPayload;
  contacts: ApolloContactPayload[];
  searchedContactIds: string[];
}>;

export interface ApolloLeadSource {
  searchDomain(domain: string, titles: string[]): Promise<ApolloPerson[]>;
  enrichContacts(contactIds: string[]): Promise<ApolloPerson[]>;
}

export class ApolloApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApolloApiError";
    this.status = status;
  }
}

export class ApolloConfigurationError extends Error {
  constructor() {
    super("Apollo is not configured. Set APOLLO_API_KEY before ingesting a domain.");
    this.name = "ApolloConfigurationError";
  }
}

export function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0];
  }
}

function toWebsite(value: string | null | undefined, domain: string): string {
  const candidate = value?.trim();
  if (candidate) {
    return /^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`;
  }
  return `https://${domain}`;
}

function toName(person: ApolloPerson): string | null {
  const explicitName = person.name?.trim();
  if (explicitName) return explicitName;

  const composed = [person.first_name, person.last_name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();

  return composed || null;
}

function toLocation(organization: ApolloOrganization | undefined): string | null {
  if (!organization) return null;
  if (organization.raw_address?.trim()) return organization.raw_address.trim();

  const parts = [organization.city, organization.state, organization.country]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  return parts.length ? parts.join(", ") : null;
}

function toLinkedIn(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toCompanyPayload(
  domain: string,
  people: ApolloPerson[],
): ApolloCompanyPayload {
  const personWithOrganization = people.find((person) => person.organization);
  const organization = personWithOrganization?.organization;
  const organizationName =
    organization?.name?.trim() ||
    people.find((person) => person.organization_name?.trim())?.organization_name?.trim() ||
    domain;
  const employeeCount = organization?.estimated_num_employees ?? organization?.employee_count;

  return {
    name: organizationName,
    website: toWebsite(
      organization?.website_url ?? organization?.primary_domain ?? organization?.domain,
      domain,
    ),
    industry: organization?.industry?.trim() || null,
    size: typeof employeeCount === "number" ? String(employeeCount) : null,
    location: toLocation(organization ?? undefined),
  };
}

function toContactPayload(person: ApolloPerson): ApolloContactPayload | null {
  const name = toName(person);
  if (!name) return null;

  return {
    apolloId: person.id,
    name,
    title: person.title?.trim() || null,
    email: person.email?.trim() || null,
    linkedin: toLinkedIn(person.linkedin_url),
    notes: person.email_status
      ? `Apollo email status: ${person.email_status}`
      : null,
  };
}

export type ApolloClientOptions = Readonly<{
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

export class ApolloClient implements ApolloLeadSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ApolloClientOptions) {
    if (!options.apiKey.trim()) {
      throw new ApolloConfigurationError();
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? APOLLO_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async searchDomain(domain: string, titles: string[]): Promise<ApolloPerson[]> {
    const normalizedDomain = normalizeDomain(domain);
    const response = await this.request(
      "/api/v1/mixed_people/api_search",
      {
        // Apollo's current docs call this q_organization_domains_list; retain
        // q_organization_domains for compatibility with older API accounts.
        q_organization_domains: [normalizedDomain],
        q_organization_domains_list: [normalizedDomain],
        person_titles: titles,
        per_page: 5,
      },
    );

    return apolloSearchResponseSchema.parse(response).people.slice(0, 5);
  }

  async enrichContacts(contactIds: string[]): Promise<ApolloPerson[]> {
    const ids = [...new Set(contactIds)].filter(Boolean).slice(0, 10);
    if (!ids.length) return [];

    const response = await this.request("/api/v1/people/bulk_match", {
      details: ids.map((id) => ({ id })),
    });

    return apolloEnrichmentResponseSchema.parse(response).matches;
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          "content-type": "application/json",
          "X-Api-Key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed";
      throw new ApolloApiError(`Apollo request failed: ${message}`, 0);
    }

    const responseText = await response.text();
    if (responseText.length > MAX_APOLLO_RESPONSE_BYTES) {
      throw new ApolloApiError(
        "Apollo response exceeded the configured size limit.",
        response.status,
      );
    }

    let responseBody: unknown = {};
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseBody = { message: responseText };
    }

    if (!response.ok) {
      const message =
        typeof responseBody === "object" && responseBody !== null && "message" in responseBody &&
        typeof responseBody.message === "string"
          ? responseBody.message
          : `Apollo returned HTTP ${response.status}`;
      throw new ApolloApiError(message, response.status);
    }

    return responseBody;
  }
}

let defaultClient: ApolloClient | undefined;

export function getApolloClient(): ApolloClient {
  return (defaultClient ??= new ApolloClient({
    apiKey: process.env.APOLLO_API_KEY ?? "",
  }));
}

export async function ingestApolloLeads(
  domain: string,
  targetTitles: string[],
  source: ApolloLeadSource = getApolloClient(),
): Promise<ApolloLeadBatch> {
  const normalizedDomain = normalizeDomain(domain);
  const searchResults = await source.searchDomain(normalizedDomain, targetTitles);
  const searchedContactIds = searchResults.map((person) => person.id).slice(0, 5);
  const enrichedResults = await source.enrichContacts(searchedContactIds);
  const contacts = enrichedResults
    .map(toContactPayload)
    .filter((contact): contact is ApolloContactPayload => contact !== null);

  return {
    domain: normalizedDomain,
    company: toCompanyPayload(normalizedDomain, enrichedResults.length ? enrichedResults : searchResults),
    contacts,
    searchedContactIds,
  };
}
