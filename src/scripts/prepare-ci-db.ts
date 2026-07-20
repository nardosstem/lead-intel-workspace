import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to prepare the CI database.");
}

const client = postgres(databaseUrl, { prepare: false });

async function prepareDatabase(): Promise<void> {
  try {
    await client.begin(async (tx) => {
      // The application migration intentionally references Supabase's managed
      // auth.users table without owning it. CI uses this minimal compatibility
      // table only inside an ephemeral Postgres service.
      const managedAuthTable = await tx`select to_regclass('auth.users') as name`;
      if (!managedAuthTable[0]?.name) {
        await tx`create schema if not exists auth`;
        await tx`
          create table if not exists auth.users (
            id uuid primary key
          )
        `;
      }
    });
    console.log("Prepared the ephemeral CI auth.users compatibility table.");
  } finally {
    await client.end();
  }
}

prepareDatabase().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
