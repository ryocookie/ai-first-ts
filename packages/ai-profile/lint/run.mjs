// リポジトリ全体を lint し、プロファイルが禁止する書き方には「直し方」を添えて表示する。
// 使い方: bun packages/ai-profile/lint/run.mjs [oxlint の引数...]
import { HINTS } from "./hints.mjs";
import { lint } from "./oxlint.mjs";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const diagnostics = lint(args).filter((d) => !quiet || d.severity === "error");

for (const d of diagnostics) {
  console.error(`${d.filename}:${d.line}:${d.column}: ${d.severity} ${d.code}: ${d.message}`);
  const hint = HINTS[d.code];
  if (hint !== undefined) {
    console.error(`  直し方: ${hint}`);
  }
}

const errors = diagnostics.filter((d) => d.severity === "error").length;
if (errors > 0) {
  console.error(`\nlint failed: ${errors} error(s).`);
  process.exit(1);
}
console.log(`lint passed (${diagnostics.length} warning(s)).`);
