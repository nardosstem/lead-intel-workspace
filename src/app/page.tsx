import { Bot, Database, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const foundations = [
  {
    title: "Identity and tenancy",
    description:
      "Supabase Auth is connected to typed user and organization profiles.",
    icon: ShieldCheck,
  },
  {
    title: "Typed persistence",
    description:
      "Drizzle owns application schema and migrations against Supabase Postgres.",
    icon: Database,
  },
  {
    title: "Provider-neutral AI",
    description:
      "Domain services depend on an interface, with Gemini as the default and Claude MCP as fallback.",
    icon: Bot,
  },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <section className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Foundation</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Lead intelligence, ready to build.
        </h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          The application shell and shared infrastructure are in place. Open
          the Lead workbench to research, qualify, and move opportunities.
        </p>
      </section>

      <section
        className="grid gap-4 md:grid-cols-3"
        aria-label="Application foundations"
      >
        {foundations.map(({ title, description, icon: Icon }) => (
          <Card key={title}>
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-xs font-medium text-muted-foreground">
                Configured
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Button render={<Link href="/leads" />}>Open lead workbench</Button>
    </div>
  );
}
