import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn(async () => []));
const databaseMock = vi.hoisted(() => vi.fn(() => ({ execute: executeMock })));
const publicEnvironmentMock = vi.hoisted(() =>
  vi.fn(() => ({
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "publishable-key",
  })),
);

vi.mock("@/lib/db", () => ({ getDatabase: databaseMock }));
vi.mock("@/lib/public-env", () => ({ getPublicEnvironment: publicEnvironmentMock }));

import { getHealthSnapshot } from "./health";

const configuredEnvironment = {
  APOLLO_API_KEY: "apollo-key",
  FIRECRAWL_API_KEY: "firecrawl-key",
  CLAUDE_MCP_ENDPOINT: "https://mcp.example.com/tools",
  INNGEST_EVENT_KEY: "event-key",
  INNGEST_SIGNING_KEY: "signing-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  INNGEST_DEV: "",
} as const;

afterEach(() => vi.unstubAllEnvs());

describe("health readiness snapshot", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue([]);
    databaseMock.mockClear();
    publicEnvironmentMock.mockClear();
    for (const [key, value] of Object.entries(configuredEnvironment)) {
      vi.stubEnv(key, value);
    }
  });

  it("reports healthy when the database and deployment dependencies are configured", async () => {
    const snapshot = await getHealthSnapshot();

    expect(snapshot).toEqual({
      status: "ok",
      checks: {
        database: "ok",
        supabase: "configured",
        apollo: "configured",
        firecrawl: "configured",
        claudeMcp: "configured",
        inngest: "configured",
        invitations: "configured",
      },
    });
    expect(databaseMock).toHaveBeenCalledOnce();
  });

  it("reports degraded without exposing missing provider values", async () => {
    vi.stubEnv("APOLLO_API_KEY", "");
    vi.stubEnv("CLAUDE_MCP_ENDPOINT", "");

    const snapshot = await getHealthSnapshot();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.checks.apollo).toBe("missing");
    expect(snapshot.checks.claudeMcp).toBe("missing");
    expect(JSON.stringify(snapshot)).not.toContain("apollo-key");
  });

  it("reports unhealthy when the database cannot be reached", async () => {
    executeMock.mockRejectedValueOnce(new Error("database unavailable"));

    const snapshot = await getHealthSnapshot();

    expect(snapshot.status).toBe("unhealthy");
    expect(snapshot.checks.database).toBe("error");
  });

  it("accepts local Inngest development mode without production signing keys", async () => {
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");

    const snapshot = await getHealthSnapshot();

    expect(snapshot.checks.inngest).toBe("configured");
  });

  it("does not treat Inngest development mode as production readiness", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("INNGEST_EVENT_KEY", "");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");

    const snapshot = await getHealthSnapshot();

    expect(snapshot.checks.inngest).toBe("missing");
  });
});
