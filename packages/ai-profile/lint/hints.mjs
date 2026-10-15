// 「直し方」の対応表。キーは oxlint の JSON 出力の `code`（plugin(rule)）。
// ここに載っているルールはプロファイルが禁止する書き方で、
// fixtures/lint/<rule>.invalid.ts と <rule>.valid.ts の両方が必須（check-fixtures.mjs が検査する）。
// `any` を返す式（JSON.parse・res.json()・型のないライブラリ）の共通の直し方。
const VALIDATE_ANY =
  "`JSON.parse(text)` は `parseJson(Schema, text)`、`await res.json()` は `await readJson(Schema, res)`" +
  "（`@ai-first-ts/ai-profile/core`）に置き換える。それ以外は `const raw: unknown = ...` で受け、" +
  "Zod の `Schema.safeParse(raw)` で検証してから使う。";

export const HINTS = {
  "typescript(no-explicit-any)":
    "`any` を `unknown` に置き換え、Zod の `schema.safeParse` か型ガード（typeof / in / instanceof）で絞り込んでから使う。" +
    "呼び出し側で型が決まるならジェネリクス `<T>` にする。",
  "typescript(consistent-type-assertions)":
    "`as` / `<T>value` を消す。型を宣言したいだけなら型注釈 `const x: T = value` か `value satisfies T` を使う。" +
    "DOM・外部入力など実行時に型が不確かな値は `instanceof` や Zod で検証して絞り込む。`as const` は許可。",
  "typescript(no-non-null-assertion)":
    "`!` を消し、欠損を分岐で明示的に扱う（例: `if (value === undefined) return err(...)`）。" +
    "配列添字・Map#get・find の戻り値は undefined を含む前提で処理する。",
  "typescript(ban-ts-comment)":
    "`@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` を消し、型エラーそのものを直す。" +
    "ライブラリの型定義が誤っていて直せない場合は、回避せず実装を止めて報告する。",
  // 暗黙の any（type-aware）。JSON.parse など `any` を返す式が型チェックを素通りするのを止める。
  "typescript(no-unsafe-assignment)":
    VALIDATE_ANY +
    "型注釈 `const x: T = anyValue` は検証ではない。ライブラリの型が `any` を含む場合は、必要な値だけを受け取る形に引数を絞る。",
  "typescript(no-unsafe-member-access)":
    "`any` の値のプロパティを直接読まない。" +
    VALIDATE_ANY +
    "型が `error` と出る場合は型解決に失敗している（未生成のファイルや未ビルドのパッケージ）。先に `bun run check-types` を通す。",
  "typescript(no-unsafe-call)":
    "`any` の値を関数として呼ばない。" +
    VALIDATE_ANY +
    "関数を受け取るなら引数・変数に関数型（例: `() => void`）を付ける。",
  "typescript(no-unsafe-return)":
    "`any` をそのまま return しない。" +
    VALIDATE_ANY +
    "検証に失敗した場合は `err(...)` か `undefined` など戻り値の型で表す。",
  "typescript(no-unsafe-argument)": "`any` を型付きの引数に渡さない。" + VALIDATE_ANY,
  "typescript(no-floating-promises)":
    "Promise を放置しない。結果やエラーを使うなら `await` し、失敗を Result で扱う。" +
    "イベントハンドラなどで投げっぱなしが意図どおりなら `void promise` と明示する（失敗時の扱いはライブラリ側のコールバックで書く）。",
  "typescript(await-thenable)":
    "Promise でない値への `await` を消す。関数が同期なら直接呼ぶ。非同期のつもりなら関数の戻り値を `Promise<T>` にする。",
  "ai-profile(no-lint-disable)":
    "lint の無効化ディレクティブを消し、指摘されたルールに従ってコードを直す。" +
    "ルール自体が誤っていると判断した場合は .oxlintrc.json の変更を提案として報告する（人間の承認制）。",
  "ai-profile(no-throw)":
    '`throw` / `Promise.reject(...)` を消し、失敗を戻り値で表す（async 関数は `Promise<Result<T, E>>` を返す）。`import { err, ok, type Result } from "@ai-first-ts/ai-profile/core"` で ' +
    '戻り値を `Result<T, E>` にし、失敗は `return err({ type: "NotFound" })` のように判別可能な値で返す。' +
    "throw しうるライブラリ呼び出しは `tryCatch` / `tryCatchAsync` で Result に変換する。" +
    "境界（packages/api の ORPCError、apps/web/src/routes の redirect / notFound）では Result を受けてそこで throw する。" +
    "それ以外の場所で throw が必要なら回避せず、lint/throw-boundaries.mjs への追加を提案として報告する。",
  "ai-profile(untrusted-input)":
    "外部入力は unknown として受け取り、Zod スキーマで検証してから使う。" +
    '`import { parseJson, readJson, validate } from "@ai-first-ts/ai-profile/core"` を使い、' +
    "`JSON.parse(text)` は `parseJson(Schema, text)`、`await res.json()` は `await readJson(Schema, res)`、" +
    "その他の unknown は `validate(Schema, value)` に置き換えて Result を扱う。" +
    "oRPC の入力は `.input(z.object(...))` で検証し、`type<T>()` は使わない。`z.any()` は `z.unknown()`、" +
    "`z.custom<T>()` には検査関数を渡す。環境変数は env モジュール（apps/web/src/env.public.ts・apps/server/src/env.server.ts）の " +
    "`ENV` から読む。新しい入口ファイルが必要なら回避せず、lint/untrusted-boundaries.mjs への追加を提案として報告する。",
  "ai-profile(unsafe-sink)":
    "`sql.raw(...)` は drizzle の sql タグ付きテンプレート（埋め込んだ値はパラメータとしてバインドされる）かクエリビルダに置き換える。" +
    "`dangerouslySetInnerHTML` は消し、テキストは JSX の子要素として渡して React にエスケープさせる。" +
    "どうしても HTML を挿入する必要がある場合は回避せず、実装を止めて報告する。",
  "ai-profile(user-scope)":
    "生の DB（createDb・Database・drizzle のドライバ・SQLite*Database 型・ENV.DB）を使わず、" +
    "oRPC のハンドラなら `protectedProcedure` の `context.data`、それ以外なら引数で受け取った " +
    '`UserScopedDb`（`import type { UserScopedDb } from "@ai-first-ts/ai-profile/db"`）で読み書きする。' +
    "`data.select(table, where)` / `data.update(table, set, where)` / `data.delete(table, where)` は " +
    "`userId = ログイン中のユーザー` の条件を自動で付けるので、where には絞り込み条件だけを書く。" +
    "`data.insert(table, values)` の values.userId には `data.userId` を渡す。" +
    "`userScoped` は認証済みセッションから apps/server/src/context.ts だけで作る（他人の userId でスコープを作らない）。" +
    "対象は userId 列を持つテーブルだけ。userId を持たないテーブル（共有データ）や複数テーブルの結合が必要なら、" +
    "回避せず @ai-first-ts/ai-profile/db へのアクセサ追加か lint/data-access-boundaries.mjs への追加を提案として報告する。",
  "ai-profile(test-focus)":
    "`test.only` / `.skip` / `.todo` / `.if` / `.skipIf` / `.todoIf` / `.failing` と `xit` / `xtest` / `xdescribe` を消し、" +
    "全てのテストを常に実行する。落ちるテストは外さずにコードかテストを直す。未実装の振る舞いはテストを書かずに実装時に足す。" +
    '`import * as t from "bun:test"` は `import { describe, expect, test } from "bun:test"` にする。',
  "ai-profile(test-assertion)":
    "各テスト `test(name, () => { ... })` の本体（インラインの関数）で `expect(...)` を呼び、振る舞いを検証する。" +
    "例外が起きないことだけでなく戻り値・書き込んだ結果を比べる（例: `expect(result).toStrictEqual(ok(1))`）。" +
    "分岐の中で expect する場合は先頭で `expect.assertions(n)` を呼ぶ。テストのないテストファイルは消すかテストを書く。",
  "ai-profile(test-only)":
    "テスト専用モジュール（testing.ts。メモリ上の DB や任意のユーザーのセッションを作る）はテストファイル（bun:test を使うファイル）" +
    "か別の testing.ts からだけ import する。本番コードは認証済みのセッションと `context.data` を使う。",
};
