import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, test } from "bun:test";

import { anonymous, todoDatabase } from "../testing";
import { appRouter } from "./index";

let db: ReturnType<typeof todoDatabase>;
const clientOf = (userId: string) => createRouterClient(appRouter, { context: db.as(userId) });

beforeEach(() => {
  db = todoDatabase();
});

describe("tag", () => {
  test("unauthenticated is rejected", async () => {
    const client = createRouterClient(appRouter, { context: anonymous });
    await expect(client.tag.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("create / list only shows own tags", async () => {
    const alice = clientOf("alice");
    await alice.tag.create({ name: " Work ", color: "#112233" });
    await clientOf("bob").tag.create({ name: "bob" });
    const tags = await alice.tag.list();
    expect(tags.map((t) => ({ name: t.name, color: t.color }))).toEqual([
      { name: "work", color: "#112233" },
    ]);
  });

  test("invalid color is BAD_REQUEST", async () => {
    await expect(clientOf("alice").tag.create({ name: "x", color: "red" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("attach / detach and filter todos by tag", async () => {
    const alice = clientOf("alice");
    const { id: todoId } = await alice.todo.add({ title: "a" });
    await alice.todo.add({ title: "b" });
    const { id: tagId } = await alice.tag.create({ name: "work" });

    await alice.tag.attach({ todoId, tagId });
    const filtered = await alice.todo.list({ tagId });
    expect(filtered.map((t) => t.title)).toEqual(["a"]);
    expect(filtered[0]?.tags.map((t) => t.name)).toEqual(["work"]);

    await alice.tag.detach({ todoId, tagId });
    expect(await alice.todo.list({ tagId })).toEqual([]);
  });

  test("todos with a past due date are overdue", async () => {
    const alice = clientOf("alice");
    await alice.todo.add({ title: "late", dueAt: new Date("2000-01-01") });
    const [todo] = await alice.todo.list();
    expect(todo?.overdue).toBe(true);
  });
});
