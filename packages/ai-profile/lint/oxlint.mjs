// oxlint を JSON 出力で実行し、プロファイル独自の検査（lint 無効化ディレクティブの禁止）を加えた診断を返す。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const repoRoot = join(import.meta.dirname, "..", "..", "..");
const oxlintBin = join(repoRoot, "node_modules", ".bin", "oxlint");

// oxlint / eslint の disable・enable コメントによるインライン無効化。
// oxlint にはこれを無視するオプションがないため、ここで禁止する。
const disableDirective = /\/[/*]\s*(?:oxlint|eslint)-(?:disable|enable)\b/;

function runOxlint(args) {
  const result = spawnSync(oxlintBin, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function findDisableDirectives(args) {
  // oxlint 自身に対象ファイルを列挙させ、ignorePatterns と引数の解釈を揃える。
  const listed = runOxlint([...args, "--debug=files"]);
  const files = listed.stdout.split("\n").filter((line) => line.length > 0);
  const diagnostics = [];
  for (const file of files) {
    const lines = readFileSync(join(repoRoot, file), "utf8").split("\n");
    lines.forEach((text, index) => {
      if (disableDirective.test(text)) {
        diagnostics.push({
          code: "ai-profile(no-lint-disable)",
          severity: "error",
          message: "Inline lint disable directives are not allowed.",
          filename: file,
          line: index + 1,
          column: text.search(disableDirective) + 1,
        });
      }
    });
  }
  return diagnostics;
}

/** @param {string[]} args oxlint にそのまま渡す引数（パス・-c・--quiet など） */
export function lint(args) {
  const result = runOxlint([...args, "--format=json"]);
  const start = result.stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`oxlint produced no JSON output:\n${result.stdout}${result.stderr}`);
  }
  const report = JSON.parse(result.stdout.slice(start));
  const diagnostics = report.diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    filename: d.filename,
    line: d.labels[0]?.span.line ?? 0,
    column: d.labels[0]?.span.column ?? 0,
  }));
  return [...diagnostics, ...findDisableDirectives(args)];
}
