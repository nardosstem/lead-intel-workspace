import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnvironment } from "@/lib/public-env";

export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabasePublishableKey } = getPublicEnvironment();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. `src/proxy.ts` performs
          // session refreshes, while Server Functions and Route Handlers can
          // use this callback normally.
        }
      },
    },
  });
}
