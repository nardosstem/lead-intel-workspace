import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAiActionsEnabled,
  isLeadIngestionEnabled,
  isNewsScanEnabled,
} from "./runtime-controls";

afterEach(() => vi.unstubAllEnvs());

describe("runtime controls", () => {
  it("keeps ingestion and AI enabled unless explicitly disabled", () => {
    vi.stubEnv("LEAD_INGESTION_ENABLED", "");
    vi.stubEnv("AI_ACTIONS_ENABLED", "");
    expect(isLeadIngestionEnabled()).toBe(true);
    expect(isAiActionsEnabled()).toBe(true);

    vi.stubEnv("LEAD_INGESTION_ENABLED", "0");
    vi.stubEnv("AI_ACTIONS_ENABLED", "0");
    expect(isLeadIngestionEnabled()).toBe(false);
    expect(isAiActionsEnabled()).toBe(false);
  });

  it("requires explicit opt-in for autonomous news scans", () => {
    vi.stubEnv("NEWS_SCAN_ENABLED", "");
    expect(isNewsScanEnabled()).toBe(false);
    vi.stubEnv("NEWS_SCAN_ENABLED", "1");
    expect(isNewsScanEnabled()).toBe(true);
  });
});
