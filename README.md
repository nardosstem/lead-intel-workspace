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
- Provider-neutral AI contracts with a Gemini default adapter and Claude MCP fallback
- Inngest durable background functions, Apollo lead extraction, Firecrawl website scraping, and a provider-neutral news signal contract

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
AI_PROVIDER=gemini
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_SEARCH_ENABLED=1
# Keep 0 for a free-tier Gemini project; private contact data falls back to Claude.
GEMINI_ALLOW_PRIVATE_DATA=0
# Set either switch to 0 for an emergency provider-spend stop.
LEAD_INGESTION_ENABLED=1
AI_ACTIONS_ENABLED=1
CLAUDE_MCP_ENDPOINT=http://localhost:8787/mcp/tools
CLAUDE_MCP_AUTH_TOKEN=optional-bearer-token
APOLLO_API_KEY=your-apollo-master-api-key
FIRECRAWL_API_KEY=fc-your-firecrawl-api-key
INNGEST_EVENT_KEY=your-inngest-event-key
INNGEST_SIGNING_KEY=signkey-prod-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
# Conservative UTC per-organization provider budgets.
LEAD_INGESTION_DAILY_LIMIT=25
NEWS_SCAN_DAILY_LIMIT=1
AI_ACTION_DAILY_LIMIT=100
# Server-only; use a stable value across production instances.
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=base64-or-hex-deployment-secret
# Server-only; required for organization invitations. Never expose this key to the browser.
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

`GET /api/health` is a public, cache-disabled deployment check. It verifies
database liveness and reports non-secret dependency configuration—including the
stable Server Actions key—as `ok`, `degraded`, or `unhealthy`; it deliberately
does not probe provider networks or consume Apollo/Firecrawl/AI credits.
The response also reports the current non-secret runtime control state for
ingestion, AI actions, and news scanning.
Configure the hosting platform to treat HTTP 503 (`unhealthy`) as a failed
readiness check.

Use a direct connection for migrations. At runtime, Supabase's session pooler
is also supported because the Postgres.js client disables prepared statements.
Never prefix `DATABASE_URL` or service-role credentials with `NEXT_PUBLIC_`.

