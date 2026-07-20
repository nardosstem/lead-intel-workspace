# Lead Intel Workspace

A production-oriented monolithic Next.js application for replacing fragmented
lead research workflows. The shared foundation and first Lead Intelligence
Workbench module are implemented; additional domain modules can follow the
same feature boundary.

## Stack

- Next.js 16 App Router, React 19, and strict TypeScript
- Tailwind CSS 4 and shadcn/ui (Base UI primitives)
- Supabase Auth, Postgres, and Storage
- Drizzle ORM and Drizzle Kit migrations
- `next-themes`, Lucide icons, and Sonner toasts
- Provider-neutral AI contracts with a Claude MCP adapter
- Inngest durable background functions, Apollo lead extraction, and Firecrawl website scraping

`package.json` and `package-lock.json` are the dependency source of truth.
[`requirements.txt`](./requirements.txt) is an implementation contract for
future work, not a Python package manifest.

## Quick start

Requirements: Node.js 20.9 or newer, npm, and a Supabase project.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Populate `.env.local`
before exercising Supabase or database-backed paths:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
DATABASE_URL=postgresql://postgres:password@db.your-project-ref.supabase.co:5432/postgres?sslmode=require
CLAUDE_MCP_ENDPOINT=http://localhost:8787/mcp/tools
CLAUDE_MCP_AUTH_TOKEN=optional-bearer-token
APOLLO_API_KEY=your-apollo-master-api-key
FIRECRAWL_API_KEY=fc-your-firecrawl-api-key
INNGEST_EVENT_KEY=your-inngest-event-key
INNGEST_SIGNING_KEY=signkey-prod-...
```

Use a direct connection for migrations. At runtime, Supabase's session pooler
is also supported because the Postgres.js client disables prepared statements.
Never prefix `DATABASE_URL` or service-role credentials with `NEXT_PUBLIC_`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local Next.js development |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run check` | Run lint and type checks |
| `npm run db:generate` | Generate SQL after a Drizzle schema change |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Inspect the configured database |
| `npm run db:seed:leads` | Insert a deterministic demo workspace with 10 companies, 20 contacts, and pipeline rows |
| `npm run db:verify-boundaries` | Verify tenant foreign keys, cascades, and transactional cleanup against `DATABASE_URL` |
| `npm run e2e` | Run Playwright browser smoke/accessibility coverage (Chromium required) |
| `npm test` | Run Apollo, Firecrawl, and Inngest contract tests |

GitHub Actions runs `npm test`, `npm run check`, `npm run build`, and the
Chromium browser suite for pushes to `main` and pull requests. Provider-backed
and authenticated staging tests remain a separate deployment gate because CI
does not receive production credentials.
CSV imports are capped at 5 MB and 500 rows. Valid rows commit independently
through database savepoints, while duplicate or invalid rows return source-row
errors; Next Server Actions allow a 6 MB bounded request to accommodate
serialization overhead.

Browser coverage is kept separate because it needs a local browser binary and
authenticated staging credentials for protected lead-workbench flows. Run
`npx playwright install chromium` once, then `npm run e2e`. The current suite
covers the public authentication shell, keyboard-visible labels, dark mode, and
anonymous route protection; add authenticated staging coverage before enabling
provider-consuming tests in CI.

## Architecture

```text
src/
├── app/                    # Routes and Next.js boundaries only
├── components/
│   ├── shared/             # App shell, layouts, theme, shared states
│   └── ui/                 # shadcn/ui design-system primitives
├── features/               # Domain modules (lead-workbench)
├── hooks/                  # Cross-cutting client hooks
├── lib/
│   ├── ai/                 # Provider contract, factory, adapters
│   ├── auth/               # Supabase browser/server clients and session logic
│   └── db/                 # Drizzle client, schema, and migrations
├── inngest/                # Durable lead ingestion client and functions
└── proxy.ts                # Next.js 16 request boundary/session refresh
```

The architecture follows these dependency directions:

```text
app routes -> feature modules -> shared interfaces/infrastructure
shared UI  -> ui primitives
features   -> IAIProvider (never a concrete AI provider)
```

The first domain module is `src/features/lead-workbench`. Its server actions,
validation, CSV parser, AI actions, tables, forms, pipeline board, audit view,
and settings view are kept inside that feature boundary. `src/app/leads` is a
thin route composition layer.

AI research, ICP scoring, call preparation, and outreach drafts persist to the
tenant-scoped lead records through audited server mutations; the UI refreshes
the detail workspace after background ingestion and exposes retryable failures.

Route files compose features and own Next.js concerns. Domain validation,
queries, mutations, services, and feature-specific UI live under a single
`src/features/<feature>` boundary. Cross-feature imports should go through an
explicit public entry point rather than reaching into another feature's
internals.

