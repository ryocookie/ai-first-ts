// ゲートそのもの（強制の仕組みと、その判定に使う方針データ）。
// AI がこれらを書き換えるとゲートを弱められるため、.claude/hooks/guard.mjs が編集前に人間の許可を求め、
// .github/CODEOWNERS が PR で所有者のレビューを要求する（gate/check.mjs が両者の一致を検査する）。
// tsconfig・package.json・lint 設定のように gate/check.mjs が内容を機械検査するものは、
// 緩める変更だけが落ちるので、ここには入れず通常どおり編集できる。
// pattern はリポジトリルートからの相対パス（区切りは /）に対する正規表現、codeowners は CODEOWNERS の行のパターン。
export const PROTECTED_PATHS = [
  { pattern: /^\.claude\//, codeowners: "/.claude/", reason: "hooks と権限設定" },
  { pattern: /^\.github\//, codeowners: "/.github/", reason: "CI と CODEOWNERS" },
  { pattern: /^lefthook\.yml$/, codeowners: "/lefthook.yml", reason: "git hooks" },
  { pattern: /^\.oxlintrc\.json$/, codeowners: "/.oxlintrc.json", reason: "lint ルール" },
  { pattern: /^\.oxfmtrc\.json$/, codeowners: "/.oxfmtrc.json", reason: "フォーマット対象" },
  {
    pattern: /^packages\/config\/tsconfig\.base\.json$/,
    codeowners: "/packages/config/tsconfig.base.json",
    reason: "型チェックの厳格度",
  },
  {
    pattern: /^packages\/ai-profile\/allowlist\.json$/,
    codeowners: "/packages/ai-profile/allowlist.json",
    reason: "依存パッケージの allowlist",
  },
  {
    pattern: /^packages\/ai-profile\/gate\//,
    codeowners: "/packages/ai-profile/gate/",
    reason: "ゲートの改ざん検査",
  },
  // 以下はルールの実装そのもの。1 行消すだけで検査を外せる（例: test/required.mjs の層、lint/run.mjs の対象）ため保護する。
  // core/（Result・検証の関数）と fixtures/（check-fixtures が期待どおりの成否を検査する）は対象外。
  {
    pattern: /^packages\/ai-profile\/lint\//,
    codeowners: "/packages/ai-profile/lint/",
    reason: "lint ルールの実装・直し方・例外境界",
  },
  {
    pattern: /^packages\/ai-profile\/test\//,
    codeowners: "/packages/ai-profile/test/",
    reason: "テスト必須の層とテストの実行",
  },
  {
    pattern: /^packages\/ai-profile\/bin\//,
    codeowners: "/packages/ai-profile/bin/",
    reason: "型チェックのラッパー（終了コードを維持する）",
  },
  {
    pattern: /^packages\/ai-profile\/tsc-hints\//,
    codeowners: "/packages/ai-profile/tsc-hints/",
    reason: "型エラーの直し方",
  },
  {
    pattern: /^packages\/ai-profile\/db\//,
    codeowners: "/packages/ai-profile/db/",
    reason: "ユーザースコープのデータアクセス（認可）",
  },
  // 既存のリポジトリへの導入（adopt/）。導入先では、設定とベースラインもゲートになる。
  {
    pattern: /^packages\/ai-profile\/adopt\//,
    codeowners: "/packages/ai-profile/adopt/",
    reason: "導入（init）とベースラインとの比較",
  },
  {
    pattern: /^ai-profile\.config\.json$/,
    codeowners: "/ai-profile.config.json",
    reason: "導入先で層ごとに有効にするルールと例外・導入時からある依存",
  },
  {
    pattern: /^ai-profile\.baseline\.json$/,
    codeowners: "/ai-profile.baseline.json",
    reason: "導入時からある違反（これより増えた分を落とす）",
  },
];

/** @param {string} path リポジトリルートからの相対パス（ディレクトリなら末尾の / はあってもなくてもよい） */
export function protectedReason(path) {
  const normalized = path.split("\\").join("/").replace(/^\.\//, "");
  const asDir = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return PROTECTED_PATHS.find((p) => p.pattern.test(normalized) || p.pattern.test(asDir))?.reason;
}
