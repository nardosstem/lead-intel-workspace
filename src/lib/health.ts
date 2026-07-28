import "server-only";

import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { getPublicEnvironment } from "@/lib/public-env";

export type HealthDependencyState = "configured" | "missing";

export type HealthSnapshot = Readonly<{
  status: "ok" | "degraded" | "unhealthy";
  checks: Readonly<{
    database: "ok" | "error";
    supabase: HealthDependencyState;
    apollo: HealthDependencyState;
    firecrawl: HealthDependencyState;
    gemini: HealthDependencyState;
    claudeMcp: HealthDependencyState;
    inngest: HealthDependencyState;
    invitations: HealthDependencyState;
    serverActions: HealthDependencyState;
  }>;
}>;

function configured(value: string | undefined): HealthDependencyState {
  return value?.trim() ? "configured" : "missing";
}

function supabaseState(): HealthDependencyState {
  try {
    getPublicEnvironment();
    return "configured";
  } catch {
    return "missing";
  }
}

function inngestState(): HealthDependencyState {
  const isDev = process.env.NODE_ENV !== "production" && process.env.INNGEST_DEV === "1";
  const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
  const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY?.trim());
  return isDev || (hasEventKey && hasSigningKey) ? "configured" : "missing";
}

/**
 * Reports liveness plus non-secret configuration readiness. Provider network
 * reachability is intentionally not probed here because Apollo/Firecrawl/AI
 * calls can consume credits or trigger long-running work.
 */
export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  let database: "ok" | "error" = "ok";
  try {
    await getDatabase().execute(sql`select 1`);
  } catch {
    database = "error";
  }

  const checks = {
    database,
    supabase: supabaseState(),
    apollo: configured(process.env.APOLLO_API_KEY),
    firecrawl: configured(process.env.FIRECRAWL_API_KEY),
    gemini: configured(process.env.GEMINI_API_KEY),
    claudeMcp: configured(process.env.CLAUDE_MCP_ENDPOINT),
    inngest: inngestState(),
    invitations: configured(process.env.SUPABASE_SERVICE_ROLE_KEY),
    serverActions: configured(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY),
  } as const;
  const aiConfigured = checks.gemini === "configured" || checks.claudeMcp === "configured";
  const requiredChecks = [
    checks.supabase,
    checks.apollo,
    checks.firecrawl,
    checks.inngest,
    checks.serverActions,
  ];
  const hasMissingDependency =
    !aiConfigured ||
    requiredChecks.some((state) => state === "missing") ||
    checks.invitations === "missing";

  return {
    status: database === "error" ? "unhealthy" : hasMissingDependency ? "degraded" : "ok",
    checks,
  };
}
