"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";

import { createBrowserSupabaseClient } from "@/lib/auth";
import { buttonVariants, Button } from "@/components/ui/button";

export function UserMenu({ email }: Readonly<{ email: string | null }>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  if (!email) {
    return (
      <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/login">
        Sign in
      </Link>
    );
  }

  function signOut() {
    startTransition(async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error("Could not sign out. Please try again.");
        return;
      }

      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-44 truncate text-xs text-muted-foreground sm:inline">
        {email}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={signOut}
        disabled={isPending}
      >
        {isPending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
