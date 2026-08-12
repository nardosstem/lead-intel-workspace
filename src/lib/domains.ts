const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const blockedSuffixes = [".localhost", ".local", ".internal", ".test", ".invalid"] as const;

function resolvesToPrivateAddress(hostname: string): boolean {
  // Numeric IPv4/IPv6 literals are rejected by the domain grammar already;
  // this guard also rejects common decimal/hex encodings if URL parsing is
  // ever broadened. DNS resolution is intentionally not performed here:
  // callers use this predicate on hot request paths and must not block on a
  // resolver; outbound clients separately disable redirects.
  return /^(?:0x|0o|0b|\d)/i.test(hostname) || hostname.includes(":");
}

export function isPublicHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase();
  return (
    hostnamePattern.test(hostname) &&
    !resolvesToPrivateAddress(hostname) &&
    !blockedSuffixes.some((suffix) => hostname.endsWith(suffix))
  );
}
