import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPublicEnvironment } from "@/lib/public-env";

export class SupabaseAdminConfigurationError extends Error {
  constructor(message = "Supabase Admin invitations are not configured.") {
    super(message);
    this.name = "SupabaseAdminConfigurationError";
  }
}

let adminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new SupabaseAdminConfigurationError(
      "Member invitations require SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }

  return (adminClient ??= createClient(getPublicEnvironment().supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }));
}
