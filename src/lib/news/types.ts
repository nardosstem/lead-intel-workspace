import { z } from "zod";

export const newsSourceTypes = ["gdelt", "rss"] as const;
export type NewsSourceType = (typeof newsSourceTypes)[number];

/**
 * Metadata that is safe to persist alongside an article. Providers are
 * allowed to return arbitrary JSON, so adapters deliberately project their
 * responses into this bounded shape before returning it.
 */
export const newsMetadataSchema = z
  .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((metadata) => Object.keys(metadata).length <= 20, {
    message: "News metadata cannot contain more than 20 fields.",
  });

export type NewsMetadata = z.infer<typeof newsMetadataSchema>;

export const newsArticleSchema = z.object({
  canonicalUrl: z.url().max(2_048),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().min(1).max(160).nullable(),
  sourceDomain: z.string().trim().min(1).max(253).nullable(),
  sourceType: z.enum(newsSourceTypes),
  publishedAt: z.date().nullable(),
  discoveredAt: z.date(),
  excerpt: z.string().trim().max(2_000).nullable(),
  metadata: newsMetadataSchema,
});

export type NewsArticle = z.infer<typeof newsArticleSchema>;

export const newsSearchOptionsSchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxRecords: z.number().int().min(1).max(250).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export type NewsSearchOptions = z.infer<typeof newsSearchOptionsSchema>;

export interface NewsSource {
  search(options: NewsSearchOptions): Promise<NewsArticle[]>;
}

export class NewsSourceError extends Error {
  readonly status: number;
  readonly source: NewsSourceType;

  constructor(source: NewsSourceType, message: string, status = 0) {
    super(message);
    this.name = "NewsSourceError";
    this.source = source;
    this.status = status;
  }
}

/** Stable signal taxonomy used by deterministic and AI classifiers. */
export const signalTypeSchema = z.enum([
  "ai_deployment",
  "vendor_partnership",
  "manual_review_hiring",
  "public_failure",
  "automation_commitment",
  "other",
  "unclassified",
]);

export type SignalType = z.infer<typeof signalTypeSchema>;
export const signalUrgencySchema = z.enum(["low", "medium", "high"]);
export type SignalUrgency = z.infer<typeof signalUrgencySchema>;

export const signalSchema = z.object({
  signalType: signalTypeSchema,
  confidence: z.number().int().min(0).max(100),
  workflow: z.string().trim().min(1).max(240),
  decisionMakerRole: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(600),
  evidence: z.string().trim().min(1).max(1_000),
  urgency: signalUrgencySchema,
  recommendedAction: z.string().trim().min(1).max(600),
});

export type LeadSignal = z.infer<typeof signalSchema>;
export const signalExtractionSchema = z.object({
  signals: z.array(signalSchema).max(5),
  overallRelevance: z.number().int().min(0).max(100),
});
export type SignalExtraction = z.infer<typeof signalExtractionSchema>;

/** Company-specific candidate used before scraping and AI enrichment. */
export const newsCandidateSchema = newsArticleSchema.extend({
  organizationId: z.string().min(1),
  companyId: z.string().min(1),
  companyName: z.string().trim().min(1).max(240),
  companyDomain: z.string().trim().max(253).optional(),
  matchedSignalType: signalTypeSchema.optional(),
  sourceQuality: z.number().min(0).max(1).optional(),
});
export type NewsCandidate = z.infer<typeof newsCandidateSchema>;

export type NewsQuery = Readonly<{
  signalType: Exclude<SignalType, "other" | "unclassified">;
  query: string;
}>;

export type NewsScoreFactors = Readonly<{
  recency: number;
  sourceQuality: number;
  targetPriority: number;
  icpFit: number;
  keywordMatch: number;
  novelty: number;
}>;

export type ScoredNewsCandidate = Readonly<{
  candidate: NewsCandidate;
  score: number;
  factors: NewsScoreFactors;
}>;
