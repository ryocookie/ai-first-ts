import { userScoped } from "@ai-first-ts/ai-profile/db";
import type { Context as ApiContext } from "@ai-first-ts/api/context";

import { getDb } from "./services";
import { createAuth } from "./services";

export type CreateContextOptions = {
  headers: Headers;
};

export async function createContext({ headers }: CreateContextOptions): Promise<ApiContext> {
  const db = getDb();
  const session = await (await createAuth(db)).api.getSession({ headers });
  // データアクセスの所有者は認証済みセッションのユーザーだけ。ハンドラに生の db は渡さない。
  return {
    session,
    data: session === null ? null : userScoped(db, session.user.id),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