The application enforces these UTC, per-organization budgets for domain
ingestion, news scans, and foreground AI actions. Reservations use idempotency
keys, so Inngest retries do not spend the same budget twice. Increase limits
only after provider terms and spend ceilings are approved.
`LEAD_INGESTION_ENABLED=0` stops new Apollo workflows, while
`AI_ACTIONS_ENABLED=0` stops AI enrichment and foreground AI actions; news
scanning remains explicitly controlled by `NEWS_SCAN_ENABLED` and falls back to
deterministic extraction when AI is disabled.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local Next.js development |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run check` | Run lint and type checks |
| `npm run audit:production` | Fail on high/critical production dependency vulnerabilities |
| `npm run db:generate` | Generate SQL after a Drizzle schema change |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Inspect the configured database |
| `npm run db:seed:leads` | Insert a deterministic demo workspace with 10 companies, 20 contacts, and pipeline rows (local/disposable staging only) |
| `npm run db:verify-boundaries` | Verify tenant foreign keys, cascades, and transactional cleanup against `DATABASE_URL` |
| `npm run e2e` | Run Playwright browser smoke/accessibility coverage (Chromium required) |
| `npm test` | Run provider, AI, domain, action, validation, and Inngest contract tests |
| `npm run test:coverage` | Run the same suite with a V8 coverage report |
| `npm run test:integration` | Run authenticated Server Action CRUD and tenant-isolation tests against a disposable PostgreSQL database |

GitHub Actions runs the V8 coverage suite, `npm run check`, `npm run build`, and the
Chromium browser suite for pushes to `main` and pull requests. It also runs the
authenticated Server Action integration suite against its ephemeral PostgreSQL
service. Provider-backed
and authenticated staging tests remain a separate deployment gate because CI
does not receive production credentials.
CSV imports are capped at 5 MB and 500 rows. Company websites are optional, but
when supplied they must be public HTTP(S) URLs; private/reserved hosts are
rejected before persistence. Valid rows commit independently through database
savepoints, while duplicate or invalid rows return source-row errors; Next
Server Actions allow a 6 MB bounded request to accommodate serialization
overhead.

Browser coverage is kept separate because it needs a local browser binary and
authenticated staging credentials for protected lead-workbench flows. Run
`npx playwright install chromium` once, then `npm run e2e`. The current suite
covers the public authentication shell, keyboard-visible labels, dark mode,
anonymous route protection, and an opt-in read-only authenticated workbench
flow. Set `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` only in a disposable staging
environment to run the protected flow; CI skips it when those secrets are
absent. Provider-consuming ingestion tests remain a separate gate.
The unit coverage report has a conservative repository-wide baseline (35% lines,
35% statements, 40% functions, and 30% branches): pure parsers, validation,
provider adapters, and workflow policies are covered locally, while
database-backed Server Actions and authenticated provider flows require the
staging gates below.

`npm run test:integration` is intentionally excluded from the default unit
suite. It requires `DATABASE_URL` for an ephemeral PostgreSQL database plus
`LEAD_INTEL_INTEGRATION_TEST=1`; the CI workflow supplies both against its
disposable service. Do not point it at a production database.

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

The workbench uses bounded server-side pages for company, contact, and pipeline
records (50 by default, 100 maximum), with tenant-scoped search and filters
executed in Postgres. Dashboard KPIs use aggregate queries rather than the
current page. The contact/company selector is capped at 5,000 lightweight
options; introduce a searchable option endpoint before exceeding that size.
The audit view resolves actor names/emails when available and intentionally
displays the latest 100 tenant entries; add audit pagination before high-volume
use.

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
The command refuses to run when `NODE_ENV=production` unless
`ALLOW_DEMO_SEED=1` is set deliberately; never seed a production tenant or
expose demo records to real users.
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
Supabase Auth credentials. The `/login` route supports sign-in, self-service
sign-up, and password reset. Confirmation and recovery links use the
`/auth/callback` PKCE exchange route with distinct flow markers. A signup
confirmation verifies the email and returns to sign-in with a clear confirmation
message; it does not change the password chosen during signup. A password reset
request returns to `/login/reset-password`, where the short-lived recovery
session is verified before the new-password form is enabled. Expired, reused, or
directly opened reset pages fail closed and ask for a new link.

Supabase email invitations use a separate `/auth/accept-invitation` browser
bridge because invitation links use an implicit-flow URL fragment rather than
PKCE. The bridge persists the verified Auth session, the server callback
accepts the pending organization membership, and the invitee is then sent to
set an initial password. Configure this URL alongside `/auth/callback` in
Supabase Authentication → URL Configuration.

Always start the flow from the same origin where it will be completed. A link
generated from `http://localhost:3000` returns to localhost; a link generated
from the deployed Vercel URL returns to that deployed callback. Configure both
origins under Supabase Authentication → URL Configuration when developing
locally and in production. For local testing, use an address such as
`demo@leadintel.local` and a strong, local-only password of your choice. If
email confirmation is enabled, confirm the user before signing in.

On the first authenticated visit, the app automatically creates the required
`public.users` profile. If the seeded `lead-intel-demo` organization exists and
has no members, that first user is attached to it; otherwise a new isolated
workspace is created. First-login organization/member provisioning is recorded
in the tenant audit history. For controlled staging/provisioning, you can instead
link an Auth user explicitly in the Supabase SQL Editor, replacing the email if
needed:

