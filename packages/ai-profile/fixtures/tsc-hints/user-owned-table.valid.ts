// A table with a NOT NULL `userId` column can be queried through UserScopedDb, which adds the owner condition.
import { text, sqliteTable } from "drizzle-orm/sqlite-core";

import type { UserScopedDb } from "../../db";

const note = sqliteTable("note", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
});

export const notes = (data: UserScopedDb) => data.select(note);
export const addNote = (data: UserScopedDb, id: string, body: string) =>
  data.insert(note, { id, userId: data.userId, body });
