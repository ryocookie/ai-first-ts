// gate(scripts): verify と各パッケージの check-types から検査の段を抜かせない。
// CI は `bun run verify` を実行するため、package.json の scripts を書き換えると CI ごと検査を外せてしまう。
// そのため CI は gate/check.mjs を verify とは別に直接実行し、この検査で scripts を固定する。

export const REQUIRED_VERIFY = [
  "turbo run check-types",
  "bun packages/ai-profile/lint/check-fixtures.mjs",
  "bun packages/ai-profile/lint/run.mjs",
  "oxfmt --check",
  "bun packages/ai-profile/test/run.mjs",
  "bun packages/ai-profile/gate/check.mjs",
];
export const REQUIRED_VERIFY_QUICK = [
  "bun packages/ai-profile/lint/run.mjs",
  "bun packages/ai-profile/gate/check.mjs",
];
// 型チェックの代わりに別の検査を check-types にしているパッケージ。
const CHECK_TYPES_EXCEPTIONS = {
  "@ai-first-ts/config": "bun scripts/check-fixtures.mjs",
  "@ai-first-ts/ai-profile": "bun bin/tsc-hints.mjs",
};
// 失敗を握りつぶす書き方。
const SWALLOW =
  /\|\|\s*(?:true|:|exit\s+0)|;\s*(?:true|exit\s+0)\s*$|--passWithNoTests|\bexit\s+0\b/;

const HINT =
  "verify と check-types から検査を外したり、失敗を握りつぶしたりしない。落ちている検査の指摘に従ってコードを直す。" +
  "検査の構成を変える必要があると判断したら、実装を止めて変更案を報告する（人間の承認制）。";

/**
 * 各段は `&&` でつながっていなければならない（`;` や `||` だと前の段の失敗が無視される）。
 * @param {string} script
 * @param {string} step
 */
function runsStep(script, step) {
  return script
    .split("&&")
    .some((part) => part.trim() === step || part.trim().startsWith(`${step} `));
}

/**
 * @param {string} path リポジトリルートからの相対パス
 * @param {unknown} pkg package.json の内容
 */
export function findWeakenedScripts(path, pkg) {
  const problems = [];
  const report = (message) =>
    problems.push({ code: "gate(scripts)", file: path, message, hint: HINT });
  const record = typeof pkg === "object" && pkg !== null ? pkg : {};
  const scripts =
    typeof record.scripts === "object" && record.scripts !== null ? record.scripts : {};
  const script = (name) => (typeof scripts[name] === "string" ? scripts[name] : "");

  /** @type {{ name: string, steps: string[] }[]} */
  const required =
    path === "package.json"
      ? [
          { name: "verify", steps: REQUIRED_VERIFY },
          { name: "verify:quick", steps: REQUIRED_VERIFY_QUICK },
        ]
      : [{ name: "check-types", steps: [CHECK_TYPES_EXCEPTIONS[record.name] ?? "tsc-hints"] }];

  for (const { name, steps } of required) {
    const text = script(name);
    for (const step of steps) {
      if (!runsStep(text, step)) {
        report(`scripts.${name} が「${step}」を && でつないで実行していない。`);
      }
    }
    if (SWALLOW.test(text)) {
      report(`scripts.${name} が失敗を握りつぶしている（${SWALLOW.exec(text)?.[0]}）。`);
    }
  }
  return problems;
}
