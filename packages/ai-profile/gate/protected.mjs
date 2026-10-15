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
  {
    pattern: /^packages\/ai-profile\/lint\/[^/]+-boundaries\.mjs$/,
    codeowners: "/packages/ai-profile/lint/*-boundaries.mjs",
    reason: "lint ルールの例外境界",
  },
];

/** @param {string} path リポジトリルートからの相対パス（ディレクトリなら末尾の / はあってもなくてもよい） */
export function protectedReason(path) {
  const normalized = path.split("\\").join("/").replace(/^\.\//, "");
  const asDir = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return PROTECTED_PATHS.find((p) => p.pattern.test(normalized) || p.pattern.test(asDir))?.reason;
}
