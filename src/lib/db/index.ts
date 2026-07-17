import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { getServerEnvironment } from "@/lib/env";
import * as schema from "@/lib/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

type DatabaseConnection = {
  client: Sql;
  db: Database;
};

const globalForDatabase = globalThis as typeof globalThis & {
  databaseConnection?: DatabaseConnection;
};

function createDatabaseConnection(): DatabaseConnection {
  const client = postgres(getServerEnvironment().DATABASE_URL, {
    max: 10,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export function getDatabase(): Database {
  const connection =
    (globalForDatabase.databaseConnection ??= createDatabaseConnection());

  return connection.db;
}

export async function closeDatabaseConnection(): Promise<void> {
  const connection = globalForDatabase.databaseConnection;

  if (connection) {
    await connection.client.end();
    globalForDatabase.databaseConnection = undefined;
  }
}

export type { Database };
export * from "@/lib/db/schema";
