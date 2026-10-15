// テスト専用: メモリ上の SQLite（node:sqlite）に drizzle の sqlite-proxy をつなぎ、本番（D1）と同じ非同期の
// drizzle インスタンスから userScoped を作る。テストは実際の SQL で「他のユーザーの行に触れない」ことを確かめられる。
// 任意の userId でスコープを作れるため、import できるのはテストファイル（bun:test を使うファイル）だけ
// （ai-profile(user-scope) が強制し、境界は lint/data-access-boundaries.mjs に登録している）。
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { type UserScopedDb, userScoped } from "./user-scope";

export type MemoryDatabase = {
  /** userId のユーザーに限定したアクセサ（本番では認証済みセッションから作るもの）。 */
  scope(userId: string): UserScopedDb;
  /** スコープを通さずに SQL を実行して行を返す。テストの準備と検証にだけ使う。 */
  rows(sql: string): Record<string, unknown>[];
};

const isSqlValue = (value: unknown): value is SQLInputValue =>
  value === null || ["string", "number", "bigint"].includes(typeof value);

/** ddl（CREATE TABLE など）を実行した空のデータベースを作る。テストごとに作り直す。 */
export function memoryDatabase(ddl: string): MemoryDatabase {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(ddl);
  const db = drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query);
    const values = params.filter(isSqlValue);
    if (method === "run") {
      statement.run(...values);
      return { rows: [] };
    }
    // sqlite-proxy は行を列の値の配列で受け取る（get は1行、それ以外は行の配列）。
    const rows = statement.all(...values).map((row) => Object.values(row));
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  });
  return {
    scope: (userId) => userScoped(db, userId),
    rows: (sql) => sqlite.prepare(sql).all(),
  };
}
