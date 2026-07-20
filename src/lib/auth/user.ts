import "server-only";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

import { createClient } from "@/lib/auth/server";
import { getDatabase, organizations, users } from "@/lib/db";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required to perform this operation.");
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Returns a server-verified Supabase user. Never authorize from session data
 * alone; authorization must additionally validate organization membership.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
}

export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return user;
}

export async function getCurrentOrganizationName(userId: string): Promise<string | null> {
  try {
    const rows = await getDatabase()
      .select({ name: organizations.name })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.name ?? null;
  } catch {
    // The shell can still render the authenticated header during a transient
    // database outage; protected lead operations surface their own errors.
    return null;
  }
}
