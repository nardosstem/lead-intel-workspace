import { describe, expect, it } from "vitest";

import { parseCompaniesCsv } from "./csv";

describe("company CSV parser", () => {
  it("parses aliases and quoted commas into validated rows", () => {
    const result = parseCompaniesCsv(
      "company_name,website,industry\n\"Acme, Inc.\",https://acme.com,SaaS\n",
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        name: "Acme, Inc.",
        website: "https://acme.com",
        industry: "SaaS",
        status: "prospect",
      },
    ]);
  });

  it("reports malformed rows without aborting valid rows", () => {
    const result = parseCompaniesCsv(
      "name,website\nGood Co,https://good.example.com\nBad Co,javascript:alert(1)\n",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rowNumbers).toEqual([2]);
    expect(result.rows[0]?.name).toBe("Good Co");
    expect(result.errors).toEqual([
      { row: 3, message: "Use an HTTP or HTTPS URL." },
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCompaniesCsv('name\n"Acme')).toThrow(
      /unterminated quoted field/i,
    );
  });
});
