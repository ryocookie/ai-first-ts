// The referenced id is first resolved with data.own, which returns OwnedId<"todo"> only for the owner's row
// (NotOwned otherwise, the same for someone else's row and a missing one).
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

export const attach = async (data: UserScopedDb, input: { todoId: string; label: string }) => {
  const todoId = await data.own(todo, input.todoId);
  if (!todoId.ok) {
    return todoId;
  }
  return data.insert(todoTag, { userId: data.userId, todoId: todoId.value, label: input.label });
};
