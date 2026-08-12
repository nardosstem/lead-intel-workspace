import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { AcceptInvitation } from "./accept-invitation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invitation",
  description: "Accept an invitation to a Lead Intel Workspace.",
};

export default function AcceptInvitationPage() {
  return (
    <main className="mx-auto flex w-full max-w-md items-center justify-center py-10">
      <Card className="w-full">
        <CardHeader>
          <h1 className="font-heading text-xl font-medium">Accept workspace invitation</h1>
          <CardDescription>Verifying your invitation before you set a password.</CardDescription>
        </CardHeader>
        <CardContent><AcceptInvitation /></CardContent>
      </Card>
    </main>
  );
}
