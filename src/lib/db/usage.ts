import "server-only";

import { and, eq, sql } from "drizzle-orm";

import {
  organizationUsage,
  type Database,
  type OrganizationUsageKind,
} from "@/lib/db";

type LeadTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DEFAULT_LIMITS: Readonly<Record<OrganizationUsageKind, number>> = {
  domain_ingestion: 25,
  news_scan: 1,
  ai_action: 100,
};

const ENV_KEYS: Readonly<Record<OrganizationUsageKind, string>> = {
  domain_ingestion: "LEAD_INGESTION_DAILY_LIMIT",
  news_scan: "NEWS_SCAN_DAILY_LIMIT",
  ai_action: "AI_ACTION_DAILY_LIMIT",
};

export class OrganizationUsageLimitError extends Error {
  readonly name = "OrganizationUsageLimitError";

  constructor(
    readonly kind: OrganizationUsageKind,
    readonly limit: number,
    readonly usageDate: string,
  ) {
    super(
      `The ${kind.replaceAll("_", " ")} daily limit of ${limit} has been reached for ${usageDate}.`,
    );
  }
}

function positiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : fallback;
}

export function organizationUsageLimit(kind: OrganizationUsageKind): number {
  return positiveLimit(process.env[ENV_KEYS[kind]], DEFAULT_LIMITS[kind]);
}

/** Uses a UTC bucket so all application instances enforce the same period. */
export function usageDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function reserveOrganizationUsage(
  tx: LeadTransaction,
  input: Readonly<{
    organizationId: string;
    kind: OrganizationUsageKind;
    reservationKey: string;
    now?: Date;
    usageDate?: string;
  }>,
): Promise<Readonly<{ usageDate: string; count: number; limit: number }>> {
  const usageDate = input.usageDate ?? usageDateKey(input.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usageDate)) {
    throw new Error("Usage date must be an ISO calendar date.");
  }
  const limit = organizationUsageLimit(input.kind);

  // A short transaction-scoped advisory lock makes the count-and-insert
  // decision atomic across application instances. The reservation key makes
  // Inngest retries idempotent without allowing duplicate reservations.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`usage:${input.organizationId}:${usageDate}:${input.kind}`}, 0))`,
  );

  const existing = await tx
    .select({ id: organizationUsage.id })
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, input.organizationId),
        eq(organizationUsage.usageDate, usageDate),
        eq(organizationUsage.kind, input.kind),
        eq(organizationUsage.reservationKey, input.reservationKey),
      ),
    )
    .limit(1);

  const currentRows = await tx
    .select({ count: sql<number>`count(*)` })
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, input.organizationId),
        eq(organizationUsage.usageDate, usageDate),
        eq(organizationUsage.kind, input.kind),
      ),
    );
  const currentCount = Number(currentRows[0]?.count ?? 0);

  if (existing[0]) {
    return {
      usageDate,
      count: currentCount,
      limit,
    };
  }

  if (currentCount >= limit) {
    throw new OrganizationUsageLimitError(input.kind, limit, usageDate);
  }

  const rows = await tx
    .insert(organizationUsage)
    .values({
      organizationId: input.organizationId,
      usageDate,
      kind: input.kind,
      reservationKey: input.reservationKey,
    })
    .onConflictDoNothing({
      target: [
        organizationUsage.organizationId,
        organizationUsage.usageDate,
        organizationUsage.kind,
        organizationUsage.reservationKey,
      ],
    })
    .returning({ id: organizationUsage.id });

  const row = rows[0];
  if (!row) {
    // The advisory lock should make this impossible, but preserve a safe
    // failure mode if a future database topology changes that guarantee.
    throw new OrganizationUsageLimitError(input.kind, limit, usageDate);
  }

  return { usageDate, count: currentCount + 1, limit };
}

/** Releases a reservation when an event could not be submitted to Inngest. */
export async function releaseOrganizationUsage(
  tx: LeadTransaction,
  input: Readonly<{
    organizationId: string;
    kind: OrganizationUsageKind;
    reservationKey: string;
    now?: Date;
    usageDate?: string;
  }>,
): Promise<void> {
  const usageDate = input.usageDate ?? usageDateKey(input.now);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`usage:${input.organizationId}:${usageDate}:${input.kind}`}, 0))`,
  );
  await tx
    .delete(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, input.organizationId),
        eq(organizationUsage.usageDate, usageDate),
        eq(organizationUsage.kind, input.kind),
        eq(organizationUsage.reservationKey, input.reservationKey),
      ),
    );
}

export const __usageInternals = { positiveLimit, DEFAULT_LIMITS, ENV_KEYS };
