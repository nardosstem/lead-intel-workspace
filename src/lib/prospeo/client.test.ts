import { describe, expect, it } from "vitest";

import { ProspeoClient } from "./client";

describe("Prospeo client", () => {
  it("searches a domain by title and enriches returned person IDs", async () => {
    const calls: { path: string; body: Record<string, unknown>; key: string | null }[] = [];
    const client = new ProspeoClient({
      apiKey: "prospeo-test-key",
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({
          path,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          key: new Headers(init?.headers).get("X-KEY"),
        });
        if (path === "/search-person") {
          return new Response(JSON.stringify({ results: [{ person: { person_id: "p1", full_name: "Ada Lovelace", current_job_title: "CEO", linkedin_url: "https://linkedin.com/in/ada" }, company: { name: "Acme", website: "acme.com" } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ matched: [{ identifier: "p1", person: { person_id: "p1", full_name: "Ada Lovelace", current_job_title: "CEO", email: { email: "ada@acme.com", status: "VERIFIED" } }, company: { name: "Acme", website: "acme.com" } }] }), { status: 200 });
      },
    });

    const search = await client.searchDomain("https://www.acme.com", ["CEO"]);
    const enriched = await client.enrichContacts(["p1"]);
    expect(calls[0]).toMatchObject({ path: "/search-person", key: "prospeo-test-key" });
    expect(calls[0]?.body).toMatchObject({ filters: { company: { websites: { include: ["acme.com"] } } } });
    expect(calls[1]?.body).toMatchObject({ data: [{ identifier: "p1", person_id: "p1" }] });
    expect(search[0]?.id).toBe("p1");
    expect(enriched[0]?.email).toBe("ada@acme.com");
  });
});
