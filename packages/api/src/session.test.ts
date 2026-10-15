import { expect, test } from "bun:test";

import { requireSession } from "./session";
import { anonymous, sessionOf, todoDatabase } from "./testing";

test("未ログインは UNAUTHORIZED", () => {
  expect(requireSession(anonymous)).toStrictEqual({ ok: false, error: { code: "UNAUTHORIZED" } });
});

test("セッションがあってもデータアクセサがなければ UNAUTHORIZED", () => {
  const context = { session: sessionOf("alice"), data: null };
  expect(requireSession(context)).toStrictEqual({ ok: false, error: { code: "UNAUTHORIZED" } });
});

test("ログイン済みならセッションとデータアクセサを返す", () => {
  const context = todoDatabase().as("alice");
  const result = requireSession(context);
  expect(result.ok ? result.value.session.user.id : undefined).toBe("alice");
  expect(result.ok ? result.value.data.userId : undefined).toBe("alice");
});
