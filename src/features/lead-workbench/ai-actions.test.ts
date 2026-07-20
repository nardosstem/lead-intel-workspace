import { describe, expect, it } from "vitest";

import {
  draftOutreach,
  generateCallPrep,
  researchCompany,
  scoreICP,
} from "./server/ai-actions";

describe("lead AI action boundaries", () => {
  it("rejects malformed action payloads before accessing the provider or database", async () => {
    const results = await Promise.all([
      researchCompany({ companyId: "not-a-uuid", websiteUrl: "http://localhost:3000" }),
      scoreICP({ companyId: "not-a-uuid", companyData: { name: "" } }),
      draftOutreach({ contactId: "not-a-uuid", contactData: {}, companyData: {} }),
      generateCallPrep({ companyId: "not-a-uuid", companyData: { name: "" } }),
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.map((result) => (result.ok ? "success" : result.error))).toEqual([
      "The AI request contained invalid data.",
      "The AI request contained invalid data.",
      "The AI request contained invalid data.",
      "The AI request contained invalid data.",
    ]);
  });
});
