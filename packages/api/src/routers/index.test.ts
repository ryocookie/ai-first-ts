import { createRouterClient } from "@orpc/server";
import { expect, test } from "bun:test";

import { anonymous, todoDatabase } from "../testing";
import { appRouter } from "./index";

test("healthCheck は未ログインでも OK を返す", async () => {
  const client = createRouterClient(appRouter, { context: anonymous });
  expect(await client.healthCheck()).toBe("OK");
});

test("privateData は未ログインを UNAUTHORIZED で拒否する", async () => {
  const client = createRouterClient(appRouter, { context: anonymous });
  await expect(client.privateData()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

test("privateData はログイン中のユーザーを返す", async () => {
  const client = createRouterClient(appRouter, { context: todoDatabase().as("alice") });
  expect(await client.privateData()).toMatchObject({ user: { id: "alice" } });
});
