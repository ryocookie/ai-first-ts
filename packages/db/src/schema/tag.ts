import type { OwnedId } from "@ai-first-ts/ai-profile/db";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { todo } from "./todo";

// ユーザーごとのタグ。名前はユーザー内で一意（正規化済みの小文字）。
export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#888888"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("tag_userId_name_idx").on(table.userId, table.name)],
);

// todo とタグの対応。userScoped で読み書きできるよう所有者の userId を持つ。
// 参照列は OwnedId なので、data.own で所有者の行だと確かめた id しか書き込めない（実行時も userScoped が確かめる）。
export const todoTag = sqliteTable(
  "todo_tag",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    todoId: text("todo_id")
      .$type<OwnedId<"todo">>()
      .notNull()
      .references(() => todo.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .$type<OwnedId<"tag">>()
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.todoId, table.tagId] }),
    index("todo_tag_userId_idx").on(table.userId),
  ],
);
