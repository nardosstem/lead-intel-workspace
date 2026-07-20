import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("preserves an internal path and query string", () => {
    expect(safeNextPath("/leads?view=companies")).toBe("/leads?view=companies");
  });

  it("rejects absolute, protocol-relative, and backslash-based redirects", () => {
    expect(safeNextPath("https://attacker.example")).toBe("/leads");
    expect(safeNextPath("//attacker.example")).toBe("/leads");
    expect(safeNextPath("/\\attacker.example")).toBe("/leads");
    expect(safeNextPath("/\\\\attacker.example")).toBe("/leads");
  });

  it("falls back for missing or malformed values", () => {
    expect(safeNextPath(undefined)).toBe("/leads");
    expect(safeNextPath(null)).toBe("/leads");
    expect(safeNextPath("leads")).toBe("/leads");
  });
});
