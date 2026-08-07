import "server-only";

import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { getPublicEnvironment } from "@/lib/public-env";
import {
  isAiActionsEnabled,
  isLeadIngestionEnabled,
  isNewsScanEnabled,
} from "@/lib/runtime-controls";

export type HealthDependencyState = "configured" | "missing";
export type HealthControlState = "enabled" | "disabled";
export type HealthDatabaseFailure =
  | "missing-url"
  | "invalid-url"
  | "unreachable"
  | "authentication"
  | "unknown"
  | null;

export type HealthSnapshot = Readonly<{
  status: "ok" | "degraded" | "unhealthy";
  checks: Readonly<{
    database: "ok" | "error";
    databaseFailure: HealthDatabaseFailure;
    databaseErrorCode: string | null;
    supabase: HealthDependencyState;
    apollo: HealthDependencyState;
    firecrawl: HealthDependencyState;
    gemini: HealthDependencyState;
    claudeMcp: HealthDependencyState;
    inngest: HealthDependencyState;
    invitations: HealthDependencyState;
    serverActions: HealthDependencyState;
    controls: Readonly<{
      leadIngestion: HealthControlState;
      aiActions: HealthControlState;
      newsScan: HealthControlState;
    }>;
  }>;
}>;

function configured(value: string | undefined): HealthDependencyState {
  return value?.trim() ? "configured" : "missing";
}

function classifyDatabaseFailure(error: unknown): Exclude<HealthDatabaseFailure, null> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (error instanceof Error && error.name === "ZodError") {
    return "invalid-url";
  }

  if (message.includes("invalid url") || message.includes("invalid input")) {
    return "invalid-url";
  }

  if (
    /authentication failed|password authentication failed|no pg_hba|permission denied|sasl|scram|client password|password must be a string|role .* does not exist|database .* does not exist/.test(
      message,
    )
  ) {
    return "authentication";
  }

  if (
    /connect|timeout|timed out|econn|enotfound|eai_again|enet|ehost|unreach|refused|socket|dns|host|network|connection terminated|server closed|unexpected eof/.test(
      message,
    )
  ) {
    return "unreachable";
  }

  return "unknown";
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_\-]{1,64}$/.test(code) ? code : null;
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
  let databaseFailure: HealthDatabaseFailure = null;
  let databaseCode: string | null = null;

  if (!process.env.DATABASE_URL?.trim()) {
    database = "error";
    databaseFailure = "missing-url";
  } else {
    try {
      await getDatabase().execute(sql`select 1`);
    } catch (error) {
      database = "error";
      databaseFailure = classifyDatabaseFailure(error);
      databaseCode = databaseErrorCode(error);
    }
  }

  const checks = {
    database,
    databaseFailure,
    databaseErrorCode: databaseCode,
    supabase: supabaseState(),
    apollo: configured(process.env.APOLLO_API_KEY),
    firecrawl: configured(process.env.FIRECRAWL_API_KEY),
    gemini: configured(process.env.GEMINI_API_KEY),
    claudeMcp: configured(process.env.CLAUDE_MCP_ENDPOINT),
    inngest: inngestState(),
    invitations: configured(process.env.SUPABASE_SERVICE_ROLE_KEY),
    serverActions: configured(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY),
    controls: {
      leadIngestion: isLeadIngestionEnabled() ? "enabled" : "disabled",
      aiActions: isAiActionsEnabled() ? "enabled" : "disabled",
      newsScan: isNewsScanEnabled() ? "enabled" : "disabled",
    },
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
