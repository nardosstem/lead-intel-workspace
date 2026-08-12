import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { acceptPendingOrganizationInvitation, InvitationConflictError } from "@/lib/auth/invitations";

function clearRecoveryCookie(response: NextResponse): NextResponse {
  response.cookies.set("lead_intel_recovery", "", {
    path: "/auth/callback",
    maxAge: 0,
    sameSite: "lax",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flow = request.nextUrl.searchParams.get("flow");
  const authType = request.nextUrl.searchParams.get("type");
  const recoveryCookie = request.cookies.get("lead_intel_recovery")?.value === "1";
  const isSignup = flow === "signup" || authType === "signup";
  const isInvitation = flow === "invite" || authType === "invite";
  const isExplicitRecovery = flow === "recovery" || authType === "recovery";
  // A callback with an explicit signup/invite marker wins over a stale
  // browser recovery cookie from an earlier reset request.
  const isRecovery = isExplicitRecovery || (recoveryCookie && !isSignup && !isInvitation);
  const requiresPasswordSetup = isRecovery || isInvitation;
  // Recovery must never fall through to the generic `/leads` default. Some
  // Supabase email templates preserve `type=recovery` but omit the custom
  // `next` parameter, and the user must land on the password form in either
  // case.
  const nextPath = requiresPasswordSetup
    ? "/login/reset-password"
    : safeNextPath(request.nextUrl.searchParams.get("next"));

  const redirectAfterSignup = () => {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextPath);
    loginUrl.searchParams.set("confirmed", "1");
    const response = NextResponse.redirect(loginUrl);
    if (recoveryCookie) clearRecoveryCookie(response);
    return response;
  };

  async function acceptInvitationForUser(
    supabase: Awaited<ReturnType<typeof createClient>>,
    user: { id: string; email?: string | null; invited_at?: string },
  ): Promise<NextResponse | null> {
    // Supabase marks admin-invited users with `invited_at`. Treat that
    // server-verified claim as authoritative so an invitee cannot remove or
    // rewrite the mutable `flow` query parameter to bypass tenant acceptance.
    // A stale browser recovery cookie must not suppress invitation acceptance:
    // an invitee is identified by the server-verified `invited_at` claim, not
    // by mutable query parameters or a previous reset request in this browser.
    if (isExplicitRecovery || (!isInvitation && !user.invited_at)) return null;

    try {
      if (!user.email) {
        await supabase.auth.signOut().catch(() => undefined);
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", "/leads");
        loginUrl.searchParams.set("error", "auth_callback_failed");
        return NextResponse.redirect(loginUrl);
      }
      const result = await acceptPendingOrganizationInvitation({ userId: user.id, email: user.email });
      if (!result.accepted) {
        await supabase.auth.signOut().catch(() => undefined);
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", "/leads");
        loginUrl.searchParams.set("error", "invitation_expired");
        return NextResponse.redirect(loginUrl);
      }
      return null;
    } catch (invitationError) {
      // Do not leave a partially authenticated session active when an
      // invitation cannot be resolved. The user can sign in again after an
      // administrator fixes the pending invitation state.
      await supabase.auth.signOut().catch(() => undefined);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", nextPath);
      loginUrl.searchParams.set(
        "error",
        invitationError instanceof InvitationConflictError
          ? "invitation_conflict"
          : "auth_callback_failed",
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        const user = data.session?.user;
        // Password recovery only needs the short-lived Auth session. It must
        // not depend on application-database availability or invitation state;
        // otherwise a transient workspace DB outage can strand a user with a
        // valid recovery link but no way to set a new password.
        if (user && !isExplicitRecovery && (isInvitation || Boolean(user.invited_at))) {
          const invitationFailure = await acceptInvitationForUser(supabase, user);
          if (invitationFailure) return invitationFailure;
          const response = NextResponse.redirect(new URL("/login/reset-password", request.url));
          if (recoveryCookie) clearRecoveryCookie(response);
          return response;
        }
        if (!user && (isInvitation || isSignup)) {
          return NextResponse.redirect(new URL("/login?next=%2Fleads&error=auth_callback_failed", request.url));
        }
        if (isSignup) {
          // Signup confirmation is intentionally a sign-in checkpoint. Clear
          // the exchanged session so the login page does not claim the user
          // must sign in while a live authenticated cookie is still active.
          await supabase.auth.signOut().catch(() => undefined);
          return redirectAfterSignup();
        }
        const response = NextResponse.redirect(new URL(nextPath, request.url));
        if (recoveryCookie) clearRecoveryCookie(response);
        return response;
      }
    } catch {
      // Return a safe, user-facing error without leaking provider details.
    }
  }

  // Supabase's inviteUserByEmail deliberately does not use PKCE because the
  // recipient may accept from another browser. The client bridge stores that
  // implicit-flow session in cookies, then returns here with `flow=invite`.
  // Verify the server-side user before accepting the database invitation.
  if (isInvitation) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!error && user) {
        const invitationFailure = await acceptInvitationForUser(supabase, user);
        if (invitationFailure) return invitationFailure;
        return NextResponse.redirect(new URL("/login/reset-password", request.url));
      }
    } catch {
      // Return the same generic error below without leaking provider details.
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("error", "auth_callback_failed");
  return NextResponse.redirect(loginUrl);
}
