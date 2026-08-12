import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { acceptPendingOrganizationInvitation, InvitationConflictError } from "@/lib/auth/invitations";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const flow = request.nextUrl.searchParams.get("flow");
  const authType = request.nextUrl.searchParams.get("type");
  const isRecovery = flow === "recovery" || authType === "recovery";
  const isSignup = flow === "signup" || authType === "signup";
  const isInvitation = flow === "invite" || authType === "invite";
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
    return NextResponse.redirect(loginUrl);
  };

  async function acceptInvitationForUser(
    supabase: Awaited<ReturnType<typeof createClient>>,
    user: { id: string; email?: string | null },
  ): Promise<NextResponse | null> {
    if (isRecovery || !isInvitation) return null;

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
        if (user && isInvitation) {
          const invitationFailure = await acceptInvitationForUser(supabase, user);
          if (invitationFailure) return invitationFailure;
        }
        if (!user && (isInvitation || isSignup)) {
          return NextResponse.redirect(new URL("/login?next=%2Fleads&error=auth_callback_failed", request.url));
        }
        return isSignup
          ? redirectAfterSignup()
          : NextResponse.redirect(new URL(nextPath, request.url));
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
