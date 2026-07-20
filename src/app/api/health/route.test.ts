import { describe, expect, it, vi } from "vitest";

const healthMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/health", () => ({ getHealthSnapshot: healthMock }));

import { GET } from "./route";

describe("health route", () => {
  it("returns a cache-disabled healthy response", async () => {
    healthMock.mockResolvedValueOnce({
      status: "ok",
      checks: { database: "ok" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("returns 503 for database-unhealthy readiness", async () => {
    healthMock.mockResolvedValueOnce({
      status: "unhealthy",
      checks: { database: "error" },
    });

    const response = await GET();

    expect(response.status).toBe(503);
  });
});
