import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, test } from "bun:test";

import { anonymous, todoDatabase } from "../testing";
import { appRouter } from "./index";

let db: ReturnType<typeof todoDatabase>;
const clientOf = (userId: string) => createRouterClient(appRouter, { context: db.as(userId) });
const links = () =>
  db.rows("select user_id as userId, todo_id as todoId, tag_id as tagId from todo_tag");

beforeEach(() => {
  db = todoDatabase();
});

describe("認証", () => {
  test("未ログインはどの操作も UNAUTHORIZED", async () => {
    const client = createRouterClient(appRouter, { context: anonymous });
    await expect(client.tag.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.tag.create({ name: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(client.tag.attach({ todoId: "a", tagId: "b" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("create / list / remove", () => {
  test("作ったタグは本人の一覧にだけ出る", async () => {
    const alice = clientOf("alice");
    const { id } = await alice.tag.create({ name: " Work ", color: "#112233" });
    await clientOf("bob").tag.create({ name: "bob" });
    expect(await alice.tag.list()).toEqual([{ id, name: "work", color: "#112233" }]);
  });

  test("不正な名前・色は BAD_REQUEST で、書き込まない", async () => {
    const alice = clientOf("alice");
    await expect(alice.tag.create({ name: "x", color: "red" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(alice.tag.create({ name: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(alice.tag.create({ name: "x".repeat(33) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await alice.tag.list()).toEqual([]);
  });

  test("同じ名前（正規化後）のタグは CONFLICT。他のユーザーとは重なってよい", async () => {
    const alice = clientOf("alice");
    await alice.tag.create({ name: "work" });
    await expect(alice.tag.create({ name: " WORK" })).rejects.toMatchObject({ code: "CONFLICT" });
    await clientOf("bob").tag.create({ name: "work" });
    expect(await alice.tag.list()).toHaveLength(1);
  });

  test("存在しない・他のユーザーのタグの削除は NOT_FOUND", async () => {
    const { id } = await clientOf("bob").tag.create({ name: "bob" });
    await expect(clientOf("alice").tag.remove({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(clientOf("alice").tag.remove({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await clientOf("bob").tag.list()).toHaveLength(1);
  });
});

describe("attach / detach", () => {
  test("付けたタグで todo を絞り込め、外すと出なくなる", async () => {
    const alice = clientOf("alice");
    const { id: todoId } = await alice.todo.add({ title: "a" });
    await alice.todo.add({ title: "b" });
    const { id: tagId } = await alice.tag.create({ name: "work" });

    expect(await alice.tag.attach({ todoId, tagId })).toEqual({ todoId, tagId });
    const filtered = await alice.todo.list({ tagId });
    expect(filtered.map((t) => ({ title: t.title, tags: t.tags.map((x) => x.name) }))).toEqual([
      { title: "a", tags: ["work"] },
    ]);

    expect(await alice.tag.detach({ todoId, tagId })).toEqual({ todoId, tagId });
    expect(await alice.todo.list({ tagId })).toEqual([]);
    await expect(alice.tag.detach({ todoId, tagId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("付け直しは冪等", async () => {
    const alice = clientOf("alice");
    const { id: todoId } = await alice.todo.add({ title: "a" });
    const { id: tagId } = await alice.tag.create({ name: "work" });
    await alice.tag.attach({ todoId, tagId });
    await alice.tag.attach({ todoId, tagId });
    expect(links()).toHaveLength(1);
  });

  test("他のユーザーの todo には自分のタグを付けられない", async () => {
    const { id: todoId } = await clientOf("bob").todo.add({ title: "bob's" });
    const alice = clientOf("alice");
    const { id: tagId } = await alice.tag.create({ name: "x" });
    await expect(alice.tag.attach({ todoId, tagId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(links()).toEqual([]);
  });

  test("他のユーザーのタグは自分の todo に付けられない", async () => {
    const { id: tagId } = await clientOf("bob").tag.create({ name: "bob" });
    const alice = clientOf("alice");
    const { id: todoId } = await alice.todo.add({ title: "a" });
    await expect(alice.tag.attach({ todoId, tagId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(links()).toEqual([]);
  });

  test("他のユーザーのリンクは外せない", async () => {
    const bob = clientOf("bob");
    const { id: todoId } = await bob.todo.add({ title: "b" });
    const { id: tagId } = await bob.tag.create({ name: "bob" });
    await bob.tag.attach({ todoId, tagId });
    await expect(clientOf("alice").tag.detach({ todoId, tagId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(links()).toEqual([{ userId: "bob", todoId, tagId }]);
  });

  test("タグや todo を消すとリンクも消える", async () => {
    const alice = clientOf("alice");
    const { id: todoA } = await alice.todo.add({ title: "a" });
    const { id: todoB } = await alice.todo.add({ title: "b" });
    const { id: work } = await alice.tag.create({ name: "work" });
    const { id: home } = await alice.tag.create({ name: "home" });
    await alice.tag.attach({ todoId: todoA, tagId: work });
    await alice.tag.attach({ todoId: todoB, tagId: home });

    await alice.tag.remove({ id: work });
    await alice.todo.remove({ id: todoB });
    expect(links()).toEqual([]);
  });

  test("DB の失敗は INTERNAL_SERVER_ERROR", async () => {
    db.rows("drop table todo_tag");
    await expect(clientOf("alice").todo.list()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("期限", () => {
  test("期限日は利用者の今日と比べ、当日中は期限切れにしない", async () => {
    const alice = clientOf("alice");
    await alice.todo.add({ title: "due", dueOn: "2026-10-16" });
    const on = await alice.todo.list({ today: "2026-10-16" });
    const after = await alice.todo.list({ today: "2026-10-17" });
    expect(on.map((t) => ({ dueOn: t.dueOn, overdue: t.overdue }))).toEqual([
      { dueOn: "2026-10-16", overdue: false },
    ]);
    expect(after.map((t) => t.overdue)).toEqual([true]);
  });

  test("期限日は YYYY-MM-DD だけを受け付ける", async () => {
    const alice = clientOf("alice");
    for (const dueOn of ["2026-13-01", "2026-10-16T00:00:00Z", "10/16/2026"]) {
      await expect(alice.todo.add({ title: "x", dueOn })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    await expect(alice.todo.list({ today: "yesterday" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("一覧は所有者の userId を返さない", async () => {
    const alice = clientOf("alice");
    await alice.todo.add({ title: "a" });
    const [todo] = await alice.todo.list();
    expect(todo === undefined ? [] : Object.keys(todo).sort()).toEqual([
      "completed",
      "createdAt",
      "dueOn",
      "id",
      "overdue",
      "tags",
      "title",
    ]);
  });
});
