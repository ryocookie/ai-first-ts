// 外部入力（Untrusted）を Zod スキーマで検証し、型付きの値（Validated）にする唯一の入口。
// 外部入力は unknown のまま受け取り、ここを通してから使う（ai-profile(untrusted-input) が強制する）。
// oRPC の `.input(schema)` は oRPC 自身がスキーマで検証するので、ハンドラの input はそのまま使ってよい。
import type { z } from "zod";

import { err, ok, type Result, tryCatch, tryCatchAsync } from "./result";

export type ValidationIssue = { readonly path: string; readonly message: string };
export type InvalidInput = {
  readonly type: "InvalidInput";
  readonly issues: readonly ValidationIssue[];
};
export type InvalidJson = { readonly type: "InvalidJson"; readonly message: string };

function invalidJson(cause: unknown): InvalidJson {
  return { type: "InvalidJson", message: cause instanceof Error ? cause.message : String(cause) };
}

/** unknown を schema で検証する。成功時の値の型は schema の出力型になる。 */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Result<z.output<S>, InvalidInput> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return err({
      type: "InvalidInput",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return ok(parsed.data);
}

/** JSON 文字列（Webhook の本文・LLM 出力・Cookie の値など）を解析して schema で検証する。 */
export function parseJson<S extends z.ZodType>(
  schema: S,
  text: string,
): Result<z.output<S>, InvalidJson | InvalidInput> {
  const json = tryCatch((): unknown => JSON.parse(text), invalidJson);
  if (!json.ok) {
    return json;
  }
  return validate(schema, json.value);
}

/** Request / Response の本文を JSON として読み、schema で検証する。 */
export async function readJson<S extends z.ZodType>(
  schema: S,
  body: { text(): Promise<string> },
): Promise<Result<z.output<S>, InvalidJson | InvalidInput>> {
  const text = await tryCatchAsync(() => body.text(), invalidJson);
  if (!text.ok) {
    return text;
  }
  return parseJson(schema, text.value);
}
