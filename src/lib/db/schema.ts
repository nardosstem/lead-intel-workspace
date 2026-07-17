import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type AuditChanges = Readonly<Record<string, unknown>>;
export type AuditMetadata = Readonly<Record<string, unknown>>;

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
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

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
