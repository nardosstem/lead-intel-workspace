import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment } from "@/lib/public-env";
import {
  createContentSecurityNonce,
  createContentSecurityPolicy,
} from "@/lib/security/csp";

/** Refreshes the Supabase session cookie at the Next.js request boundary. */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const nonce = createContentSecurityNonce();
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the request policy when attaching the nonce to generated
  // scripts during dynamic rendering.
  requestHeaders.set("content-security-policy", contentSecurityPolicy);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
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

          requestHeaders.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers: requestHeaders } });

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

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}
