const INTERNAL_ORIGIN = "https://lead-intel-internal.invalid";

/**
 * Accepts only an absolute-path redirect on this application origin.
 *
 * Backslashes are rejected explicitly because WHATWG URL parsing normalizes
 * them for HTTP(S) URLs; a value such as `/\\\\attacker.example` could
 * otherwise become an external redirect after parsing.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/leads";
  }

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return "/leads";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/leads";
  }
}
