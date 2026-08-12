import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/redirect";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Lead Intel Workspace.",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{ next?: string; error?: string; confirmed?: string }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackError = params.error === "auth_callback_failed";
  const emailConfirmed = params.confirmed === "1";
  const workspaceAccessDisabled = params.error === "workspace_access_disabled";
  const invitationConflict = params.error === "invitation_conflict";
  const invitationExpired = params.error === "invitation_expired";
  const workspaceSignupDisabled = params.error === "workspace_signup_disabled";

  return (
    <main className="mx-auto flex w-full max-w-md items-center justify-center py-10">
      <Card className="w-full">
        <CardHeader>
          <h1 className="font-heading text-xl font-medium">Lead Intel Workspace</h1>
          <CardDescription>
            Sign in to research accounts, manage your pipeline, and run enrichment workflows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {callbackError ? (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              The confirmation link could not be completed. Request a new link or sign in again.
            </p>
          ) : null}
          {emailConfirmed ? (
            <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
              Email confirmed. Sign in with the password you created.
            </p>
          ) : null}
          {workspaceAccessDisabled ? (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              Workspace access is disabled for this account. Contact your organization owner.
            </p>
          ) : null}
          {invitationConflict ? (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              This account already belongs to another organization. Contact an owner before accepting the invitation.
            </p>
          ) : null}
          {invitationExpired ? (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              This invitation is expired, revoked, or no longer available. Ask an organization owner to send a new invitation.
            </p>
          ) : null}
          {workspaceSignupDisabled ? (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
              New workspace sign-up is disabled for this internal deployment. Ask the workspace owner to invite you.
            </p>
          ) : null}
          <LoginForm nextPath={safeNextPath(params.next)} />
        </CardContent>
      </Card>
    </main>
  );
}
