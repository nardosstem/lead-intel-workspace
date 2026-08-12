# Database migrations

This directory is owned by Drizzle Kit. Generate migrations with
`npm run db:generate` and apply them with `npm run db:migrate`.

The initial migration also contains the foreign key from `public.users.id` to
Supabase's managed `auth.users.id`. Do not add the `auth` schema to Drizzle's
managed schema exports. Lead tables use database triggers to append bounded
before/after snapshots to `audit_logs`; application mutations set actor and
organization transaction context before changing rows. Contact email, LinkedIn,
notes, and generated outreach are excluded from future snapshots.

Migration `0003_closed_chamber.sql` adds durable enrichment state to companies:
processing/complete status, ICP score, pain points, outreach draft, and the
completion timestamp. Raw Firecrawl Markdown remains in the workflow step
payload rather than being stored in audit snapshots.

Migration `0004_futuristic_stingray.sql` adds a canonical company domain and
an organization-scoped unique index for ingestion idempotency. It backfills
unambiguous existing HTTP(S) domains; ambiguous duplicates remain nullable for
manual review before a future dedupe migration.

Migration `0005_*.sql` stores Apollo person IDs on contacts with an
organization-scoped unique index so provider retries do not rely only on
mutable email or name heuristics.

Migration `0006_*.sql` adds composite organization-aware foreign keys for
company/contact relationships. This prevents a database client from attaching
a lead or pipeline record to a target owned by another organization, even if
application-level authorization is bypassed.

Migration `0007_*.sql` adds an organization-scoped enrichment run token and
sanitized failure fields. Inngest writes the token before provider work and
requires it for completion/failure updates, so stale retries cannot overwrite
a newer run or regress a completed company.

Migration `0008_*.sql` stores AI research, ICP rationale/signals, call prep,
and contact-specific outreach drafts. These are written through tenant-scoped
server actions, so the normal database audit triggers retain the before/after
record of each generated work product.

Migration `0009_*.sql` adds persisted organization defaults for the initial
pipeline stage and follow-up window. Settings updates are explicitly audited,
and new manual, CSV, and Apollo-ingested lead records consume the saved
defaults.

Migration `0010_*.sql` adds explicit organization roles (`owner`, `admin`, and
`member`) to user profiles. Existing organizations retain administrative access
by promoting their oldest profile to owner; new self-service workspaces start
with the signing-in user as owner. Role changes are tenant-scoped, audited, and
cannot remove the last owner. Existing-profile promotions are recorded as
system migration audit entries with a null actor.

Migration `0011_*.sql` adds active/deactivated membership state. Deactivated
members cannot load the workbench or execute mutations; owners must first
demote an owner before deactivating that account. Reactivation and deactivation
are audited tenant mutations.

Migration `0012_*.sql` adds organization invitations with an expiring,
audited lifecycle (`pending`—including uncertain email delivery—`accepted`, `failed`, or `revoked`). Invitations
are delivered through the Supabase Admin Auth API, and acceptance creates the
`public.users` profile only after the Auth callback verifies the session. The
database keeps invitations tenant-scoped and disallows inviting an owner role.

Migration `0013_*.sql` adds the news intelligence foundation: recurring
`monitoring_targets`, provider-normalized `news_items`, tenant-safe
`company_news_items`, typed `lead_signals`, and durable `signal_scans`. Article
metadata and excerpts are bounded at the application/schema boundary; full
article bodies are intentionally not persisted. All five tables use the shared
lead mutation trigger so discovery, classification, and scan lifecycle changes
remain auditable.

Migration `0016_*.sql` adds a tenant-scoped UTC usage ledger for domain
ingestion, news scans, and AI actions. Reservation keys make retries
idempotent; the ledger is also covered by the shared audit trigger.

Migration `0018_*.sql` adds `users.password_setup_at`; profiles that can be
identified as legacy non-invite members are backfilled, while ambiguous
accepted-invite profiles remain outside the workbench until they complete the
initial-password flow. Review those profiles operationally after migration.

Migration `0019_*.sql` adds a tenant-scoped `signal_scans.run_id` so queued
manual scans have a durable status row before their Inngest event is delivered.
Migration `0020_*.sql` adds the audited ingestion outbox and a five-minute
dispatcher that retries queued Apollo requests after an interrupted HTTP handoff.
