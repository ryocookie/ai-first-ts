import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { err, ok } from "./result";
import { parseJson, readJson, validate } from "./validate";

const Order = z.object({
  id: z.string().min(1),
  items: z.array(z.object({ qty: z.number().int().positive() })),
});

describe("validate", () => {
  test("スキーマに合う値は ok で、スキーマの出力型になる", () => {
    const input: unknown = { id: "o1", items: [{ qty: 2 }], extra: true };
    expect(validate(Order, input)).toStrictEqual(ok({ id: "o1", items: [{ qty: 2 }] }));
  });

  test("変換（transform / coerce）の結果を返す", () => {
    expect(validate(z.coerce.number(), "42")).toStrictEqual(ok(42));
  });

  test("合わない値は InvalidInput で、全ての問題をドット区切りのパス付きで返す", () => {
    const result = validate(Order, { id: "", items: [{ qty: 1 }, { qty: 0 }] });
    expect(result.ok).toBeFalse();
    if (result.ok) {
      return;
    }
    expect(result.error.type).toBe("InvalidInput");
    expect(result.error.issues.map((issue) => issue.path)).toEqual(["id", "items.1.qty"]);
    expect(result.error.issues.every((issue) => issue.message.length > 0)).toBeTrue();
  });

  test("ルートの値が合わない場合のパスは空文字", () => {
    const result = validate(Order, null);
    expect(result.ok ? [] : result.error.issues.map((issue) => issue.path)).toEqual([""]);
  });
});

describe("parseJson", () => {
  test("JSON を解析して検証する", () => {
    expect(parseJson(Order, '{"id":"o1","items":[]}')).toStrictEqual(ok({ id: "o1", items: [] }));
  });

  test("壊れた JSON は InvalidJson（throw しない）", () => {
    const result = parseJson(Order, "{");
    expect(result.ok ? undefined : result.error.type).toBe("InvalidJson");
  });

  test("JSON としては正しいがスキーマに合わない場合は InvalidInput", () => {
    const result = parseJson(Order, '{"id":1}');
    expect(result.ok ? undefined : result.error.type).toBe("InvalidInput");
  });
});

describe("readJson", () => {
  test("Request の本文を解析して検証する", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: '{"id":"o1","items":[{"qty":3}]}',
    });
    expect(await readJson(Order, request)).toStrictEqual(ok({ id: "o1", items: [{ qty: 3 }] }));
  });

  test("本文が読めない場合は InvalidJson（reject しない）", async () => {
    const body = { text: () => Promise.reject(new Error("stream closed")) };
    expect(await readJson(Order, body)).toStrictEqual(
      err({ type: "InvalidJson", message: "stream closed" }),
    );
  });

  test("Error 以外の reject も文字列にして InvalidJson にする", async () => {
    const body = { text: () => Promise.reject("locked") };
    const result = await readJson(Order, body);
    expect(result).toStrictEqual(err({ type: "InvalidJson", message: "locked" }));
  });
});
