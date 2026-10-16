// expect: TS2322 owned-id
// A column that references another user-owned table is typed OwnedId<"todo">. Passing the raw id from the
// request skips the ownership check (IDOR: linking your tag to someone else's todo), so it does not compile.
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { OwnedId, UserScopedDb } from "../../db";

const todo = sqliteTable("todo", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
});

const todoTag = sqliteTable("todo_tag", {
  userId: text("user_id").notNull(),
  todoId: text("todo_id")
    .$type<OwnedId<"todo">>()
    .notNull()
    .references(() => todo.id),
  label: text("label").notNull(),
});

export const attach = (data: UserScopedDb, input: { todoId: string; label: string }) =>
  data.insert(todoTag, { userId: data.userId, todoId: input.todoId, label: input.label });
