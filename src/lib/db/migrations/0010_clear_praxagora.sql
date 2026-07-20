CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "organization_role" DEFAULT 'member' NOT NULL;
--> statement-breakpoint
-- Preserve administrative access for existing workspaces by making the oldest
-- profile in each organization the initial owner. New profiles are explicitly
-- provisioned as owners by the application context helper.
WITH ranked_users AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS rank
  FROM "users"
), promoted_users AS (
  UPDATE "users" AS u
  SET "role" = 'owner'
  FROM ranked_users AS ranked
  WHERE u.id = ranked.id AND ranked.rank = 1
  RETURNING u.id, u.organization_id
)
INSERT INTO "audit_logs" (
  "organization_id", "actor_user_id", "action", "entity_type", "entity_id", "changes", "metadata"
)
SELECT
  promoted.organization_id,
  NULL,
  'member_role_migrated',
  'user',
  promoted.id::text,
  jsonb_build_object('before', jsonb_build_object('role', 'member'), 'after', jsonb_build_object('role', 'owner')),
  jsonb_build_object('source', 'migration-0010')
FROM promoted_users AS promoted;
