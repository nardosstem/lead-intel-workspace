# Lead Intel Workspace

A production-oriented monolithic Next.js foundation for replacing fragmented
lead research workflows. This repository currently contains infrastructure and
shared application architecture only; domain feature implementation has not
started.

## Stack

- Next.js 16 App Router, React 19, and strict TypeScript
- Tailwind CSS 4 and shadcn/ui (Base UI primitives)
- Supabase Auth, Postgres, and Storage
- Drizzle ORM and Drizzle Kit migrations
- `next-themes`, Lucide icons, and Sonner toasts
- Provider-neutral AI contracts with a Claude MCP adapter

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

## Architecture

```text
src/
├── app/                    # Routes and Next.js boundaries only
├── components/
│   ├── shared/             # App shell, layouts, theme, shared states
│   └── ui/                 # shadcn/ui design-system primitives
├── features/               # Domain modules (lead-workbench comes next)
├── hooks/                  # Cross-cutting client hooks
├── lib/
│   ├── ai/                 # Provider contract, factory, adapters
│   ├── auth/               # Supabase browser/server clients and session logic
│   └── db/                 # Drizzle client, schema, and migrations
└── proxy.ts                # Next.js 16 request boundary/session refresh
```

The architecture follows these dependency directions:

```text
app routes -> feature modules -> shared interfaces/infrastructure
shared UI  -> ui primitives
features   -> IAIProvider (never a concrete AI provider)
```

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

### Authentication and storage

- `auth/client.ts` creates the browser Supabase client.
- `auth/server.ts` creates a request-scoped server client using async Next.js
  cookies.
- `auth/middleware.ts` refreshes sessions through `src/proxy.ts`, the Next.js 16
  replacement for the deprecated middleware file convention.
- `auth/user.ts` exposes server-verified current-user helpers.

The proxy only refreshes authentication state. It is not an authorization
boundary. Every Server Function, Route Handler, and server-side service must
verify the user and organization access at the point of mutation or data read.
The same Supabase clients expose `.storage`; use private buckets by default and
authorize object paths by organization.

### UI foundation

The root layout provides a responsive persistent shadcn sidebar, sticky header,
system-aware light/dark theme, tooltip provider, and global toast host. Next.js
`loading.tsx`, `error.tsx`, and `global-error.tsx` provide shared pending and
failure states. Feature navigation remains disabled until its routes exist.

Installed design-system primitives include Button, Input, Table, Dialog,
Dropdown Menu, Card, Sidebar, Skeleton, Tooltip, Sheet, Separator, and Sonner
toast. Reuse these primitives before introducing one-off controls.

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
- Expected errors are modeled as typed results; unexpected failures reach the
  nearest application error boundary and must be reported without leaking
  sensitive details.

## Current scope

This foundation intentionally has no lead-workbench domain behavior, sign-in
experience, billing, or production MCP transport. Those belong to subsequent,
separately reviewed feature work.
