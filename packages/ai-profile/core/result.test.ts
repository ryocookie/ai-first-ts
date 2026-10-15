import { describe, expect, test } from "bun:test";

import {
  andThen,
  err,
  map,
  mapErr,
  ok,
  type Result,
  tryCatch,
  tryCatchAsync,
  unwrapOr,
} from "./result";

// 型を Result<number, string> のまま保つ（変数の宣言だと Ok / Err に絞り込まれてしまう）。
const make = (succeeded: boolean): Result<number, string> => (succeeded ? ok(2) : err("boom"));
const success = make(true);
const failure = make(false);

describe("ok / err", () => {
  test("判別プロパティ ok で成功と失敗を区別できる", () => {
    expect(ok(1)).toStrictEqual({ ok: true, value: 1 });
    expect(err("x")).toStrictEqual({ ok: false, error: "x" });
  });
});

describe("map", () => {
  test("成功値だけを変換する", () => {
    expect(map(success, (n) => n * 10)).toStrictEqual(ok(20));
  });

  test("失敗は関数を呼ばずにそのまま返す", () => {
    let called = false;
    const mapped = map(failure, (n) => {
      called = true;
      return n;
    });
    expect(mapped).toBe(failure);
    expect(called).toBeFalse();
  });
});

describe("mapErr", () => {
  test("失敗値だけを変換する", () => {
    expect(mapErr(failure, (e) => ({ type: "Wrapped", cause: e }))).toStrictEqual(
      err({ type: "Wrapped", cause: "boom" }),
    );
  });

  test("成功はそのまま返す", () => {
    expect(mapErr(success, (e) => e.length)).toStrictEqual(ok(2));
  });
});

describe("andThen", () => {
  const half = (n: number): Result<number, "Odd"> => (n % 2 === 0 ? ok(n / 2) : err("Odd"));

  test("成功時は次の Result をつなぐ", () => {
    expect(andThen(success, half)).toStrictEqual(ok(1));
    expect(andThen(ok(3), half)).toStrictEqual(err("Odd"));
  });

  test("失敗は次の処理を呼ばずに伝わる", () => {
    expect(andThen(failure, half)).toBe(failure);
  });
});

describe("unwrapOr", () => {
  test("成功なら値、失敗なら fallback を返す", () => {
    expect(unwrapOr(success, 0)).toBe(2);
    expect(unwrapOr(failure, 0)).toBe(0);
  });
});

describe("tryCatch", () => {
  test("正常終了は ok にする", () => {
    expect(tryCatch(() => decodeURIComponent("%41"), String)).toStrictEqual(ok("A"));
  });

  test("throw されたら onError の戻り値を err にする", () => {
    const result = tryCatch(
      () => decodeURIComponent("%"),
      (cause) => (cause instanceof URIError ? "URIError" : "other"),
    );
    expect(result).toStrictEqual(err("URIError"));
  });
});

describe("tryCatchAsync", () => {
  test("resolve は ok にする", async () => {
    expect(await tryCatchAsync(() => Promise.resolve(1), String)).toStrictEqual(ok(1));
  });

  test("reject は onError の戻り値を err にする", async () => {
    const result = await tryCatchAsync(
      () => Promise.reject(new Error("network")),
      (cause) => (cause instanceof Error ? cause.message : "unknown"),
    );
    expect(result).toStrictEqual(err("network"));
  });

  test("同期的に throw する関数も err にする", async () => {
    const result = await tryCatchAsync(
      async () => decodeURIComponent("%"),
      (cause) => cause instanceof URIError,
    );
    expect(result).toStrictEqual(err(true));
  });
});
