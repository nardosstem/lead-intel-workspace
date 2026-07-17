import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment } from "@/lib/public-env";

/** Refreshes the Supabase session cookie at the Next.js request boundary. */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabasePublishableKey } = getPublicEnvironment();

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          if (cookiesToSet.length > 0) {
            response.headers.set("Cache-Control", "private, no-store");
          }
        },
      },
    },
  );

  // Do not insert logic between client creation and this verification call.
  // Supabase uses it to refresh an expired access token when possible.
  await supabase.auth.getClaims();

  return response;
}
