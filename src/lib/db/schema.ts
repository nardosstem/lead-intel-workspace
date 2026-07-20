import {
  check,
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

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Pipeline = typeof pipeline.$inferSelect;
export type NewPipeline = typeof pipeline.$inferInsert;
