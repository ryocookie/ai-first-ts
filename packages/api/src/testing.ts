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

// packages/db/src/schema/todo.ts・tag.ts と同じ列・制約（マイグレーション未生成のため手で書く）。
// 本番の D1 と同じく外部キーを有効にする（user テーブルはないので user_id の参照だけ省く）。
const TODO_DDL = `
  pragma foreign_keys = on;
  create table todo (
    id text primary key,
    user_id text not null,
    title text not null,
    completed integer not null default 0,
    due_on text,
    created_at integer not null default (cast(unixepoch('subsecond') * 1000 as integer))
  );
  create table tag (
    id text primary key,
    user_id text not null,
    name text not null,
    color text not null default '#888888',
    created_at integer not null default (cast(unixepoch('subsecond') * 1000 as integer))
  );
  create unique index tag_userId_name_idx on tag (user_id, name);
  create table todo_tag (
    user_id text not null,
    todo_id text not null references todo(id) on delete cascade,
    tag_id text not null references tag(id) on delete cascade,
    primary key (todo_id, tag_id)
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
