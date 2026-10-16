import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { type MemoryDatabase, memoryDatabase } from "./testing";
import type { OwnedId, UserScopedDb } from "./user-scope";

const note = sqliteTable("note", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
});

// note を参照するテーブル。参照列は OwnedId<"note"> なので data.own で確かめた id しか渡せない。
const pin = sqliteTable("pin", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  noteId: text("note_id")
    .$type<OwnedId<"note">>()
    .notNull()
    .references(() => note.id),
});

const DDL = `
  create table note (id text primary key, user_id text not null, body text not null, pinned integer not null default 0);
  insert into note (id, user_id, body) values ('a1', 'alice', 'alice-1'), ('a2', 'alice', 'alice-2'), ('b1', 'bob', 'bob-1');
  create table pin (id text primary key, user_id text not null, note_id text not null);
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

describe("own", () => {
  test("所有者の行の id は OwnedId になる", async () => {
    const owned = await alice.own(note, "a1");
    expect(owned.ok ? `${owned.value}` : undefined).toBe("a1");
  });

  test("他人の行・存在しない行は区別せず NotOwned", async () => {
    const others = await alice.own(note, "b1");
    const missing = await alice.own(note, "zz");
    expect(others.ok ? undefined : others.error.type).toBe("NotOwned");
    expect(missing.ok ? undefined : missing.error).toStrictEqual(
      others.ok ? undefined : others.error,
    );
  });
});

describe("参照列（外部キー）", () => {
  const pins = () =>
    db.rows("select id, user_id as userId, note_id as noteId from pin order by id");
  // 型をすり抜けた値（型述語での偽装など）。実行時の検査がこれでも他人の行への参照を止めることを確かめる。
  const forged = (id: string): id is OwnedId<"note"> => id.length > 0;
  const pinA1 = async () => {
    const noteId = await alice.own(note, "a1");
    return noteId.ok
      ? alice.insert(pin, { id: "p1", userId: alice.userId, noteId: noteId.value })
      : noteId;
  };

  test("own で確かめた id なら参照できる", async () => {
    expect(await pinA1()).toStrictEqual({ ok: true, value: 1 });
  });

  test("他人の行・存在しない行への参照は NotOwned で、書き込まない", async () => {
    const ids = ["b1", "zz"].filter(forged);
    expect(ids).toHaveLength(2);
    for (const noteId of ids) {
      const inserted = await alice.insert(pin, { id: `p-${noteId}`, userId: alice.userId, noteId });
      expect(inserted.ok ? undefined : inserted.error.type).toBe("NotOwned");
    }
    expect(pins()).toHaveLength(0);
  });

  test("update で参照先を他人の行に向けると NotOwned で、書き込まない", async () => {
    expect(await pinA1()).toStrictEqual({ ok: true, value: 1 });
    const targets = ["b1"].filter(forged);
    expect(targets).toHaveLength(1);
    for (const noteId of targets) {
      const updated = await alice.update(pin, { noteId }, eq(pin.id, "p1"));
      expect(updated.ok ? undefined : updated.error.type).toBe("NotOwned");
    }
    expect(pins()).toStrictEqual([{ id: "p1", userId: "alice", noteId: "a1" }]);
  });
});
