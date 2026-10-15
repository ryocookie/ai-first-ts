// ドメイン層の範囲と、ドメイン層が import してよいモジュール。
// ドメイン層は純粋関数だけで書き、I/O・フレームワーク・インフラ・副作用のあるグローバルに触れない（lint/domain-purity.mjs が強制する）。
// ここからの削除・範囲の縮小と、DOMAIN_IMPORTS への追加は lint ルールの緩和にあたるため、変更せず提案として報告する（人間の承認制）。
// files はリポジトリルートからの相対パス（区切りは /）に対する正規表現。
export const DOMAIN_LAYERS = [
  {
    files: /(?:^|\/)domain\//,
    reason: "domain/ ディレクトリ配下はドメイン層（test/required.mjs のテスト必須の層と同じ範囲）",
  },
  {
    files: /^packages\/ai-profile\/fixtures\/lint\/domain-purity\.(?:invalid|valid)\.ts$/,
    reason: "ai-profile(domain-purity) のフィクスチャ（check-fixtures.mjs が検査する）",
  },
];

// ドメイン層が import してよいモジュール（指定子の完全一致）。
// これ以外は、同じくドメイン層にあるファイルへの相対 import だけを許す。
// tests: true のものはテスト（*.test.ts）からだけ import できる。
export const DOMAIN_IMPORTS = [
  {
    module: "@ai-first-ts/ai-profile/core",
    reason: "Result と Zod による検証。どちらも純粋関数",
  },
  { module: "zod", reason: "ドメインの値の形と不変条件をスキーマで表す" },
  { module: "bun:test", tests: true, reason: "ドメイン層のテスト" },
];
