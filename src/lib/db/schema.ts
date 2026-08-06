import {
  check,
  boolean,
  date,
  foreignKey,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pipelineStages } from "./pipeline";

export { pipelineStages } from "./pipeline";
export type { PipelineStage } from "./pipeline";

export type AuditChanges = Readonly<Record<string, unknown>>;
export type AuditMetadata = Readonly<Record<string, unknown>>;

export const pipelineStageEnum = pgEnum("pipeline_stage", pipelineStages);
export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "member",
] as const);
export const organizationInvitationStatusEnum = pgEnum("organization_invitation_status", [
  "pending",
  "accepted",
  "failed",
  "revoked",
] as const);
export const newsSourceTypeEnum = pgEnum("news_source_type", ["gdelt", "rss"] as const);
export const leadSignalTypeEnum = pgEnum("lead_signal_type", [
  "ai_deployment",
  "vendor_partnership",
  "manual_review_hiring",
  "public_failure",
  "automation_commitment",
  "other",
  "unclassified",
] as const);
export const leadSignalUrgencyEnum = pgEnum("lead_signal_urgency", [
  "low",
  "medium",
  "high",
] as const);
export const leadSignalStatusEnum = pgEnum("lead_signal_status", [
  "new",
  "reviewed",
  "dismissed",
] as const);
export const signalScanStatusEnum = pgEnum("signal_scan_status", [
  "pending",
  "running",
  "completed",
  "failed",
] as const);
export const organizationUsageKindEnum = pgEnum("organization_usage_kind", [
  "domain_ingestion",
  "news_scan",
  "ai_action",
] as const);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    defaultPipelineStage: pipelineStageEnum("default_pipeline_stage")
      .notNull()
      .default("new"),
    defaultFollowUpDays: integer("default_follow_up_days")
      .notNull()
      .default(7),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "organizations_default_follow_up_days_check",
      sql`${table.defaultFollowUpDays} >= 1 AND ${table.defaultFollowUpDays} <= 90`,
    ),
    uniqueIndex("organizations_slug_uidx").on(table.slug),
  ],
).enableRLS();

/** Daily, tenant-scoped provider budget reservations. */
export const organizationUsage = pgTable(
  "organization_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    kind: organizationUsageKindEnum("kind").notNull(),
    reservationKey: varchar("reservation_key", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_usage_date_kind_key_uidx").on(
      table.organizationId,
      table.usageDate,
      table.kind,
      table.reservationKey,
    ),
    index("organization_usage_organization_date_kind_idx").on(
      table.organizationId,
      table.usageDate,
      table.kind,
    ),
  ],
).enableRLS();

