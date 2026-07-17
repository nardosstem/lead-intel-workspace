import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.url(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= serverEnvironmentSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });

  return cachedEnvironment;
}
