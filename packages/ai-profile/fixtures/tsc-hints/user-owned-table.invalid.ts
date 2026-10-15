// expect: TS2345
// UserScopedDb accepts only tables with a `userId` column, so a table without an owner cannot be queried through it.
import { text, sqliteTable } from "drizzle-orm/sqlite-core";

import type { UserScopedDb } from "../../db";

const announcement = sqliteTable("announcement", { id: text("id").primaryKey() });

export const announcements = (data: UserScopedDb) => data.select(announcement);
