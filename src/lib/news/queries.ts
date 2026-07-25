import type { NewsQuery } from "./types";

const queryTerms: ReadonlyArray<NewsQuery["signalType"]> = [
  "ai_deployment",
  "vendor_partnership",
  "manual_review_hiring",
  "public_failure",
  "automation_commitment",
];

const termsByType: Record<NewsQuery["signalType"], string> = {
  ai_deployment:
    '(AI OR "artificial intelligence" OR automation) (deploy* OR adopt* OR launch* OR implement*)',
  vendor_partnership:
    '(partner* OR partnership OR integrat* OR selected OR vendor) (platform OR software OR technology)',
  manual_review_hiring:
    '("manual review" OR "quality analyst" OR "operations analyst" OR "trust and safety") (hiring OR jobs OR careers OR workforce)',
  public_failure:
    "(outage OR breach OR recall OR incident OR failure OR lawsuit OR disruption)",
  automation_commitment:
    '(CEO OR founder OR executive OR leadership) (automation OR automate OR "AI strategy" OR transformation)',
};

function cleanTerm(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[(){}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function quote(value: string): string {
  return `"${cleanTerm(value, 160).replaceAll('"', "")}"`;
}

/**
 * Builds bounded, provider-neutral searches. The query strings are safe to
 * pass to GDELT, RSS adapters, or a future paid news provider.
 */
export function buildSignalQueries(
  companyName: string,
  companyDomain?: string,
): NewsQuery[] {
  const name = cleanTerm(companyName, 160);
  if (!name) return [];

  const domain = companyDomain
    ? cleanTerm(companyDomain, 253)
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .toLowerCase()
    : "";
  const subject = domain && domain !== name.toLowerCase() ? `(${quote(name)} OR ${quote(domain)})` : quote(name);

  return queryTerms.map((signalType) => ({
    signalType,
    query: `${subject} ${termsByType[signalType]}`.slice(0, 480),
  }));
}

