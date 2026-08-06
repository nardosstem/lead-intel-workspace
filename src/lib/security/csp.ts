/** Generates a per-request nonce for the strict script policy. */
export function createContentSecurityNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The request header is forwarded so Next.js can attach the nonce to its
 * generated scripts. Inline styles remain allowed for component-library
 * compatibility; executable scripts are nonce-bound in production.
 */
export function createContentSecurityPolicy(
  nonce: string,
  isDevelopment = process.env.NODE_ENV !== "production",
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:54321 ws://localhost:54321 https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
