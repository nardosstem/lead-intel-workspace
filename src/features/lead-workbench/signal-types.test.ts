import { describe, expect, it } from "vitest";

import {
  formatSignalConfidence,
  formatSignalDate,
  safeSignalSourceHref,
} from "./signal-types";

describe("lead signal presentation helpers", () => {
  it("normalizes confidence values from either adapter format", () => {
    expect(formatSignalConfidence(0.86)).toBe("86% confidence");
    expect(formatSignalConfidence(86)).toBe("86% confidence");
    expect(formatSignalConfidence(140)).toBe("100% confidence");
    expect(formatSignalConfidence(null)).toBeNull();
  });

  it("rejects unsafe source URLs before rendering links", () => {
    expect(safeSignalSourceHref("https://news.example.com/story")).toBe("https://news.example.com/story");
    expect(safeSignalSourceHref("javascript:alert(1)")).toBeNull();
    expect(safeSignalSourceHref("https://user:pass@example.com/story")).toBeNull();
    expect(safeSignalSourceHref(null)).toBeNull();
  });

  it("returns null for invalid dates rather than breaking the signal list", () => {
    expect(formatSignalDate("2026-07-25T00:00:00.000Z")).toContain("2026");
    expect(formatSignalDate("not-a-date")).toBeNull();
    expect(formatSignalDate(null)).toBeNull();
  });
});
