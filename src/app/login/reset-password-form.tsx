"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/auth";

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing">("checking");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;

    const markSession = (hasSession: boolean) => {
      if (active) setSessionState(hasSession ? "ready" : "missing");
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        markSession(Boolean(session));
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        markSession(false);
        return;
      }
      markSession(Boolean(data.session));
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const password = String(formData.get("password") ?? "");
      const confirmation = String(formData.get("confirmation") ?? "");

      if (password.length < 8) {
        setError("Use a password with at least 8 characters.");
        return;
      }
      if (password !== confirmation) {
        setError("Passwords do not match.");
        return;
      }

      try {
        const { error: updateError } = await createBrowserSupabaseClient().auth.updateUser({ password });
        if (updateError) {
          setError(
            /session|auth/i.test(updateError.message)
              ? "This reset link is invalid or expired. Request a new reset link and try again."
              : updateError.message,
          );
          return;
        }
        router.replace("/leads");
        router.refresh();
      } catch {
        setError("Your password could not be updated. Request a new reset link and try again.");
      }
    });
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      {sessionState === "checking" ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground" role="status">
          Verifying your reset link…
        </p>
      ) : null}
      {sessionState === "missing" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          This page needs a valid password-reset link. Request a new reset link from the sign-in page.
        </p>
      ) : null}
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">New password</label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={sessionState !== "ready" || isPending} />
      </div>
      <div className="space-y-2">
        <label htmlFor="confirmation" className="text-sm font-medium">Confirm new password</label>
        <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={sessionState !== "ready" || isPending} />
      </div>
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={sessionState !== "ready" || isPending}>{isPending ? "Updating…" : "Update password"}</Button>
      {sessionState === "missing" ? (
        <a className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="/login">
          Return to sign in
        </a>
      ) : null}
    </form>
  );
}
