const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const blockedSuffixes = [".localhost", ".local", ".internal", ".test", ".invalid"] as const;

export function isPublicHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase();
  return (
    hostnamePattern.test(hostname) &&
    !blockedSuffixes.some((suffix) => hostname.endsWith(suffix))
  );
}
