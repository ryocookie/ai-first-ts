// Data is read and written only through UserScopedDb, which adds `userId = <signed-in user>` to every query.
import type { Result } from "@ai-first-ts/ai-profile/core";
import type { DataAccessError, UserScopedDb } from "@ai-first-ts/ai-profile/db";
import { todo } from "@ai-first-ts/db/schema/todo";
import { eq } from "drizzle-orm";

export function openTodos(data: UserScopedDb) {
  return data.select(todo, eq(todo.completed, false));
}

export function addTodo(
  data: UserScopedDb,
  title: string,
): Promise<Result<number, DataAccessError>> {
  return data.insert(todo, { id: crypto.randomUUID(), userId: data.userId, title });
}

export function completeTodo(data: UserScopedDb, id: string) {
  return data.update(todo, { completed: true }, eq(todo.id, id));
}