## Core systems

### Database

`src/lib/db/schema.ts` defines:

- `organizations`: tenant identity and stable slug.
- `users`: application profiles keyed by the corresponding Supabase Auth UUID.
- `audit_logs`: append-oriented records of actor, action, entity, changes, and
  metadata for “who changed what.”
- `companies`, `contacts`, and `pipeline`: organization-scoped lead records;
  companies keep a canonical domain with an organization-scoped uniqueness
  boundary for provider ingestion, and contacts retain Apollo IDs for stable
  retry deduplication;
  pipeline uses one current record per company or contact and an enum-backed
  stage from New through Won/Lost. Composite organization-aware foreign keys
  prevent contacts and pipeline rows from crossing tenant boundaries.

The audit view resolves actor names/emails when available and supports local
search across actions, entities, and actors. It intentionally displays the
latest 100 tenant entries; add server-side pagination before high-volume use.

Ingestion stores an organization-scoped run token plus a sanitized error state
on the company. Completion and failure writes require the active token, so a
late retry cannot overwrite a newer run; failed records remain visible and can
be retried from the company detail view.

The initial migration adds the cross-schema foreign key to
`auth.users(id)` manually. This keeps Supabase's managed `auth` schema outside
Drizzle ownership. It also enables row-level security on all public tables with
no permissive policies, so browser access is denied by default. Add reviewed
tenant policies in a migration before exposing feature data through Supabase's
browser client.

Change the schema with this workflow:

1. Edit `src/lib/db/schema.ts`.
2. Run `npm run db:generate`.
3. Review the generated SQL, including destructive statements and RLS effects.
4. Apply locally with `npm run db:migrate`.
5. Commit the schema, SQL migration, snapshot, and journal together.

The Drizzle connection is server-only, typed to the full schema, reused during
development hot reloads, and configured for Supabase poolers.

Run `npm run db:verify-boundaries` against staging after migrations. It uses
random temporary IDs inside a transaction, verifies cross-organization target
rejection and company-delete cascades, then rolls everything back.

Lead mutations set transaction-local actor and organization context. Database
triggers on companies, contacts, and pipeline automatically append before/after
JSON snapshots to `audit_logs`, including cascaded deletes.

The seed script creates a representative demo workspace with 10 companies, 20
contacts, all eight pipeline stages, enrichment examples, follow-up dates, and
deterministic UUIDs. It is safe to rerun with `npm run db:seed:leads`; existing
deterministic fixtures are reconciled without duplicating rows, and the command
reports inserted and updated records. It requires a migrated Supabase database.
Because the seed data belongs to a demo organization, create or map a Supabase
Auth profile to that organization before expecting it to appear for a signed-in
user.

### Authentication and storage

- `auth/client.ts` creates the browser Supabase client.
- `auth/server.ts` creates a request-scoped server client using async Next.js
  cookies.
- `auth/middleware.ts` refreshes sessions through `src/proxy.ts`, the Next.js 16
  replacement for the deprecated middleware file convention.
- `auth/user.ts` exposes server-verified current-user helpers.

#### Local demo user

There is no preconfigured email or password, and the seed script cannot create
Supabase Auth credentials. The `/login` route supports sign-in and self-service
sign-up. Confirmation links use the `/auth/callback` PKCE exchange route and
return to the requested workspace path. For local testing, use an address such as `demo@leadintel.local` and a
strong, local-only password of your choice. If email confirmation is enabled,
confirm the user before signing in.

On the first authenticated visit, the app automatically creates the required
`public.users` profile. If the seeded `lead-intel-demo` organization exists and
has no members, that first user is attached to it; otherwise a new isolated
workspace is created. For controlled staging/provisioning, you can instead
link an Auth user explicitly in the Supabase SQL Editor, replacing the email if
needed:

```sql
insert into public.users (id, organization_id, email, full_name)
select
  id,
  '10000000-0000-4000-8000-000000000001'::uuid,
  email,
  'Demo User'
from auth.users
where email = 'demo@leadintel.local'
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  email = excluded.email,
  full_name = excluded.full_name;
```

Passwords remain managed by Supabase Auth and are never stored in
`public.users`. The app redirects unauthenticated users from `/leads` to
`/login` and provides sign-out from the workspace header.

The proxy only refreshes authentication state. It is not an authorization
boundary. Every Server Function, Route Handler, and server-side service must
verify the user and organization access at the point of mutation or data read.
The same Supabase clients expose `.storage`; use private buckets by default and
authorize object paths by organization.

### UI foundation

