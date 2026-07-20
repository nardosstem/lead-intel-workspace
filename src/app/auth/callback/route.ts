import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/auth/server";
import { acceptPendingOrganizationInvitation, InvitationConflictError } from "@/lib/auth/invitations";

function safeNextPath(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/leads";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        const user = data.session?.user;
        if (user?.email) {
          try {
            await acceptPendingOrganizationInvitation({ userId: user.id, email: user.email });
          } catch (invitationError) {
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
        return NextResponse.redirect(new URL(nextPath, request.url));
      }
    } catch {
      // Return a safe, user-facing error without leaking provider details.
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("error", "auth_callback_failed");
  return NextResponse.redirect(loginUrl);
}
