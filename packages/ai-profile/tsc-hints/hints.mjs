// TypeScript エラーコード → 「直し方」の対応表。bin/tsc-hints.mjs が tsc の出力に付ける。
// 直し方は必ず `any` / `as` / `!` / `@ts-ignore` を使わない手段で書く（CLAUDE.md の構造ルール）。
// 新しいコードを足したら fixtures/tsc-hints に違反例と正しい例を追加する。

const possiblyNullish =
  "値が無い場合を先に扱って型を絞り込む（`if (x === undefined) return ...` の早期 return、" +
  "`?.` / `??` で既定値を与える）。`!` で黙らせない。";

const unused =
  "使っていない宣言を削除する。インターフェース都合で受け取るだけの引数は名前を `_` で始める。";

/** @type {Readonly<Record<number, string>>} */
export const hints = {
  // --- tsconfig.base.json で有効化した厳格オプション ---------------------------
  2375:
    "exactOptionalPropertyTypes: 値が無いならキーごと省略する（`{ ...(x !== undefined && { key: x }) }`）。" +
    "`undefined` を明示的に入れる設計なら型を `key?: T | undefined` にする。",
  2379:
    "exactOptionalPropertyTypes: 引数オブジェクトに `undefined` のキーを渡している。" +
    "値が無いならキーを省略して渡すか、受け側の型を `key?: T | undefined` にする。",
  7030:
    "noImplicitReturns: 全ての分岐で明示的に return する。戻り値の型を注釈すると漏れた分岐が分かる。" +
    "到達しない分岐なら `const _exhaustive: never = x` で網羅性を型で示す。",
  4111:
    'noPropertyAccessFromIndexSignature: インデックスシグネチャのキーはブラケットで読む（`obj["key"]`）。' +
    "結果は `T | undefined` なので、存在チェックしてから使う。キーが固定なら型に明示的なプロパティとして定義する。",
  2532: possiblyNullish,
  2531: possiblyNullish,
  18047: possiblyNullish,
  18048: possiblyNullish,
  18049: possiblyNullish,
  7053:
    "インデックスに使うキーの型がオブジェクトのキー型と合っていない。キーを `keyof typeof obj` に絞るか、" +
    "`Record<K, V>` / `Map` で型を定義する。外部入力のキーなら Zod の `z.enum` で検証してから引く。",
  18046:
    "`unknown` は検証してから使う。外部入力なら Zod v4 のスキーマで `safeParse` し、成功した値だけを使う。" +
    "`as` で型を付けない。",
  2339:
    "存在しないプロパティにアクセスしている。型定義を確認し、ユニオンなら判別プロパティや `in` で絞り込む。" +
    "外部データなら Zod スキーマに項目を追加して検証する。",

  // --- 暗黙の any ---------------------------------------------------------------
  7005: "暗黙の `any` になっている。変数に型注釈を付けるか、初期値から型が推論されるようにする。",
  7006: "引数の型が暗黙の `any` になっている。引数に型注釈を付ける（例: `(user: User) => ...`）。",
  7031: "分割代入した引数の型が暗黙の `any` になっている。引数全体に型注釈を付ける（例: `({ id }: { id: string })`）。",
  7034: "変数の型が推論できず暗黙の `any` になる。宣言時に型注釈を付ける（例: `const items: Item[] = []`）。",
  2683: "`this` の型が暗黙の `any` になっている。アロー関数にするか、第1引数に `this: T` を宣言する。",

  // --- 型の不一致 ---------------------------------------------------------------
  2322:
    "代入先の型と合っていない。どちらの型が正しいかを決め、値を正しい型で作り直すか、型定義を直す。" +
    "外部入力なら Zod で検証した値を使う。`as` で合わせない。",
  2345: "引数の型が関数の期待する型と合っていない。呼び出し前に値を検証・変換するか、関数のシグネチャを見直す。`as` で合わせない。",
  2741: "必須プロパティが足りない。値を埋めるか、本当に任意なら型定義側で `key?: T` にする。",
  2353: "型に無いプロパティを渡している。プロパティ名の誤字を直すか、型定義に追加する。",
  2554: "引数の数が合っていない。関数のシグネチャを確認して、必要な引数を渡す／余分な引数を削る。",
  2366: "戻り値の型を宣言した関数に、return しない分岐がある。全ての分岐で値を返す。",
  2564: "クラスのプロパティが初期化されていない。宣言時かコンストラクタで初期化する。値が無い状態があるなら `T | undefined` にする。",

  // --- 未使用 -------------------------------------------------------------------
  6133: unused,
  6138: unused,
  6192: unused,
  6196: unused,
  6198: unused,
  6199: unused,

  // --- モジュール ---------------------------------------------------------------
  1484: "verbatimModuleSyntax: 型だけを import する時は `import type { T } from ...` か `import { type T } from ...` と書く。",
  1485: "verbatimModuleSyntax: 型だけを export する時は `export type { T }` と書く。",
  2304: "名前が見つからない。import 漏れか誤字を直す。グローバル型なら tsconfig の `types` に定義元が含まれているか確認する。",
  2307: "モジュールが見つからない。パス・パッケージ名の誤字を確認する。依存追加が必要なら allowlist にあるかを確認し、無ければ実装を止めて報告する。",

  // --- その他 -------------------------------------------------------------------
  7029: "noFallthroughCasesInSwitch: case の末尾に `break` / `return` を書く。",
  2578: "不要になった `@ts-expect-error` を削除する。",
};

export const fallbackHint =
  "このエラーコードの直し方は未登録。メッセージが示す型の食い違いを、値の検証・型定義の修正で解消する。" +
  "`any` / `as` / `!` / `@ts-ignore` で黙らせない。直し方が定まったら packages/ai-profile/tsc-hints/hints.mjs に追加を提案する。";

// メッセージで判別できる、コードより具体的な直し方。エラー行と詳細行のどこかに pattern が現れたら
// hints[code] の代わりに表示する。fixtures の違反例は `// expect: TS<code> <id>` でこちらを検査する。
/** @type {ReadonlyArray<{ id: string, pattern: RegExp, hint: string }>} */
export const messageHints = [
  {
    id: "owned-id",
    pattern: /OwnedId<"/,
    hint:
      '他のテーブルの行を参照する列（`OwnedId<"テーブル名">`）に、所有者を確かめていない id を渡している' +
      "（他のユーザーの行に結び付けられる = IDOR）。先に `const ref = await context.data.own(<参照先テーブル>, id)` " +
      "で所有者の行かを確かめ、`!ref.ok` なら NOT_FOUND を返し、`ref.value` を渡す。where の `eq` も同じ。" +
      "型述語や `as` で OwnedId を作らない。",
  },
];

/**
 * @param {number} code
 * @param {string} [message] エラー行と詳細行
 */
export const hintFor = (code, message = "") =>
  messageHints.find(({ pattern }) => pattern.test(message))?.hint ?? hints[code] ?? fallbackHint;
