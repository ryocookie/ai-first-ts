import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { type MemoryDatabase, memoryDatabase } from "./testing";
import type { UserScopedDb } from "./user-scope";

const note = sqliteTable("note", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
});

const DDL = `
  create table note (id text primary key, user_id text not null, body text not null, pinned integer not null default 0);
  insert into note (id, user_id, body) values ('a1', 'alice', 'alice-1'), ('a2', 'alice', 'alice-2'), ('b1', 'bob', 'bob-1');
`;

let db: MemoryDatabase;
let alice: UserScopedDb;
let bob: UserScopedDb;
/** スコープを通さずに表の中身を見る。 */
const allRows = () => db.rows("select id, user_id as userId, body from note order by id");

beforeEach(() => {
  db = memoryDatabase(DDL);
  alice = db.scope("alice");
  bob = db.scope("bob");
});

describe("select", () => {
  test("所有者の行だけを返す", async () => {
    const rows = await alice.select(note);
    expect(rows.ok ? rows.value.map((row) => row.id).sort() : []).toEqual(["a1", "a2"]);
  });

  test("where は所有者の条件に AND で加わる（他人の行を id で指定しても見えない）", async () => {
    const own = await alice.select(note, eq(note.id, "a2"));
    const others = await alice.select(note, eq(note.id, "b1"));
    expect(own.ok ? own.value.map((row) => row.body) : []).toEqual(["alice-2"]);
    expect(others).toStrictEqual({ ok: true, value: [] });
  });
});

describe("insert", () => {
  test("所有者の userId なら追加して行数を返す", async () => {
    const inserted = await bob.insert(note, { id: "b2", userId: bob.userId, body: "bob-2" });
    expect(inserted).toStrictEqual({ ok: true, value: 1 });
    expect(allRows().map((row) => row["id"])).toContain("b2");
  });

  test("他人の userId は OwnerMismatch で、書き込まない", async () => {
    const inserted = await bob.insert(note, { id: "x", userId: "alice", body: "forged" });
    expect(inserted.ok ? undefined : inserted.error.type).toBe("OwnerMismatch");
    expect(allRows()).toHaveLength(3);
  });

  test("クエリの失敗は DatabaseError（reject しない）", async () => {
    const inserted = await alice.insert(note, { id: "a1", userId: "alice", body: "duplicate" });
    expect(inserted.ok ? undefined : inserted.error.type).toBe("DatabaseError");
  });
});

describe("update", () => {
  test("所有者の行だけを更新する", async () => {
    const updated = await alice.update(note, { body: "edited" });
    expect(updated).toStrictEqual({ ok: true, value: 2 });
    expect(allRows().map((row) => row["body"])).toEqual(["edited", "edited", "bob-1"]);
  });

  test("他人の行は where で指定しても更新されず 0 件", async () => {
    const updated = await alice.update(note, { body: "hijacked" }, eq(note.id, "b1"));
    expect(updated).toStrictEqual({ ok: true, value: 0 });
    expect(allRows()[2]).toMatchObject({ id: "b1", body: "bob-1" });
  });

  test("userId を他人に変える更新は OwnerMismatch で、書き込まない", async () => {
    const updated = await alice.update(note, { userId: "bob" }, eq(note.id, "a1"));
    expect(updated.ok ? undefined : updated.error.type).toBe("OwnerMismatch");
    expect(allRows()[0]).toMatchObject({ id: "a1", userId: "alice" });
  });

  test("userId を所有者自身にする更新は許す", async () => {
    const updated = await alice.update(note, { userId: "alice", pinned: true }, eq(note.id, "a1"));
    expect(updated).toStrictEqual({ ok: true, value: 1 });
  });
});

describe("delete", () => {
  test("他人の行は削除されず、所有者の行だけを削除する", async () => {
    expect(await bob.delete(note, eq(note.id, "a1"))).toStrictEqual({ ok: true, value: 0 });
    expect(await bob.delete(note)).toStrictEqual({ ok: true, value: 1 });
    expect(allRows().map((row) => row["id"])).toEqual(["a1", "a2"]);
  });
});
