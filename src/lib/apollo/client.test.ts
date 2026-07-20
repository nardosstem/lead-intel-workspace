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

  it("surfaces plan errors returned in Apollo's error field", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async () =>
        jsonResponse({ error: "This endpoint is not accessible on the current plan." }, 403),
    });

    await expect(client.searchDomain("acme.com", ["CEO"])).rejects.toMatchObject({
      status: 403,
      message: "This endpoint is not accessible on the current plan.",
    });
  });

  it("drops unsafe LinkedIn URLs returned by the provider", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async (input) =>
        jsonResponse(
          String(input).includes("api_search")
            ? { people: [{ id: "person-1", name: "Person 1" }] }
            : {
                matches: [
                  {
                    id: "person-1",
                    name: "Person 1",
                    linkedin_url: "javascript:alert(1)",
                  },
                ],
              },
        ),
    });

    const result = await ingestApolloLeads("acme.com", ["CEO"], client);
    expect(result.contacts[0]?.linkedin).toBeNull();
  });

  it("drops malformed provider emails before persistence", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async (input) =>
        jsonResponse(
          String(input).includes("api_search")
            ? { people: [{ id: "person-1", name: "Person 1" }] }
            : { matches: [{ id: "person-1", name: "Person 1", email: "not-an-email" }] },
        ),
    });

    const result = await ingestApolloLeads("acme.com", ["CEO"], client);
    expect(result.contacts[0]?.email).toBeNull();
  });

  it("rejects oversized provider fields before they reach the database", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async () =>
        jsonResponse({ people: [{ id: "person-1", name: "x".repeat(161) }] }),
    });

    await expect(client.searchDomain("acme.com", ["CEO"])).rejects.toThrow(/too big|maximum/i);
  });

  it("ignores enrichment records that were not requested", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async (input) =>
        jsonResponse(
          String(input).includes("api_search")
            ? { people: [{ id: "person-1", name: "Person 1" }] }
            : {
                matches: [
                  { id: "unrequested", name: "Unexpected Person" },
                  { id: "person-1", name: "Person 1" },
                ],
              },
        ),
    });

    const result = await ingestApolloLeads("acme.com", ["CEO"], client);
    expect(result.contacts.map((contact) => contact.apolloId)).toEqual(["person-1"]);
  });

  it("rejects private domains before making a provider request", async () => {
    const fetchMock = async () => jsonResponse({ people: [] });
    const client = new ApolloClient({ apiKey: "apollo-test-key", fetchImpl: fetchMock });

    await expect(client.searchDomain("http://localhost:3000", ["CEO"])).rejects.toMatchObject({
      status: 400,
      message: "Apollo domain is invalid.",
    });
  });

  it("rejects oversized provider responses before parsing them", async () => {
    const client = new ApolloClient({
      apiKey: "apollo-test-key",
      fetchImpl: async () =>
        new Response("x".repeat(2_000_001), { status: 200 }),
    });

    await expect(client.searchDomain("acme.com", ["CEO"])).rejects.toThrow(
      /size limit/i,
    );
  });
});
