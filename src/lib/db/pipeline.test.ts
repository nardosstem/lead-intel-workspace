import { describe, expect, it } from "vitest";

import { isPipelineStage } from "./pipeline";

describe("isPipelineStage", () => {
  it("accepts every persisted stage", () => {
    expect(isPipelineStage("new")).toBe(true);
    expect(isPipelineStage("won")).toBe(true);
    expect(isPipelineStage("lost")).toBe(true);
  });

  it("rejects arbitrary select values", () => {
    expect(isPipelineStage("unknown")).toBe(false);
    expect(isPipelineStage(null)).toBe(false);
    expect(isPipelineStage(1)).toBe(false);
  });
});
