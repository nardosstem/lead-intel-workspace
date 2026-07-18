import { describe, expect, it } from "vitest";

import {
  ApolloApiError,
  ApolloClient,
  ingestApolloLeads,
  normalizeDomain,
} from "./client";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Apollo client", () => {
  it("normalizes domains before searching and enriches the top five IDs", async () => {
    const calls: { path: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const searchPeople = Array.from({ length: 6 }, (_, index) => ({
      id: `person-${index + 1}`,
      name: `Person ${index + 1}`,
      title: index === 0 ? "CEO" : "VP Sales",
      organization_name: "Acme Inc.",
    }));
    const enrichedPeople = searchPeople.slice(0, 5).map((person, index) => ({
      ...person,
      first_name: `Person`,
      last_name: `${index + 1}`,
      email: `person${index + 1}@acme.com`,
      email_status: "verified",
      linkedin_url: `https://linkedin.com/in/person-${index + 1}`,
      organization: {
        name: "Acme Inc.",
        primary_domain: "acme.com",
        industry: "Software",
        estimated_num_employees: 120,
        city: "New York",
        state: "NY",
      },
    }));

    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ path, body, headers: new Headers(init?.headers) });
        return path.includes("api_search")
          ? jsonResponse({ people: searchPeople })
          : jsonResponse({ matches: enrichedPeople });
      },
    });

    const result = await ingestApolloLeads(
      "https://www.acme.com/pricing",
      ["CEO", "Founder"],
      client,
    );

    expect(normalizeDomain("https://www.Acme.com/path")).toBe("acme.com");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get("X-Api-Key")).toBe("apollo-test-key");
    expect(calls[0]?.body.q_organization_domains).toEqual(["acme.com"]);
    expect(calls[0]?.body.person_titles).toEqual(["CEO", "Founder"]);
    expect(calls[1]?.body.details).toEqual(
      ["person-1", "person-2", "person-3", "person-4", "person-5"].map((id) => ({ id })),
    );
    expect(result.company.name).toBe("Acme Inc.");
    expect(result.contacts).toHaveLength(5);
    expect(result.contacts[0]?.email).toBe("person1@acme.com");
  });

  it("surfaces API status errors without exposing credentials", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async () => jsonResponse({ message: "invalid key" }, 401),
    });

    await expect(client.searchDomain("acme.com", ["CEO"])).rejects.toEqual(
      expect.objectContaining({ status: 401 } satisfies Partial<ApolloApiError>),
    );
  });
});
