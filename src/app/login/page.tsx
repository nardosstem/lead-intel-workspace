import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Lead Intel Workspace.",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{ next?: string; error?: string }>;
}>;

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/leads";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackError = params.error === "auth_callback_failed";
  const workspaceAccessDisabled = params.error === "workspace_access_disabled";

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
          {workspaceAccessDisabled ? (
            <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              Workspace access is disabled for this account. Contact your organization owner.
            </p>
          ) : null}
          <LoginForm nextPath={safeNextPath(params.next)} />
        </CardContent>
      </Card>
    </main>
  );
}
