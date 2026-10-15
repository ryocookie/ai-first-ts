import { call } from "@orpc/server";
import { expect, test } from "bun:test";

import { protectedProcedure, publicProcedure } from "./index";
import { anonymous, todoDatabase } from "./testing";

const whoAmI = protectedProcedure.handler(({ context }) => context.session.user.id);
const open = publicProcedure.handler(() => "open");

test("publicProcedure は未ログインでも呼べる", async () => {
  expect(await call(open, undefined, { context: anonymous })).toBe("open");
});

test("protectedProcedure は未ログインを UNAUTHORIZED で拒否する", async () => {
  await expect(call(whoAmI, undefined, { context: anonymous })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});

test("protectedProcedure はログイン済みのセッションをハンドラに渡す", async () => {
  expect(await call(whoAmI, undefined, { context: todoDatabase().as("alice") })).toBe("alice");
});
