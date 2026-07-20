import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import postgres, { type TransactionSql } from "postgres";

loadEnvConfig(process.cwd());

type BoundaryVerificationResult = Readonly<{
  contactRejected: boolean;
  pipelineRejected: boolean;
  cascadeWorked: boolean;
}>;

class RollbackVerification extends Error {
  constructor(readonly result: BoundaryVerificationResult) {
    super("Boundary verification rollback");
  }
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyBoundaries() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database boundary verification.");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const ids = {
    organizationA: randomUUID(),
    organizationB: randomUUID(),
    companyA: randomUUID(),
    companyB: randomUUID(),
    contactA: randomUUID(),
    pipelineA: randomUUID(),
  };
  let result: BoundaryVerificationResult | null = null;

  try {
    try {
      await client.begin(async (tx: TransactionSql) => {
        await tx`
          select
            set_config('app.current_user_id', '', true),
            set_config('app.current_organization_id', ${ids.organizationA}, true)
        `;
        await tx`
          insert into public.organizations (id, name, slug)
          values
            (${ids.organizationA}, 'Boundary Verification A', ${`boundary-a-${ids.organizationA}`}),
            (${ids.organizationB}, 'Boundary Verification B', ${`boundary-b-${ids.organizationB}`})
        `;
        await tx`
          insert into public.companies (id, organization_id, name, domain, status)
          values
            (${ids.companyA}, ${ids.organizationA}, 'Boundary Company A', ${`boundary-a-${ids.companyA}.example.com`}, 'prospect'),
            (${ids.companyB}, ${ids.organizationB}, 'Boundary Company B', ${`boundary-b-${ids.companyB}.example.com`}, 'prospect')
        `;
        await tx`
          insert into public.contacts (id, organization_id, company_id, name)
          values (${ids.contactA}, ${ids.organizationA}, ${ids.companyA}, 'Boundary Contact A')
        `;
        await tx`
          insert into public.pipeline (id, organization_id, company_id, stage)
          values (${ids.pipelineA}, ${ids.organizationA}, ${ids.companyA}, 'new')
        `;

        let contactRejected = false;
        try {
          await tx.savepoint(async (savepoint) => {
            await savepoint`
              insert into public.contacts (id, organization_id, company_id, name)
              values (${randomUUID()}, ${ids.organizationA}, ${ids.companyB}, 'Invalid Cross Tenant Contact')
            `;
          });
        } catch (error) {
          contactRejected = postgresCode(error) === "23503";
        }

        let pipelineRejected = false;
        try {
          await tx.savepoint(async (savepoint) => {
            await savepoint`
              insert into public.pipeline (id, organization_id, company_id, stage)
              values (${randomUUID()}, ${ids.organizationA}, ${ids.companyB}, 'new')
            `;
          });
        } catch (error) {
          pipelineRejected = postgresCode(error) === "23503";
        }

        await tx`
          delete from public.companies
          where id = ${ids.companyA} and organization_id = ${ids.organizationA}
        `;
        const remaining = await tx`
          select
            (select count(*)::int from public.contacts where id = ${ids.contactA}) as contacts,
            (select count(*)::int from public.pipeline where id = ${ids.pipelineA}) as pipeline
        `;
        const cascadeWorked = remaining[0]?.contacts === 0 && remaining[0]?.pipeline === 0;

        throw new RollbackVerification({ contactRejected, pipelineRejected, cascadeWorked });
      });
    } catch (error) {
      if (error instanceof RollbackVerification) {
        result = error.result;
      } else {
        throw error;
      }
    }

    if (!result) {
      throw new Error("Boundary verification did not produce a result.");
    }
    assert(result.contactRejected, "Cross-organization contact target was accepted.");
    assert(result.pipelineRejected, "Cross-organization pipeline target was accepted.");
    assert(result.cascadeWorked, "Company deletion did not cascade to dependent records.");

    const leaked = await client`
      select count(*)::int as count
      from public.organizations
      where id in (${ids.organizationA}, ${ids.organizationB})
    `;
    assert(leaked[0]?.count === 0, "Boundary verification rows were not rolled back.");

    const memberships = await client`
      select organization_id,
        count(*)::int as members,
        count(*) filter (where role = 'owner')::int as owners
      from public.users
      group by organization_id
    `;
    for (const membership of memberships) {
      assert(
        Number(membership.members) === 0 || Number(membership.owners) > 0,
        `Organization ${membership.organization_id} has no owner.`,
      );
    }

    console.log("Database boundary checks passed: tenant FKs, cascade deletes, rollback cleanup, and owner coverage.");
  } finally {
    await client.end();
  }
}

verifyBoundaries().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
