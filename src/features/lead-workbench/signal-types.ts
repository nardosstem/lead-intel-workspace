export const leadSignalTypes = [
  "ai_deployment",
  "vendor_partnership",
  "manual_review_hiring",
  "public_failure",
  "automation_commitment",
  "other",
] as const;

export type LeadSignalType = (typeof leadSignalTypes)[number];

/**
 * The presentation contract for a persisted company signal.
 *
 * The news-monitoring backend can add fields without changing the workbench
 * component contract. Evidence is intentionally bounded by the caller so the
 * detail view never becomes an article archive.
 */
export type LeadSignal = Readonly<{
  id: string;
  signalType: LeadSignalType;
  title: string;
  summary: string;
  workflow: string | null;
  decisionMaker: string | null;
  confidence: number | null;
  evidence: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
}>;

export const leadSignalTypeLabels: Readonly<Record<LeadSignalType, string>> = {
  ai_deployment: "AI deployment",
  vendor_partnership: "Vendor partnership",
  manual_review_hiring: "Manual-review hiring",
  public_failure: "Public failure",
  automation_commitment: "Automation commitment",
  other: "Other signal",
};

/** Keep external links constrained to ordinary public web pages. */
export function safeSignalSourceHref(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Accept either a 0..1 confidence or a 0..100 score from an adapter. */
export function formatSignalConfidence(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const score = value <= 1 ? value * 100 : value;
  return `${Math.round(Math.min(100, Math.max(0, score)))}% confidence`;
}

export function formatSignalDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
