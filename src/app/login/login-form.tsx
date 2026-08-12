"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/auth";
import { isPublicSignupEnabled } from "@/lib/public-env";

type LoginMode = "sign-in" | "sign-up" | "forgot-password";

export function LoginForm({ nextPath }: Readonly<{ nextPath: string }>) {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const publicSignupEnabled = isPublicSignupEnabled();

  function submit(formData: FormData) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "");
      const fullName = String(formData.get("fullName") ?? "").trim();

      if (!email) {
        setError("Email is required.");
        return;
      }

      try {
        const supabase = createBrowserSupabaseClient();
        if (mode === "forgot-password") {
          // Preserve recovery intent outside mutable query parameters. The
          // callback consumes and clears this short-lived, callback-scoped
          // cookie even if an email client strips custom URL parameters.
          const callbackUrl = new URL("/auth/callback", window.location.origin);
          callbackUrl.searchParams.set("next", "/login/reset-password");
          callbackUrl.searchParams.set("flow", "recovery");
          const resetResult = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: callbackUrl.toString(),
          });
          if (resetResult.error) {
            setError(resetResult.error.message);
            return;
          }
          document.cookie = "lead_intel_recovery=1; Max-Age=900; Path=/auth/callback; SameSite=Lax";
          setMessage("If an account exists for that email, a password reset link is on its way.");
          return;
        }

        if (!password) {
          setError("Email and password are required.");
          return;
        }
        if (password.length < 8) {
          setError("Use a password with at least 8 characters.");
          return;
        }

        const result =
          mode === "sign-in"
            ? await supabase.auth.signInWithPassword({ email, password })
            : await supabase.auth.signUp({
                email,
                password,
                options: {
                  ...(fullName ? { data: { full_name: fullName } } : {}),
                  emailRedirectTo: (() => {
                    const callbackUrl = new URL("/auth/callback", window.location.origin);
                    callbackUrl.searchParams.set("next", nextPath);
                    callbackUrl.searchParams.set("flow", "signup");
                    return callbackUrl.toString();
                  })(),
                },
              });

        if (result.error) {
          setError(result.error.message);
          return;
        }

        if (mode === "sign-up" && !result.data.session) {
          setMessage("Check your email to confirm the account, then sign in.");
          setMode("sign-in");
          return;
        }

        router.replace(nextPath);
        router.refresh();
      } catch {
        setError("Authentication is not configured correctly. Check Supabase settings.");
      }
    });
  }

  const isSignUp = mode === "sign-up";
  const isForgotPassword = mode === "forgot-password";

  return (
    <form action={submit} className="space-y-4" noValidate>
      {isSignUp ? (
        <div className="space-y-2">
          <label htmlFor="fullName" className="text-sm font-medium">
            Name <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input id="fullName" name="fullName" autoComplete="name" placeholder="Alex Morgan" />
        </div>
      ) : null}
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
        />
      </div>
      {!isForgotPassword ? <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={8}
          required
        />
      </div> : null}
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Please wait…" : isForgotPassword ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
      </Button>
      {mode === "sign-in" ? (
        <button
          type="button"
          className="w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => {
            setMode("forgot-password");
            setError(null);
            setMessage(null);
          }}
        >
          Forgot your password?
        </button>
      ) : null}
      {publicSignupEnabled ? <button
        type="button"
        className="w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => {
          setMode(isForgotPassword ? "sign-in" : isSignUp ? "sign-in" : "sign-up");
          setError(null);
          setMessage(null);
        }}
      >
        {isForgotPassword ? "Back to sign in" : isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
      </button> : null}
    </form>
  );
}
