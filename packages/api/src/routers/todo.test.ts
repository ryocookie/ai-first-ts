import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, test } from "bun:test";

import { anonymous, todoDatabase } from "../testing";
import { todoRouter } from "./todo";

let db: ReturnType<typeof todoDatabase>;
const clientOf = (userId: string) => createRouterClient(todoRouter, { context: db.as(userId) });
const titles = () => db.rows("select title, user_id as userId, completed from todo order by title");

beforeEach(() => {
  db = todoDatabase();
});

describe("認証", () => {
  test("未ログインはどの操作も UNAUTHORIZED", async () => {
    const client = createRouterClient(todoRouter, { context: anonymous });
    await expect(client.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.add({ title: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(titles()).toHaveLength(0);
  });
});

describe("add / list", () => {
  test("追加した todo はログイン中のユーザーのものになり、本人の一覧にだけ出る", async () => {
    const alice = clientOf("alice");
    const { id } = await alice.add({ title: "  buy milk  " });
    await clientOf("bob").add({ title: "bob's" });

    const listed = await alice.list();
    expect(listed.map((t) => ({ id: t.id, title: t.title, completed: t.completed }))).toEqual([
      { id, title: "buy milk", completed: false },
    ]);
    expect(titles()).toEqual([
      { title: "bob's", userId: "bob", completed: 0 },
      { title: "buy milk", userId: "alice", completed: 0 },
    ]);
  });

  test("空・長すぎるタイトルは BAD_REQUEST で、書き込まない", async () => {
    const alice = clientOf("alice");
    await expect(alice.add({ title: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(alice.add({ title: "x".repeat(201) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(titles()).toHaveLength(0);
  });
});

describe("setCompleted / remove", () => {
  test("自分の todo は更新・削除できる", async () => {
    const alice = clientOf("alice");
    const { id } = await alice.add({ title: "a" });
    expect(await alice.setCompleted({ id, completed: true })).toEqual({ id });
    expect(titles()[0]).toMatchObject({ completed: 1 });
    expect(await alice.remove({ id })).toEqual({ id });
    expect(titles()).toHaveLength(0);
  });

  test("他のユーザーの todo は存在しない場合と同じく NOT_FOUND で、変更されない", async () => {
    const { id } = await clientOf("alice").add({ title: "alice's" });
    const bob = clientOf("bob");
    await expect(bob.setCompleted({ id, completed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(bob.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(titles()).toEqual([{ title: "alice's", userId: "alice", completed: 0 }]);
  });

  test("DB の失敗は INTERNAL_SERVER_ERROR", async () => {
    db.rows("drop table todo");
    await expect(clientOf("alice").list()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