```sql
insert into public.users (id, organization_id, email, full_name, role)
select
  id,
  '10000000-0000-4000-8000-000000000001'::uuid,
  email,
  'Demo User',
  'owner'
from auth.users
where email = 'demo@leadintel.local'
on conflict (id) do update
set
  organization_id = excluded.organization_id,
  email = excluded.email,
  full_name = excluded.full_name,
  role = 'owner',
  is_active = true,
  deactivated_at = null;
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

`getAIProvider()` is the application composition root and `createAIProvider()`
remains the lower-level adapter factory. `GeminiProvider` is the
default direct API adapter when `GEMINI_API_KEY` is configured; it uses
`gemini-2.5-flash` by default, supports Zod-backed structured output, and can
run a bounded Google Search grounding pass for public research. `ClaudeMCPProvider`
is the fallback adapter and receives a `ClaudeMCPTransport`; it does not
instantiate or couple features to a specific MCP SDK. Both adapters validate
provider responses before returning them.

```ts
const provider = createAIProvider({
  provider: "claude-mcp",
  transport: applicationMcpTransport,
});

const service = new LeadResearchService(provider); // accepts IAIProvider
```

Provider calls must execute on the server. Include organization, actor, and
trace context; do not send secrets or unnecessary personal data in prompts.
AI actions re-read tenant-scoped company/contact records by ID before creating
provider prompts, and outreach prompts omit contact email addresses.
Apollo fields, contact notes, and scraped Markdown are treated as untrusted
reference data; prompt instructions embedded in those fields are ignored.

### Lead workbench behavior

`/leads` provides dashboard KPIs, an eight-stage horizontally scrollable
pipeline, responsive searchable/filterable company and contact tables, manual
forms, CSV import, Quick Add Domain ingestion, detail dialogs, audit history,
and workspace preferences.
The UI is empty-state safe when no authenticated organization profile exists;
mutations and AI actions return actionable errors until the user is signed in.
Set `GEMINI_API_KEY` to a server-only Google AI Studio key to use Gemini by
default. `GEMINI_SEARCH_ENABLED=1` enables the public research grounding pass;
the app keeps structured extraction as a separate second pass for Gemini 2.5
compatibility. Free-tier Gemini projects may use prompts for product
improvement and human review, so the adapter best-effort redacts common email,
phone, and profile identifiers from public prompts and
`GEMINI_ALLOW_PRIVATE_DATA=0` routes private contact prompts to Claude instead.
Paid Gemini projects can explicitly opt in with `GEMINI_ALLOW_PRIVATE_DATA=1`
after reviewing Google's terms.

Set `CLAUDE_MCP_ENDPOINT` to an HTTPS bridge that accepts `{ name, arguments }`
and returns the response envelope expected by `ClaudeMCPProvider` when Claude
fallback is desired. No Claude Desktop process is required by the application.

Organization profiles carry explicit `owner`, `admin`, or `member` roles. All
members can work leads; only owners and admins can change workspace defaults or
member roles. Only owners can grant owner access, and the last owner cannot be
demoted. Application role changes are recorded in the tenant audit history;
migration promotions are recorded as system entries. Invitations and email
delivery use the Supabase Admin Auth API. Owners/admins can invite members from
Settings; invitations expire after seven days, are audited, and are accepted
through the invitation browser bridge before the new member sets a password.
Configure both `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_APP_URL` before using this flow. The current profile model
intentionally supports one organization per Auth user and has no organization
switcher; an account that already belongs to another organization cannot accept
a second invitation. Owners/admins can also deactivate and reactivate existing
profiles.

Quick Add Domain sends a typed `lead.ingest.requested` event to Inngest and
returns immediately. The durable `ingest-lead` function then fetches up to five
Apollo contacts, saves tenant-scoped records early, scrapes the company with
Firecrawl, and uses only company metadata plus public website content for the
automatic ICP/pain-point/company-outreach draft. This keeps the default free
Gemini path functional without sending Apollo contact identities or notes.
Contact-specific drafts remain private-data actions and require an explicitly
approved provider configuration. The workflow saves enrichment with an audit
entry. Runs for the same organization/domain are
serialized, and a ten-run function-wide concurrency ceiling protects external
provider budgets during bulk submissions; queued runs remain durable in Inngest.
Run the Inngest Dev Server locally when testing
background execution (`npx inngest-cli@latest dev -u
http://localhost:3000/api/inngest`); set `INNGEST_DEV=1` for the local app. The
app serves functions at `/api/inngest`.
The current Inngest SDK publishes the Next.js adapter as `inngest/next`; the
separate `@inngest/next` package requested by older setup guides is not
published, so it is intentionally not added as a dead dependency.

