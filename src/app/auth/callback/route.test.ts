import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { exchangeCodeForSession, acceptPendingOrganizationInvitation } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  acceptPendingOrganizationInvitation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession,
      signOut: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/auth/invitations", () => ({
  acceptPendingOrganizationInvitation,
  InvitationConflictError: class InvitationConflictError extends Error {},
}));

import { GET } from "./route";

afterEach(() => {
  exchangeCodeForSession.mockReset();
  acceptPendingOrganizationInvitation.mockReset().mockResolvedValue(undefined);
});

function request(path: string): NextRequest {
  return new NextRequest(`https://lead-intel-workspace.vercel.app${path}`);
}

describe("auth callback route", () => {
  it("sends confirmed signups to sign-in instead of the workspace", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "owner@example.com" } } },
      error: null,
    });

    const response = await GET(request("/auth/callback?code=signup-code&flow=signup&next=%2Fleads"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login?next=%2Fleads&confirmed=1",
    );
  });

  it("sends recovery callbacks to the password form", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "owner@example.com" } } },
      error: null,
    });

    const response = await GET(request("/auth/callback?code=recovery-code&flow=recovery&next=%2Flogin%2Freset-password"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login/reset-password",
    );
    expect(acceptPendingOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("recognizes Supabase's recovery type when a provider omits the custom flow", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "owner@example.com" } } },
      error: null,
    });

    const response = await GET(request("/auth/callback?code=recovery-code&type=recovery&next=%2Flogin%2Freset-password"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login/reset-password",
    );
    expect(acceptPendingOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("never sends a recovery callback to the workspace when next is omitted", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "owner@example.com" } } },
      error: null,
    });

    const response = await GET(request("/auth/callback?code=recovery-code&type=recovery"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login/reset-password",
    );
  });

  it("fails closed when the provider code cannot be exchanged", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: new Error("expired code"),
    });

    const response = await GET(request("/auth/callback?code=expired&next=%2Fleads"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login?next=%2Fleads&error=auth_callback_failed",
    );
  });
});
