import { createAuth as createConfiguredAuth } from "@ai-first-ts/auth";
import { type Database, createDb } from "@ai-first-ts/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? getDb());
}
