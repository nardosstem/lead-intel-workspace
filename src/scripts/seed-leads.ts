import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import {
  companies,
  contacts,
  organizations,
  pipeline,
} from "@/lib/db/schema";

loadEnvConfig(process.cwd());

const demoOrganizationId = "10000000-0000-4000-8000-000000000001";

const companySeeds = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Northstar Analytics",
    website: "https://northstaranalytics.example.com",
    industry: "B2B SaaS",
    size: "51-200",
    location: "New York, NY",
    status: "prospect",
    stage: "researching" as const,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    name: "Harbor & Pine Logistics",
    website: "https://harborpine.example.com",
    industry: "Logistics",
    size: "201-500",
    location: "Chicago, IL",
    status: "prospect",
    stage: "qualified" as const,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    name: "Cinderblock Health",
    website: "https://cinderblockhealth.example.com",
    industry: "Healthcare technology",
    size: "11-50",
    location: "Boston, MA",
    status: "customer",
    stage: "meeting" as const,
  },
] as const;

const contactSeeds = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    companyId: companySeeds[0].id,
    name: "Maya Chen",
    title: "VP of Revenue Operations",
    email: "maya.chen@northstaranalytics.example.com",
    linkedin: "https://www.linkedin.com/in/mayachen-example",
    notes: "Evaluating ways to reduce manual account research before Q4.",
    stage: "contacted" as const,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    companyId: companySeeds[1].id,
    name: "Luis Romero",
    title: "Director of Sales Enablement",
    email: "luis.romero@harborpine.example.com",
    linkedin: "https://www.linkedin.com/in/luisromero-example",
    notes: "Owns process standardization across the commercial team.",
    stage: "new" as const,
  },
] as const;

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed leads.");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle(client, {
    schema: { companies, contacts, organizations, pipeline },
  });

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_user_id', '', true), set_config('app.current_organization_id', ${demoOrganizationId}, true)`,
      );

      await tx
        .insert(organizations)
        .values({
          id: demoOrganizationId,
          name: "Lead Intel Demo Organization",
          slug: "lead-intel-demo",
        })
        .onConflictDoNothing();

      for (const company of companySeeds) {
        await tx
          .insert(companies)
          .values({
            id: company.id,
            organizationId: demoOrganizationId,
            name: company.name,
            website: company.website,
            industry: company.industry,
            size: company.size,
            location: company.location,
            status: company.status,
          })
          .onConflictDoNothing();

        await tx
          .insert(pipeline)
          .values({
            id: `40000000-0000-4000-8000-${company.id.slice(-12)}`,
            organizationId: demoOrganizationId,
            companyId: company.id,
            stage: company.stage,
          })
          .onConflictDoNothing();
      }

      for (const contact of contactSeeds) {
        await tx
          .insert(contacts)
          .values({
            id: contact.id,
            organizationId: demoOrganizationId,
            companyId: contact.companyId,
            name: contact.name,
            title: contact.title,
            email: contact.email,
            linkedin: contact.linkedin,
            notes: contact.notes,
          })
          .onConflictDoNothing();

        await tx
          .insert(pipeline)
          .values({
            id: `50000000-0000-4000-8000-${contact.id.slice(-12)}`,
            organizationId: demoOrganizationId,
            contactId: contact.id,
            stage: contact.stage,
          })
          .onConflictDoNothing();
      }
    });

    console.log(
      `Seeded ${companySeeds.length} companies and ${contactSeeds.length} contacts.`,
    );
  } finally {
    await client.end();
  }
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
