import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { NonRetriableError } from "inngest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  currentUserId: "",
}));

vi.mock("@/lib/auth/user", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testState.currentUserId,
    email: testState.currentUserId === "" ? undefined : `${testState.currentUserId}@example.invalid`,
    user_metadata: {},
  })),
  requireCurrentUser: vi.fn(async () => ({
    id: testState.currentUserId,
    email: `${testState.currentUserId}@example.invalid`,
    user_metadata: {},
  })),
}));

import { closeDatabaseConnection, getDatabase } from "@/lib/db";
import {
  OrganizationUsageLimitError,
  reserveOrganizationUsage,
} from "@/lib/db/usage";
import type { ActionResult } from "../types";
import {
  createCompany,
  createContact,
  deleteCompany,
  getLeads,
  setCompanyMonitoring,
  updateCompany,
  updateContact,
  updatePipeline,
} from "./actions";
import { __newsScanInternals } from "@/inngest/functions/scan-news";

const databaseUrl = process.env.DATABASE_URL;
const integrationEnabled = process.env.LEAD_INTEL_INTEGRATION_TEST === "1";

if (!databaseUrl || !integrationEnabled) {
  throw new Error(
    "Server Action integration tests require DATABASE_URL and LEAD_INTEL_INTEGRATION_TEST=1 against a disposable PostgreSQL database.",
  );
}

const sql = postgres(databaseUrl, { prepare: false });
const ids = {
  organizationA: randomUUID(),
  organizationB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
};

function expectSuccess<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function expectFailure<T>(result: ActionResult<T>): void {
  expect(result.ok).toBe(false);
}