The root layout provides a responsive persistent shadcn sidebar, sticky header,
system-aware light/dark theme, tooltip provider, and global toast host. Next.js
`loading.tsx`, `error.tsx`, and `global-error.tsx` provide shared pending and
failure states. The Lead workbench, audit history, and settings views are
available from the persistent navigation.

Installed design-system primitives include Button, Input, Textarea, Select,
Table, Dialog, Dropdown Menu, Card, Sidebar, Skeleton, Tooltip, Sheet,
Separator, and Sonner toast. Reuse these primitives before introducing
one-off controls.

### AI provider abstraction

Business logic depends only on `IAIProvider`, whose typed operations are:

- `extractEntities<T>()`, with a Zod schema for runtime-safe structured output
- `summarizeText()`
- `generateDraft()`

`createAIProvider()` is the composition root. `ClaudeMCPProvider` is the first
adapter and receives a `ClaudeMCPTransport`; it does not instantiate or couple
features to a specific MCP SDK. The transport must return the documented
adapter envelopes (`entities` or `text`, with optional model and token usage),
and the provider validates every response before returning it.

```ts
const provider = createAIProvider({
  provider: "claude-mcp",
  transport: applicationMcpTransport,
});

const service = new LeadResearchService(provider); // accepts IAIProvider
```

Provider calls must execute on the server. Include organization, actor, and
trace context; do not send secrets or unnecessary personal data in prompts.

### Lead workbench behavior

`/leads` provides dashboard KPIs, an eight-stage horizontally scrollable
pipeline, responsive searchable/filterable company and contact tables, manual
forms, CSV import, Quick Add Domain ingestion, detail dialogs, audit history,
and workspace preferences.
The UI is empty-state safe when no authenticated organization profile exists;
mutations and AI actions return actionable errors until the user is signed in.
Set `CLAUDE_MCP_ENDPOINT` to an HTTP bridge that accepts `{ name, arguments }`
and returns the response envelope expected by `ClaudeMCPProvider`.

Quick Add Domain sends a typed `lead.ingest.requested` event to Inngest and
returns immediately. The durable `ingest-lead` function then fetches up to five
Apollo contacts, saves tenant-scoped records early, scrapes the company with
Firecrawl, asks `IAIProvider` for ICP score/pain points/outreach, and saves the
enrichment with an audit entry. Run the Inngest Dev Server locally when testing
background execution (`npx inngest-cli@latest dev -u
http://localhost:3000/api/inngest`); set `INNGEST_DEV=1` for the local app. The
app serves functions at `/api/inngest`.
The current Inngest SDK publishes the Next.js adapter as `inngest/next`; the
separate `@inngest/next` package requested by older setup guides is not
published, so it is intentionally not added as a dead dependency.

## Adding a feature

Before implementation, read `AGENTS.md`, this README, and `requirements.txt`.
Then:

1. Create `src/features/<feature-name>` with an explicit public `index.ts`.
2. Define Zod input schemas and domain types at the feature boundary.
3. Keep database and external-provider access in server-only services.
4. Add thin routes under `src/app` that compose the feature.
5. Enforce authentication, organization authorization, and RLS together.
6. Write an audit log in the same transaction as every material mutation.
7. Cover domain behavior and authorization before enabling navigation.
8. Run `npm run check` and `npm run build`.

## Security baseline

- Secrets stay in ignored root `.env*` files; only `.env.example` is committed.
- Server modules use `server-only` to prevent accidental client bundling.
- Public database tables start with RLS enabled and no allow policies.
- Supabase user identity is server verified; session presence alone is not
  authorization.
- Organization scope is mandatory in queries, storage paths, AI context, and
  audit records.
- Apollo, Firecrawl, and Inngest credentials are server-only and never use
  `NEXT_PUBLIC_` names.
- `package.json` overrides Next.js's nested PostCSS dependency to the patched
  8.5.19 release; re-check this override when upgrading Next.js.
- The deployable audit gate is `npm audit --omit=dev`; a separate moderate
  development-only esbuild advisory remains transitive through Drizzle Kit
  0.31.10, whose automated fix is a breaking downgrade.
- `INNGEST_DEV=1` is for local development only; deployed handlers require
  `INNGEST_SIGNING_KEY` so webhook requests are authenticated.
- Expected errors are modeled as typed results; unexpected failures reach the
  nearest application error boundary and must be reported without leaking
  sensitive details.

## Current scope

The initial lead-workbench module, self-service authentication flow, and durable
Apollo/Firecrawl/AI ingestion workflow are included under
`src/features/lead-workbench` and `src/inngest`. Billing, invitations/roles,
and a production MCP deployment remain separately reviewed concerns.