### News signal monitoring

The workbench includes organization-scoped monitoring targets, normalized news
items, signal records, scan history, and a provider-neutral `LeadSignal`
presentation contract. Company detail views show evidence, source links,
workflow and decision-maker mappings, with reviewed/dismissed status actions.
Dashboard users can queue an immediate scan or enable weekly monitoring for a
company; RSS feeds are optional per target. New companies are not enrolled
until a user selects `Monitor company`, which keeps provider usage and source
terms under explicit workspace control. Existing monitoring target state is
preserved across enrichment retries.

The approved monitoring design is:

```text
GDELT DOC + publisher RSS
  -> weekly Inngest scan
  -> deterministic recency/source/ICP ranking
  -> Firecrawl only for the highest-ranked article pages
  -> IAIProvider structured signal extraction
  -> audited, organization-scoped signal records
```

Execution is checkpointed by organization, target, discovery query, article,
scrape, AI extraction, and persistence step. A timeout or retry resumes from
the last completed provider operation instead of replaying an entire
organization scan or spending the same provider budget again. Firecrawl
warnings remain visible on the scan record, while an empty scrape is non-fatal.

Signals are limited to AI deployments, vendor partnerships, manual-review
hiring, public failures, and executive automation commitments. Each persisted
signal should retain a source URL, bounded evidence excerpt, confidence,
publication date, likely workflow, and likely decision-maker role. Store
metadata and short evidence rather than copying full articles; always link back
to the publisher and review source terms before enabling a production scan.

The scheduler runs in UTC by default using `NEWS_SCAN_CRON`, selects due
organization targets, records partial-provider warnings, and enforces per-run
company/article budgets. Set `NEWS_SCAN_ENABLED=1` to enable it (the example
file defaults to `0` until provider budgets are reviewed). `Scan news` queues
the same durable workflow manually. A later iteration can add organization-
local time zones and alternate news adapters without changing the signal
contract.

### AI provider policy and cost