describe("authenticated lead Server Actions", () => {
  beforeAll(async () => {
    await sql.begin(async (tx) => {
      await tx`
        insert into public.organizations (id, name, slug)
        values
          (${ids.organizationA}, 'Integration Organization A', ${`integration-a-${ids.organizationA}`}),
          (${ids.organizationB}, 'Integration Organization B', ${`integration-b-${ids.organizationB}`})
      `;
      await tx`
        insert into auth.users (id)
        values (${ids.userA}), (${ids.userB})
      `;
      await tx`
        insert into public.users (id, organization_id, email, full_name, role)
        values
          (${ids.userA}, ${ids.organizationA}, 'integration-a@example.invalid', 'Integration A', 'owner'),
          (${ids.userB}, ${ids.organizationB}, 'integration-b@example.invalid', 'Integration B', 'owner')
      `;
    });
  });

  afterAll(async () => {
    await sql`
      delete from public.companies
      where organization_id = ${ids.organizationA} or organization_id = ${ids.organizationB}
    `;
    await sql`
      delete from public.organization_invitations
      where organization_id = ${ids.organizationA} or organization_id = ${ids.organizationB}
    `;
    await sql`
      delete from public.audit_logs
      where organization_id = ${ids.organizationA} or organization_id = ${ids.organizationB}
    `;
    await sql`
      delete from public.organizations
      where id = ${ids.organizationA} or id = ${ids.organizationB}
    `;
    await sql`
      delete from auth.users
      where id = ${ids.userA} or id = ${ids.userB}
    `;
    await sql.end();
    await closeDatabaseConnection();
    vi.unstubAllEnvs();
  });

  it("keeps CRUD, pipeline records, duplicate domains, and audit rows tenant-scoped", async () => {
    testState.currentUserId = ids.userA;

    const firstReservation = await getDatabase().transaction((tx) =>
      reserveOrganizationUsage(tx, {
        organizationId: ids.organizationA,
        kind: "domain_ingestion",
        reservationKey: "integration-idempotency-key",
      }),
    );
    const repeatedReservation = await getDatabase().transaction((tx) =>
      reserveOrganizationUsage(tx, {
        organizationId: ids.organizationA,
        kind: "domain_ingestion",
        reservationKey: "integration-idempotency-key",
      }),
    );
    expect(firstReservation.count).toBe(1);
    expect(repeatedReservation.count).toBe(1);

    vi.stubEnv("NEWS_SCAN_DAILY_LIMIT", "1");
    await getDatabase().transaction((tx) =>
      reserveOrganizationUsage(tx, {
        organizationId: ids.organizationA,
        kind: "news_scan",
        reservationKey: "integration-scan-key-1",
      }),
    );
    await expect(
      getDatabase().transaction((tx) =>
        reserveOrganizationUsage(tx, {
          organizationId: ids.organizationA,
          kind: "news_scan",
          reservationKey: "integration-scan-key-2",
        }),
      ),
    ).rejects.toBeInstanceOf(OrganizationUsageLimitError);

    const companyA = expectSuccess(await createCompany({
      name: "Integration Company A",
      website: "https://integration-a.example.com",
      industry: "B2B SaaS",
    }));
    expect((await getLeads()).monitoringByCompanyId[companyA.id]).toBeUndefined();
    expectSuccess(await setCompanyMonitoring({ companyId: companyA.id, enabled: true }));
    await expect(
      __newsScanInternals.runOrganizationScan(ids.organizationA, ids.userB, randomUUID()),
    ).rejects.toBeInstanceOf(NonRetriableError);
    const duplicate = await createCompany({
      name: "Duplicate Company A",
      website: "https://www.integration-a.example.com",
    });
    expectFailure(duplicate);

    const contactA = expectSuccess(await createContact({
      companyId: companyA.id,
      name: "Alex A",
      title: "Founder",
      email: "alex-a@example.invalid",
    }));
    const snapshotA = await getLeads();
    const pipelineA = snapshotA.pipeline.find((row) => row.contactId === contactA.id);
    expect(pipelineA).toBeDefined();
    expect(snapshotA.companies.map((company) => company.id)).toEqual([companyA.id]);
    expect(snapshotA.contacts.map((contact) => contact.id)).toEqual([contactA.id]);
    expect(snapshotA.monitoringByCompanyId[companyA.id]).toMatchObject({
      enabled: true,
      scanFrequencyDays: 7,
      lastScannedAt: null,
    });
    expectSuccess(await setCompanyMonitoring({ companyId: companyA.id, enabled: false }));
    expect((await getLeads()).monitoringByCompanyId[companyA.id]?.enabled).toBe(false);

    for (let index = 1; index <= 10; index += 1) {
      expectSuccess(await createCompany({
        name: `Paged Company ${index}`,
        website: `https://paged-${index}.example.com`,
      }));
    }
    const firstLeadPage = await getLeads({ companiesPage: 1, pageSize: 10 });
    const secondLeadPage = await getLeads({ companiesPage: 2, pageSize: 10 });
    expect(firstLeadPage.companies).toHaveLength(10);
    expect(secondLeadPage.companies).toHaveLength(1);
    expect(firstLeadPage.pagination.companies).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 11,
      pageCount: 2,
    });
    expect(firstLeadPage.metrics.totalCompanies).toBe(11);
    expect(firstLeadPage.metrics.totalPipeline).toBe(12);
    const searchedLeads = await getLeads({
      companySearch: "Paged Company 10",
      pageSize: 10,
    });
    expect(searchedLeads.companies.map((company) => company.name)).toEqual([
      "Paged Company 10",
    ]);
    const searchedContacts = await getLeads({
      contactSearch: "Alex A",
      pageSize: 10,
    });
    expect(searchedContacts.contacts.map((contact) => contact.name)).toEqual(["Alex A"]);

    const updatedCompany = expectSuccess(await updateCompany({
      id: companyA.id,
      name: "Integration Company A Updated",
      website: companyA.website,
      industry: companyA.industry,
      status: companyA.status,
    }));
    expect(updatedCompany.name).toBe("Integration Company A Updated");
    const updatedContact = expectSuccess(await updateContact({
      id: contactA.id,
      companyId: companyA.id,
      name: contactA.name,
      title: "Chief Executive Officer",
      email: contactA.email,
    }));
    expect(updatedContact.title).toBe("Chief Executive Officer");
    expect(pipelineA).toBeDefined();
    const updatedPipeline = expectSuccess(await updatePipeline({
      id: pipelineA!.id,
      stage: "qualified",
      nextFollowUpAt: null,
    }));
    expect(updatedPipeline.stage).toBe("qualified");

    testState.currentUserId = ids.userB;
    const companyB = expectSuccess(await createCompany({
      name: "Integration Company B",
      website: "https://integration-b.example.com",
    }));
    const snapshotB = await getLeads();
    expect(snapshotB.companies.map((company) => company.id)).toEqual([companyB.id]);
    const pipelineB = snapshotB.pipeline.find((row) => row.companyId === companyB.id);
    expect(pipelineB).toBeDefined();

    testState.currentUserId = ids.userA;
    const crossTenantUpdate = await updateCompany({
      id: companyB.id,
      name: "Should Not Update",
      website: companyB.website,
    });
    expectFailure(crossTenantUpdate);
    expectFailure(await deleteCompany(companyB.id));
    expectFailure(await createContact({
      companyId: companyB.id,
      name: "Cross Tenant Contact",
    }));
    expectFailure(await updatePipeline({
      id: pipelineB!.id,
      stage: "won",
      nextFollowUpAt: null,
    }));

    const rawCompanyB = await sql`
      select name from public.companies
      where id = ${companyB.id} and organization_id = ${ids.organizationB}
    `;
    expect(rawCompanyB[0]?.name).toBe("Integration Company B");

    expectSuccess(await deleteCompany(companyA.id));
    const dependentRows = await sql`
      select
        (select count(*)::int from public.contacts where id = ${contactA.id}) as contacts,
        (select count(*)::int from public.pipeline where id = ${pipelineA!.id}) as pipeline,
        (select count(*)::int from public.audit_logs where organization_id = ${ids.organizationA} and actor_user_id = ${ids.userA}) as audits,
        (select count(*)::int from public.audit_logs where organization_id = ${ids.organizationA} and entity_type = 'organization_usage') as usage_audits
    `;
    expect(dependentRows[0]?.contacts).toBe(0);
    expect(dependentRows[0]?.pipeline).toBe(0);
    expect(Number(dependentRows[0]?.audits ?? 0)).toBeGreaterThanOrEqual(5);
    expect(Number(dependentRows[0]?.usage_audits ?? 0)).toBeGreaterThanOrEqual(2);
  });
});
