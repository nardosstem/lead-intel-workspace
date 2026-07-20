import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LeadWorkbench } from "@/features/lead-workbench/components/workbench";
import { ensureLeadContext } from "@/features/lead-workbench/server/context";
import { getWorkbenchSnapshot } from "@/features/lead-workbench/server/data";
import { getCurrentUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leads",
  description: "Research and move leads through the Lead Intel pipeline.",
};

const workbenchViews = [
  "dashboard",
  "pipeline",
  "companies",
  "contacts",
  "audit",
  "settings",
] as const;

type LeadsPageProps = Readonly<{
  searchParams: Promise<{ view?: string }>;
}>;

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/leads");
  }

  await ensureLeadContext();
  const params = await searchParams;
  const view = workbenchViews.includes(params.view as (typeof workbenchViews)[number])
    ? (params.view as (typeof workbenchViews)[number])
    : "dashboard";
  const snapshot = await getWorkbenchSnapshot();
  return <LeadWorkbench key={view} initialView={view} initialData={snapshot} />;
}
