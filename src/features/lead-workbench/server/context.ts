import "server-only";

import { eq, sql } from "drizzle-orm";

import { getCurrentUser, requireCurrentUser } from "@/lib/auth/user";
import { getDatabase, users, type Database } from "@/lib/db";

export type LeadContext = Readonly<{
  userId: string;
  organizationId: string;
}>;

export async function getLeadContext(): Promise<LeadContext | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const db = getDatabase();
  const profile = await db
    .select({ organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const organizationId = profile[0]?.organizationId;

  return organizationId ? { userId: user.id, organizationId } : null;
}

export async function requireLeadContext(): Promise<LeadContext> {
  const user = await requireCurrentUser();
  const db = getDatabase();
  const profile = await db
    .select({ organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const organizationId = profile[0]?.organizationId;

  if (!organizationId) {
    throw new Error("An organization profile is required for lead access.");
  }

  return { userId: user.id, organizationId };
}

type DatabaseTransactionCallback = Parameters<Database["transaction"]>[0];
export type LeadTransaction = Parameters<DatabaseTransactionCallback>[0];

/** Sets trigger context and executes a mutation in one transaction. */
export async function withLeadMutationContext<T>(
  context: LeadContext,
  operation: (tx: LeadTransaction, context: LeadContext) => Promise<T>,
): Promise<T> {
  const db = getDatabase();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${context.userId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${context.organizationId}, true)`,
    );
    return operation(tx, context);
  });
}

/** Uses the current request identity for a foreground mutation. */
export async function withLeadMutation<T>(
  operation: (tx: LeadTransaction, context: LeadContext) => Promise<T>,
): Promise<T> {
  return withLeadMutationContext(await requireLeadContext(), operation);
}
