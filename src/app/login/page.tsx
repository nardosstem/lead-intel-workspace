import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Lead Intel Workspace.",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{ next?: string }>;
}>;

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/leads";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

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
          <LoginForm nextPath={safeNextPath(params.next)} />
        </CardContent>
      </Card>
    </main>
  );
}
