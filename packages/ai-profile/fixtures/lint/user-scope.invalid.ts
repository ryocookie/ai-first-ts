// expect: ai-profile(user-scope)
// Each line reaches the database without the `userId = <signed-in user>` condition.
import { userScoped } from "@ai-first-ts/ai-profile/db";
import { createDb, type Database } from "@ai-first-ts/db";
import * as db from "@ai-first-ts/db";
import { todo } from "@ai-first-ts/db/schema/todo";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";

export function allTodos(database: Database) {
  return database.select().from(todo);
}

export const connect = (env: { DB: D1Database }) => drizzle(env.DB);
export const create = createDb;
export const namespace = db;
export type AnyDatabase = SQLiteAsyncDatabase<"async", unknown>;
export const someoneElse = (database: Database) => userScoped(database, "another-user-id");
export const lazyDriver = () => import("drizzle-orm/libsql");
