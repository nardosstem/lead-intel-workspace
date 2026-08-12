ALTER TABLE "users" ADD COLUMN "password_setup_at" timestamp with time zone;
-- Existing self-service/legacy members already had an application password.
-- Accepted invitation profiles remain unset because the previous schema did
-- not record whether the invitee completed initial password setup; requiring a
-- one-time reset for those ambiguous profiles is the safe migration choice.
UPDATE "users" AS u
SET "password_setup_at" = COALESCE(u."created_at", now())
WHERE NOT EXISTS (
  SELECT 1
  FROM "organization_invitations" AS i
  WHERE i."organization_id" = u."organization_id"
    AND lower(i."email") = lower(u."email")
    AND i."status" = 'accepted'
);