/**
 * Application profile for a Supabase Auth identity.
 *
 * `users.id` is supplied by Supabase Auth. The initial SQL migration adds the
 * cross-schema FK to `auth.users(id)` so Drizzle does not attempt to own or
 * mutate Supabase's managed `auth` schema.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    fullName: varchar("full_name", { length: 160 }),
    avatarUrl: text("avatar_url"),
    role: organizationRoleEnum("role").notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_organization_id_idx").on(table.organizationId),
  ],
).enableRLS();

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    email: varchar("email", { length: 320 }).notNull(),
    role: organizationRoleEnum("role").notNull().default("member"),
    status: organizationInvitationStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "organization_invitations_non_owner_role_check",
      sql`${table.role} <> 'owner'`,
    ),
    index("organization_invitations_email_status_idx").on(table.email, table.status),
    index("organization_invitations_organization_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
  ],
).enableRLS();

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 120 }).notNull(),
    entityId: text("entity_id").notNull(),
    changes: jsonb("changes").$type<AuditChanges>().notNull().default({}),
    metadata: jsonb("metadata").$type<AuditMetadata>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
).enableRLS();

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    /** Canonical hostname used for provider ingestion deduplication. */
    domain: varchar("domain", { length: 253 }),
    website: varchar("website", { length: 500 }),
    industry: varchar("industry", { length: 120 }),
    size: varchar("size", { length: 80 }),
    location: varchar("location", { length: 160 }),
    status: varchar("status", { length: 40 }).notNull().default("prospect"),
    enrichmentStatus: varchar("enrichment_status", { length: 40 })
      .notNull()
      .default("pending"),
    enrichmentRunId: uuid("enrichment_run_id"),
    enrichmentError: varchar("enrichment_error", { length: 1000 }),
    enrichmentErrorAt: timestamp("enrichment_error_at", { withTimezone: true }),
    icpScore: integer("icp_score"),
    icpRationale: text("icp_rationale"),
    icpSignals: jsonb("icp_signals")
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    researchSummary: text("research_summary"),
    researchPainPoints: jsonb("research_pain_points")
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    researchSignals: jsonb("research_signals")
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    callPrep: text("call_prep"),
    painPoints: jsonb("pain_points")
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([]),
    outreachDraft: text("outreach_draft"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "companies_icp_score_check",
      sql`${table.icpScore} IS NULL OR (${table.icpScore} >= 0 AND ${table.icpScore} <= 100)`,
    ),
    index("companies_organization_id_idx").on(table.organizationId),
    uniqueIndex("companies_organization_domain_uidx").on(
      table.organizationId,
      table.domain,
    ),
    uniqueIndex("companies_id_organization_uidx").on(
      table.id,
      table.organizationId,
    ),
    index("companies_status_idx").on(table.organizationId, table.status),
    index("companies_enrichment_status_idx").on(
      table.organizationId,
      table.enrichmentStatus,
    ),
    index("companies_enrichment_run_id_idx").on(
      table.organizationId,
      table.enrichmentRunId,
    ),
    index("companies_created_at_idx").on(table.organizationId, table.createdAt),
  ],
).enableRLS();

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    apolloId: varchar("apollo_id", { length: 160 }),
    name: varchar("name", { length: 160 }).notNull(),
    title: varchar("title", { length: 160 }),
    email: varchar("email", { length: 320 }),
    linkedin: varchar("linkedin", { length: 500 }),
    notes: text("notes"),
    outreachDraft: text("outreach_draft"),
    outreachDraftAt: timestamp("outreach_draft_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("contacts_organization_id_idx").on(table.organizationId),
    index("contacts_company_id_idx").on(table.companyId),
    index("contacts_email_idx").on(table.organizationId, table.email),
    uniqueIndex("contacts_organization_apollo_uidx").on(
      table.organizationId,
      table.apolloId,
    ),
    uniqueIndex("contacts_id_organization_uidx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      columns: [table.companyId, table.organizationId],
      foreignColumns: [companies.id, companies.organizationId],
      name: "contacts_company_organization_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** One current pipeline record may target either a company or a contact. */
export const pipeline = pgTable(
  "pipeline",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    stage: pipelineStageEnum("stage").notNull().default("new"),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "pipeline_single_target_check",
      sql`num_nonnulls(${table.companyId}, ${table.contactId}) = 1`,
    ),
    index("pipeline_organization_stage_idx").on(
      table.organizationId,
      table.stage,
    ),
    index("pipeline_company_id_idx").on(table.companyId),
    index("pipeline_contact_id_idx").on(table.contactId),
    index("pipeline_follow_up_idx").on(
      table.organizationId,
      table.nextFollowUpAt,
    ),
    uniqueIndex("pipeline_company_uidx").on(table.companyId),
    uniqueIndex("pipeline_contact_uidx").on(table.contactId),
    foreignKey({
      columns: [table.companyId, table.organizationId],
      foreignColumns: [companies.id, companies.organizationId],
      name: "pipeline_company_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId, table.organizationId],
      foreignColumns: [contacts.id, contacts.organizationId],
      name: "pipeline_contact_organization_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** Companies that should be checked for new intelligence on a recurring basis. */
export const monitoringTargets = pgTable(
  "monitoring_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    rssFeedUrl: varchar("rss_feed_url", { length: 500 }),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(50),
    scanFrequencyDays: integer("scan_frequency_days").notNull().default(7),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    nextScanAt: timestamp("next_scan_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "monitoring_targets_priority_check",
      sql`${table.priority} >= 0 AND ${table.priority} <= 100`,
    ),
    check(
      "monitoring_targets_scan_frequency_days_check",
      sql`${table.scanFrequencyDays} >= 1 AND ${table.scanFrequencyDays} <= 90`,
    ),
    uniqueIndex("monitoring_targets_organization_company_uidx").on(
      table.organizationId,
      table.companyId,
    ),
    index("monitoring_targets_due_idx").on(
      table.organizationId,
      table.enabled,
      table.nextScanAt,
    ),
    foreignKey({
      columns: [table.companyId, table.organizationId],
      foreignColumns: [companies.id, companies.organizationId],
      name: "monitoring_targets_company_organization_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** Provider-normalized article metadata. Full article bodies are never stored. */
export const newsItems = pgTable(
  "news_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    canonicalUrl: varchar("canonical_url", { length: 2_048 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    publisher: varchar("publisher", { length: 160 }),
    sourceDomain: varchar("source_domain", { length: 253 }),
    sourceType: newsSourceTypeEnum("source_type").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    excerpt: varchar("excerpt", { length: 2_000 }),
    contentHash: varchar("content_hash", { length: 128 }),
    rawMetadata: jsonb("raw_metadata")
      .$type<Readonly<Record<string, string | number | boolean | null>>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("news_items_organization_canonical_url_uidx").on(
      table.organizationId,
      table.canonicalUrl,
    ),
    uniqueIndex("news_items_id_organization_uidx").on(table.id, table.organizationId),
    index("news_items_organization_published_at_idx").on(
      table.organizationId,
      table.publishedAt,
    ),
    index("news_items_organization_source_type_idx").on(
      table.organizationId,
      table.sourceType,
    ),
  ],
).enableRLS();

/** Tenant-scoped relationship between an article and the company it mentions. */
export const companyNewsItems = pgTable(
  "company_news_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    newsItemId: uuid("news_item_id").notNull(),
    relevanceScore: integer("relevance_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "company_news_items_relevance_score_check",
      sql`${table.relevanceScore} >= 0 AND ${table.relevanceScore} <= 100`,
    ),
    uniqueIndex("company_news_items_organization_company_news_uidx").on(
      table.organizationId,
      table.companyId,
      table.newsItemId,
    ),
    index("company_news_items_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    index("company_news_items_organization_news_idx").on(
      table.organizationId,
      table.newsItemId,
    ),
    foreignKey({
      columns: [table.companyId, table.organizationId],
      foreignColumns: [companies.id, companies.organizationId],
      name: "company_news_items_company_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.newsItemId, table.organizationId],
      foreignColumns: [newsItems.id, newsItems.organizationId],
      name: "company_news_items_news_organization_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** A normalized intelligence signal extracted from a news item. */
export const leadSignals = pgTable(
  "lead_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    newsItemId: uuid("news_item_id"),
    signalType: leadSignalTypeEnum("signal_type").notNull(),
    confidence: integer("confidence").notNull().default(0),
    workflow: varchar("workflow", { length: 240 }),
    decisionMakerRole: varchar("decision_maker_role", { length: 160 }),
    rationale: varchar("rationale", { length: 2_000 }),
    evidence: varchar("evidence", { length: 2_000 }),
    urgency: leadSignalUrgencyEnum("urgency").notNull().default("medium"),
    recommendedAction: varchar("recommended_action", { length: 2_000 }),
    status: leadSignalStatusEnum("status").notNull().default("new"),
    model: varchar("model", { length: 120 }),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "lead_signals_confidence_check",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 100`,
    ),
    uniqueIndex("lead_signals_organization_company_news_type_uidx").on(
      table.organizationId,
      table.companyId,
      table.newsItemId,
      table.signalType,
    ),
    index("lead_signals_organization_company_idx").on(
      table.organizationId,
      table.companyId,
      table.createdAt,
    ),
    index("lead_signals_organization_type_idx").on(
      table.organizationId,
      table.signalType,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.companyId, table.organizationId],
      foreignColumns: [companies.id, companies.organizationId],
      name: "lead_signals_company_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.newsItemId, table.organizationId],
      foreignColumns: [newsItems.id, newsItems.organizationId],
      name: "lead_signals_news_organization_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** Durable run record for scheduled/manual discovery and enrichment. */
export const signalScans = pgTable(
  "signal_scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: signalScanStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    candidatesFound: integer("candidates_found").notNull().default(0),
    articlesFetched: integer("articles_fetched").notNull().default(0),
    signalsExtracted: integer("signals_extracted").notNull().default(0),
    error: varchar("error", { length: 1_000 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "signal_scans_counts_check",
      sql`${table.candidatesFound} >= 0 AND ${table.articlesFetched} >= 0 AND ${table.signalsExtracted} >= 0`,
    ),
    index("signal_scans_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("signal_scans_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
).enableRLS();

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationUsage = typeof organizationUsage.$inferSelect;
export type NewOrganizationUsage = typeof organizationUsage.$inferInsert;
export type OrganizationUsageKind = (typeof organizationUsageKindEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OrganizationRole = (typeof organizationRoleEnum.enumValues)[number];
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Pipeline = typeof pipeline.$inferSelect;
export type NewPipeline = typeof pipeline.$inferInsert;
export type MonitoringTarget = typeof monitoringTargets.$inferSelect;
export type NewMonitoringTarget = typeof monitoringTargets.$inferInsert;
export type NewsItem = typeof newsItems.$inferSelect;
export type NewNewsItem = typeof newsItems.$inferInsert;
export type CompanyNewsItem = typeof companyNewsItems.$inferSelect;
export type NewCompanyNewsItem = typeof companyNewsItems.$inferInsert;
export type LeadSignal = typeof leadSignals.$inferSelect;
export type NewLeadSignal = typeof leadSignals.$inferInsert;
export type SignalScan = typeof signalScans.$inferSelect;
export type NewSignalScan = typeof signalScans.$inferInsert;
