// テスト専用: oRPC のコンテキストを作る。import できるのはテストファイルだけ（ai-profile(test-only)）。
import { memoryDatabase } from "@ai-first-ts/ai-profile/db/testing";
import type { Session } from "@ai-first-ts/auth";

import type { Context } from "./context";

/** ログイン中のユーザー userId のセッション。 */
export function sessionOf(userId: string): Session {
  const at = new Date(0);
  return {
    user: {
      id: userId,
      name: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: at,
      updatedAt: at,
    },
    session: {
      id: `session-${userId}`,
      userId,
      token: `token-${userId}`,
      expiresAt: new Date(8.64e15),
      createdAt: at,
      updatedAt: at,
      ipAddress: null,
      userAgent: null,
    },
  };
}

export const anonymous: Context = { session: null, data: null };

// packages/db/src/schema/todo.ts と同じ列（マイグレーション未生成のため手で書く）。
const TODO_DDL = `
  create table todo (
    id text primary key,
    user_id text not null,
    title text not null,
    completed integer not null default 0,
    created_at integer not null default (cast(unixepoch('subsecond') * 1000 as integer))
  );
`;

/** todo テーブルを持つメモリ上の DB と、そこへつないだユーザーごとのコンテキスト。 */
export function todoDatabase() {
  const db = memoryDatabase(TODO_DDL);
  return {
    rows: (sql: string) => db.rows(sql),
    as: (userId: string): Context => ({ session: sessionOf(userId), data: db.scope(userId) }),
  };
}
