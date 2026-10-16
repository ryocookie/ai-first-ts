import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// ユーザーが所有するデータの例。userId 列を持つテーブルは @ai-first-ts/ai-profile/db の
// userScoped アクセサ経由でしか読み書きできない（ai-profile(user-scope)）。
export const todo = sqliteTable(
  "todo",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).default(false).notNull(),
    /** 期限日（YYYY-MM-DD）。時刻とタイムゾーンを持たない暦日として扱う。 */
    dueOn: text("due_on"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("todo_userId_idx").on(table.userId)],
);
