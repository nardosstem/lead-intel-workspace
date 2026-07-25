import { newsCandidateSchema, type NewsCandidate, type NewsScoreFactors, type ScoredNewsCandidate } from "./types";

export type NewsScoringContext = Readonly<{
  now?: Date;
  targetPriority?: number;
  icpScore?: number;
  lastSeenAt?: Date | null;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageInDays(date: Date | null | undefined, now: Date): number {
  if (!date || Number.isNaN(date.getTime())) return 14;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

/** Remove tracking parameters so repeated feeds cannot create duplicate work. */
export function canonicalizeNewsUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return input.trim();
  }
}

function keywordMatch(candidate: NewsCandidate): number {
  const text = `${candidate.title} ${candidate.excerpt ?? ""}`.toLowerCase();
  if (!candidate.matchedSignalType) return 0;
  const patterns: Record<NonNullable<NewsCandidate["matchedSignalType"]>, RegExp> = {
    ai_deployment: /\b(ai|artificial intelligence|automation|automate|machine learning)\b/,
    vendor_partnership: /\b(partner|partnership|integrat|selected|vendor)\w*\b/,
    manual_review_hiring: /\b(manual review|quality analyst|operations analyst|trust and safety|hiring|jobs)\b/,
    public_failure: /\b(outage|breach|recall|incident|failure|lawsuit|disruption)\b/,
    automation_commitment: /\b(ceo|founder|executive|automation|ai strategy|transformation)\b/,
    other: /\b\w+\b/,
    unclassified: /$^/,
  };
  return patterns[candidate.matchedSignalType].test(text) ? 20 : 0;
}

/**
 * Ranks article candidates before expensive scraping or AI calls. Every
 * component is bounded and explainable so operators can tune it later.
 */
export function scoreNewsCandidate(
  rawCandidate: NewsCandidate,
  context: NewsScoringContext = {},
): ScoredNewsCandidate {
  const candidate = newsCandidateSchema.parse(rawCandidate);
  const now = context.now ?? new Date();
  const recency = clamp(30 - ageInDays(candidate.publishedAt, now), 0, 30);
  const sourceQuality = clamp((candidate.sourceQuality ?? 0.5) * 20, 0, 20);
  const targetPriority = clamp((context.targetPriority ?? 50) / 100 * 15, 0, 15);
  const icpFit = clamp((context.icpScore ?? 50) / 100 * 15, 0, 15);
  const keyword = clamp(keywordMatch(candidate), 0, 20);
  const novelty = context.lastSeenAt && candidate.publishedAt
    ? candidate.publishedAt > context.lastSeenAt ? 5 : 0
    : 5;
  const factors: NewsScoreFactors = {
    recency,
    sourceQuality,
    targetPriority,
    icpFit,
    keywordMatch: keyword,
    novelty,
  };
  const score = Math.round(recency + sourceQuality + targetPriority + icpFit + keyword + novelty);
  return { candidate, score: clamp(score, 0, 100), factors };
}

/** Deduplicates by canonical URL, retaining the strongest candidate. */
export function rankNewsCandidates(
  candidates: readonly NewsCandidate[],
  context: NewsScoringContext = {},
): ScoredNewsCandidate[] {
  const bestByUrl = new Map<string, ScoredNewsCandidate>();
  candidates.forEach((candidate) => {
    const scored = scoreNewsCandidate(candidate, context);
    const key = canonicalizeNewsUrl(scored.candidate.canonicalUrl);
    const existing = bestByUrl.get(key);
    if (!existing || scored.score > existing.score) bestByUrl.set(key, scored);
  });

  return [...bestByUrl.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftDate = left.candidate.publishedAt?.getTime() ?? 0;
    const rightDate = right.candidate.publishedAt?.getTime() ?? 0;
    return rightDate - leftDate;
  });
}

export function selectTopNewsCandidates(
  candidates: readonly NewsCandidate[],
  limit = 5,
  context: NewsScoringContext = {},
): ScoredNewsCandidate[] {
  if (!Number.isInteger(limit) || limit < 1) return [];
  return rankNewsCandidates(candidates, context).slice(0, Math.min(limit, 50));
}
