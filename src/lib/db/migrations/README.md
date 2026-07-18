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
