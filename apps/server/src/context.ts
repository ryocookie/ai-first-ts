import type { Context as ApiContext } from "@ai-first-ts/api/context";

import { getDb } from "./services";
import { createAuth } from "./services";

export type CreateContextOptions = {
  headers: Headers;
};

export async function createContext({ headers }: CreateContextOptions): Promise<ApiContext> {
  const db = getDb();
  const session = await (await createAuth(db)).api.getSession({ headers });
  return {
    db,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
