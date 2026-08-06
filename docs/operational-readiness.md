# Lead Intelligence Generator: Operational Readiness Plan

## Goal and launch boundary

Launch a **controlled internal pilot**: one approved workspace can submit a
public company domain, receive a durable Apollo → Firecrawl → AI enrichment,
review the generated contacts and outreach draft, and retry a failed run.

The pilot deliberately excludes sending email, CRM synchronization, billing,
organization switching, and autonomous news monitoring. Generated copy is
reviewed by a human before any external use.

## Launch criteria

The pilot is ready only when all of the following are true:

- A staging deployment has been migrated and its health endpoint returns `ok`.
- A test user can sign in, receive a password-reset or invitation email, and
  access only its own organization.
- Inngest is registered against the deployed `/api/inngest` route and accepts
  signed requests.
- One approved public domain completes Apollo → Firecrawl → AI enrichment in
  staging; the resulting company, contacts, audit entry, and draft are visible
  in the workbench.
- Provider failure, retry, and duplicate-submission behavior have been checked
  from Inngest and in the workbench.
- `npm run test:coverage`, `npm run check`, `npm run build`, and
  `npm audit --omit=dev --audit-level=high` pass on the release commit.
- An owner has accepted the provider spend limits, data-handling terms, and
  manual-review workflow below.

## Workstreams

| Stream | Scope | Owner role | Exit evidence |
| --- | --- | --- | --- |
| Product policy | Approve pilot users, target-title defaults, what counts as a usable lead, manual draft review, and a spend ceiling. | Founder / product owner | Written pilot brief and named workspace owner. |
| Provider access | Obtain Apollo entitlement for `mixed_people/api_search`, Firecrawl production access, Gemini paid/private-data decision, and optional Claude fallback. | Founder / ops | Non-production keys stored in the secret manager; one successful staging run. |
| Platform | Create separate staging and production projects; configure DNS/hosting, Supabase Auth redirects and mail, Inngest signing, secrets, backups, and rollback. | Engineering / platform | Staging health is `ok`; deployment and rollback are documented. |
| Security & privacy | Remove production audit findings; review the repository CSP/HSTS baseline; confirm provider terms, data retention/deletion process, access policy, and secret rotation procedure. | Engineering + owner | Release audit passes and policies are approved. |
| Reliability & cost | Add error alerting, workflow-failure alerting, provider usage/spend visibility beyond the daily ledger, and monthly budget ceilings. Repository kill switches and daily limits are already present. | Engineering / ops | A forced failed run raises an alert; a limit prevents an additional run. |
| Staging acceptance | Test two-organization isolation, authentication mail, provider success/failure/retry, and protected browser flow. | Engineering + pilot owner | Dated acceptance record with results and exceptions. |

## Sequenced backlog

### Milestone 0 — Go/no-go decisions

1. Name the pilot owner and one pilot workspace; keep self-service sign-up off
   operationally unless it is an explicit product decision.
2. Set an initial monthly provider budget and a maximum number of enrichments
   per organization/day.
3. Decide whether any contact data may be sent to Gemini. The current safe
   default is `GEMINI_ALLOW_PRIVATE_DATA=0`, which requires a reachable Claude
   fallback for private contact prompts.
4. Confirm whether the pilot ends at draft generation (recommended) or needs
   CRM/email delivery. The latter is a separate product and compliance scope.

### Milestone 1 — Pilot platform and safety (critical path)

1. ✅ Remediate production dependency audit findings and make the audit a
   release gate.
2. ✅ Add nonce-based CSP/HSTS response hardening and tenant-scoped daily
   provider budgets with retry-safe reservations.
3. Choose a hosting platform and create staging with a separate Supabase
   project and Inngest environment.
4. Apply migrations; configure Supabase Auth redirect URLs, SMTP/templates,
   and a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
5. Configure all server-side secrets, register `/api/inngest`, and verify
   signed workflow delivery.
6. Add production error tracking/alerting and a short rollback/runbook; retain
   `LEAD_INGESTION_ENABLED=0` and `AI_ACTIONS_ENABLED=0` as emergency stops.
7. Run the acceptance checks in the launch criteria.

### Milestone 2 — Limited beta hardening

1. Add provider-specific usage/spend telemetry and enforce per-user limits,
   monthly budget ceilings, and cooldowns beyond the repository's daily
   organization ledger.
2. Add a provider-health/synthetic-check process that does not unintentionally
   consume credits, plus alerts for rate-limit and failure spikes.
3. Add automated authenticated staging smoke tests, including a safe provider
   test account/domain.
4. Test database restore, secret rotation, and a failed deployment rollback.

### Milestone 3 — Expansion (not required for pilot)

1. Add CRM sync or outbound-email delivery only with explicit review,
   consent/unsubscribe handling, and engagement tracking requirements.
2. Enable autonomous news monitoring only after per-run budgets, publisher
   terms, and alerting are accepted.
3. Add organization switching and billing only after the tenant and support
   models are designed.

## External configuration checklist

The following cannot be completed from this repository and need an account
owner:

- [ ] Hosting project, custom domain, deployment environment variables, and
      database/network allow-listing where applicable.
- [ ] Supabase staging project, migrations, Auth redirect URLs, SMTP sender,
      invitation/reset templates, and backup policy.
- [ ] Inngest staging environment, event/signing keys, and deployed function
      registration.
- [ ] Apollo plan/key that can call both lead-search and contact-enrichment
      endpoints.
- [ ] Firecrawl key and approved scrape budget.
- [ ] Gemini project, billing/data-policy decision, and key; optional deployed
      HTTPS Claude MCP bridge and token.
- [ ] Error tracking and alert delivery destination.

## Current repository-owned status

- The local quality suite currently passes: unit coverage, lint, typecheck,
  and production build.
- Production dependency audit remediation is complete: `npm run
  audit:production` is clean and enforced by CI.
- The repository has CI and a release runbook but no deployment
  configuration/infrastructure as code, external error tracking, or provider
  spend telemetry beyond the tenant usage budgets.
- Health checks database connectivity and configuration presence; it does not
  verify external providers or create operational alerts.

## First working session

1. Confirm the four Milestone 0 decisions.
2. Select the hosting platform and create the staging account/project.
3. Populate staging secrets, apply migrations, and configure Inngest/Supabase.
4. Execute and record the staging acceptance run before opening the pilot.
