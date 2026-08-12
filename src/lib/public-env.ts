import { z } from "zod";

const publicEnvironmentSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  appUrl: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional(),
  ),
  // Public sign-up is useful for local bootstrapping, but is disabled by
  // default in production so an internal deployment cannot be turned into an
  // unbounded tenant/provider-spend factory by a copied environment.
  publicSignupEnabled: z.preprocess(
    (value) => value === "1" || (value === undefined && process.env.NODE_ENV !== "production"),
    z.boolean(),
  ),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

/** Safe client-facing feature check that does not throw when Supabase config is incomplete. */
export function isPublicSignupEnabled(): boolean {
  const configured = process.env.NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED;
  return configured === "1" || (configured === undefined && process.env.NODE_ENV !== "production");
}

export function getPublicEnvironment(): PublicEnvironment {
  return publicEnvironmentSchema.parse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    publicSignupEnabled: isPublicSignupEnabled(),
  });
}
