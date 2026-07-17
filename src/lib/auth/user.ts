import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/auth/server";

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
