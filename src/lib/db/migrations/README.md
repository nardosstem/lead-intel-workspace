# Database migrations

This directory is owned by Drizzle Kit. Generate migrations with
`npm run db:generate` and apply them with `npm run db:migrate`.

The initial migration also contains the foreign key from `public.users.id` to
Supabase's managed `auth.users.id`. Do not add the `auth` schema to Drizzle's
managed schema exports. Lead tables use database triggers to append before/after
snapshots to `audit_logs`; application mutations set actor and organization
transaction context before changing rows.

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
