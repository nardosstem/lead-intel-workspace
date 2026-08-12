import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { exchangeCodeForSession, getUser, acceptPendingOrganizationInvitation } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  acceptPendingOrganizationInvitation: vi.fn().mockResolvedValue({ accepted: true }),
}));

vi.mock("@/lib/auth/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession,
      getUser,
      signOut: vi.fn().mockResolvedValue({ error: null }),
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
  getUser.mockReset();
  acceptPendingOrganizationInvitation.mockReset().mockResolvedValue({ accepted: true });
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
    expect(acceptPendingOrganizationInvitation).not.toHaveBeenCalled();
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

  it("accepts PKCE-compatible invitations before sending invitees to set a password", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "invitee@example.com" } } },
      error: null,
    });

    const response = await GET(request("/auth/callback?code=invite-code&type=invite&next=%2Fleads"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login/reset-password",
    );
    expect(acceptPendingOrganizationInvitation).toHaveBeenCalledWith({
      userId: "user-1",
      email: "invitee@example.com",
    });
  });

  it("accepts implicit-flow invitations after the browser bridge persists the session", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "invitee@example.com" } },
      error: null,
    });

    const response = await GET(request("/auth/callback?flow=invite&next=%2Fleads"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login/reset-password",
    );
    expect(acceptPendingOrganizationInvitation).toHaveBeenCalledWith({
      userId: "user-1",
      email: "invitee@example.com",
    });
  });

  it("rejects an expired or revoked invitation instead of provisioning a new workspace", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "invitee@example.com" } },
      error: null,
    });
    acceptPendingOrganizationInvitation.mockResolvedValue({ accepted: false });

    const response = await GET(request("/auth/callback?flow=invite"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login?next=%2Fleads&error=invitation_expired",
    );
  });

  it("rejects an invitation session without an email claim", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: null } }, error: null });

    const response = await GET(request("/auth/callback?flow=invite"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login?next=%2Fleads&error=auth_callback_failed",
    );
    expect(acceptPendingOrganizationInvitation).not.toHaveBeenCalled();
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

  it("does not claim signup confirmation when no session was returned", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });

    const response = await GET(request("/auth/callback?code=signup-code&flow=signup&next=%2Fleads"));

    expect(response.headers.get("location")).toBe(
      "https://lead-intel-workspace.vercel.app/login?next=%2Fleads&error=auth_callback_failed",
    );
  });
});