Gemini 2.5 Flash is the default because Google documents free input/output
tiers, structured output, and a free Google Search grounding allowance shared
by Flash and Flash-Lite. Quotas vary by project and are visible in Google AI
Studio; they are not a production SLA. Free-tier content may be used to improve
Google products, so automatic ingestion and news classification stay
public-only. Contact-specific actions remain private and route to Claude unless
`GEMINI_ALLOW_PRIVATE_DATA=1` is explicitly set for a reviewed paid project.
See the
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [billing and
data policy](https://ai.google.dev/gemini-api/docs/billing), [Search grounding](https://ai.google.dev/gemini-api/docs/google-search),
and [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
guides for current limits.

GDELT and publisher RSS remain the primary zero-cost discovery sources. Gemini
Search is supplemental and budgeted; it is not used as a replacement for
source URLs, ranking, or deduplication. Groq Compound and OpenRouter free
models were reviewed as alternatives, but their free limits, provider
availability, and search/citation guarantees are less predictable for the
default path. They can be added later behind the same `IAIProvider` contract.

### External production gates

The repository contains deployable code, but autonomous production use requires
these provider/account checks to be completed in staging or the hosting
environment:

- Apollo must provide a master key with access to `mixed_people/api_search`;
  the current free-plan endpoint can reject ingestion before any contacts
  exist, while bulk enrichment may consume credits per person.
- Firecrawl must have a production key and an allowed website-scrape budget.
- Gemini should be configured with a Google AI Studio API key. Free-tier
  projects are suitable for public research/classification but have variable
  quotas and Google's product-improvement data policy; use a paid project or
  keep private-data access disabled for contact enrichment.
- Claude MCP is optional fallback infrastructure. If enabled, deploy it behind
  an HTTPS endpoint, with `CLAUDE_MCP_AUTH_TOKEN` set when the bridge requires
  bearer authentication.
- Inngest must register the deployed `/api/inngest` URL and sign webhook
  requests with `INNGEST_SIGNING_KEY`; unsigned requests are rejected.
- Supabase Auth must allow the deployed `/auth/callback` and reset-password
  redirect URLs, and migrations/boundary checks must run against staging.
- Configure Supabase Auth email delivery (SMTP or the hosted email provider),
  invitation/reset templates, and the sender domain before relying on sign-up
  or member invitations; local development can use Supabase's test mailer.
- Multi-instance deployments must set one stable
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` across all instances; keep it
  server-only and rotate it deliberately because rotation invalidates older
  action references. Generate a suitable value with `openssl rand -base64 32`.
- Run an authenticated two-organization CRUD/authorization test and one real
  Apollo → Firecrawl → Gemini ingestion before enabling provider-consuming CI.
- Run `E2E_TEST_EMAIL=<staging-user> E2E_TEST_PASSWORD=<staging-password> npm run e2e`
  against staging and confirm the authenticated workbench flow passes without
  using production data.
- Verify the deployed `/api/health` endpoint reports `ok` after all required
  secrets and the database are available; `degraded` means a non-core provider
  or optional invitation dependency is not configured. A missing
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be fixed before using a multi-instance
  deployment.

Historical local provider probes (2026-07-20) are intentionally recorded here:
Firecrawl returned HTTP 200 for a public scrape, Apollo returned HTTP 403 for
`mixed_people/api_search` with the configured key, and the configured Claude
MCP localhost bridge was unreachable. The application therefore reports these
provider failures safely rather than claiming autonomous enrichment is ready.

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
- Responses include baseline clickjacking, MIME-sniffing, referrer, and
  browser-permission protections. Matched application pages also receive a
  per-request nonce-based CSP; review any future third-party script or frame
  before allowing it in `src/lib/security/csp.ts`.
- Production responses add HSTS; do not terminate TLS before the hosting
  platform unless the proxy preserves the original HTTPS boundary.
- Public database tables start with RLS enabled and no allow policies.
- Supabase user identity is server verified; session presence alone is not
  authorization.
- Organization scope is mandatory in queries, storage paths, AI context, and
  audit records.
- Apollo, Firecrawl, and Inngest credentials are server-only and never use
  `NEXT_PUBLIC_` names.
- `package.json` upgrades Next.js and overrides vulnerable transitive packages;
  re-check the overrides whenever upgrading Next.js or its SDK dependencies.
- The deployable audit gate is `npm audit --omit=dev`; a separate moderate
  development-only esbuild advisory remains transitive through Drizzle Kit
  0.31.10, whose automated fix is a breaking downgrade.
- `INNGEST_DEV=1` is for local development only; deployed handlers require
  `INNGEST_SIGNING_KEY` so webhook requests are authenticated.
- Expected errors are modeled as typed results; unexpected failures reach the
  nearest application error boundary and must be reported without leaking
  sensitive details.

CI starts an ephemeral PostgreSQL service, creates a minimal compatibility
`auth.users` table without managing Supabase's real auth schema, applies every
migration, seeds the deterministic lead fixtures, and runs the tenant-boundary
verifier before building. This proves migration and database invariants in a
repeatable environment; it does not replace authenticated Supabase staging
tests.

## Current scope

The initial lead-workbench module, self-service authentication flow, explicit
organization governance, Supabase invitation onboarding, and durable
Apollo/Firecrawl/AI ingestion workflow are included under
`src/features/lead-workbench` and `src/inngest`. Billing, organization
switching, and a production MCP deployment remain separately reviewed concerns.
