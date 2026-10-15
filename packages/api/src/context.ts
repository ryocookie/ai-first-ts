import type { Session } from "@ai-first-ts/auth";
import type { Database } from "@ai-first-ts/db";

export type Context = {
  session: Session | null;
  db: Database;
};
