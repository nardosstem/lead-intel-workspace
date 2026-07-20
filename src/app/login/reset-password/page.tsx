import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ResetPasswordForm } from "../reset-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Set a new password for your Lead Intel Workspace account.",
};

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md items-center justify-center py-10">
      <Card className="w-full">
        <CardHeader>
          <h1 className="font-heading text-xl font-medium">Set a new password</h1>
          <CardDescription>Choose a strong password for your Lead Intel Workspace account.</CardDescription>
        </CardHeader>
        <CardContent><ResetPasswordForm /></CardContent>
      </Card>
    </main>
  );
}
