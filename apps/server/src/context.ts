import { userScoped } from "@ai-first-ts/ai-profile/db";
import type { Context as ApiContext } from "@ai-first-ts/api/context";
import type { Context as HonoContext } from "hono";

import { getDb } from "./services";
import { createAuth } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = await getDb();
  const session = await (
    await createAuth(db)
  ).api.getSession({
    headers: context.req.raw.headers,
  });
  // データアクセスの所有者は認証済みセッションのユーザーだけ。ハンドラに生の db は渡さない。
  return {
    session,
    data: session === null ? null : userScoped(db, session.user.id),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
