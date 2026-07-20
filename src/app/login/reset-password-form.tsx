"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/auth";

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
          setError(updateError.message);
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
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">New password</label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="space-y-2">
        <label htmlFor="confirmation" className="text-sm font-medium">Confirm new password</label>
        <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>{isPending ? "Updating…" : "Update password"}</Button>
    </form>
  );
}
