"use client";

import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/auth";

type InvitationState = "checking" | "failed";

/**
 * Supabase Admin invitation links carry the session in a URL fragment. The
 * fragment never reaches the server, and @supabase/ssr deliberately uses
 * PKCE, so its automatic URL-session detector correctly refuses this
 * implicit-flow callback. Extract only the two session tokens here and pass
 * them to the cookie-backed client via `setSession` instead.
 */
export function invitationTokensFromHash(hash: string):
  | Readonly<{ accessToken: string; refreshToken: string }>
  | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

/**
 * Completes Supabase's non-PKCE invitation flow. Invite credentials arrive in
 * the URL fragment, which is intentionally unavailable to server code. The
 * browser explicitly persists those tokens in the SSR client's cookie storage;
 * only then do we navigate to the server callback that authorizes the tenant
 * membership and asks the invitee to set an initial password.
 */
export function AcceptInvitation() {
  const [state, setState] = useState<InvitationState>("checking");
  const redirecting = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;

    const continueToCallback = () => {
      if (redirecting.current) return;
      redirecting.current = true;
      // Keep credentials out of browser history before navigating. Fragments
      // are not sent in HTTP requests, but retaining them locally is still an
      // unnecessary exposure on a shared or inspected browser.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      window.location.replace("/auth/callback?flow=invite&next=%2Fleads");
    };

    void (async () => {
      const tokens = invitationTokensFromHash(window.location.hash);
      if (!tokens) {
        if (active) setState("failed");
        return;
      }

      const { data, error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (error || !data.session) {
        if (active) setState("failed");
        return;
      }
      if (active) continueToCallback();
    })().catch(() => {
      if (active) setState("failed");
    });

    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground" role="status">
        Verifying your invitation…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        This invitation link is invalid or expired. Ask an organization owner to send a new invitation.
      </p>
      <a href="/login" className={buttonVariants({ variant: "outline", className: "w-full" })}>
        Return to sign in
      </a>
    </div>
  );
}
