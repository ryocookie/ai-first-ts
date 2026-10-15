// 「直し方」の対応表。キーは oxlint の JSON 出力の `code`（plugin(rule)）。
// ここに載っているルールはプロファイルが禁止する書き方で、
// fixtures/lint/<rule>.invalid.ts と <rule>.valid.ts の両方が必須（check-fixtures.mjs が検査する）。
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
  "ai-profile(no-lint-disable)":
    "lint の無効化ディレクティブを消し、指摘されたルールに従ってコードを直す。" +
    "ルール自体が誤っていると判断した場合は .oxlintrc.json の変更を提案として報告する（人間の承認制）。",
};
