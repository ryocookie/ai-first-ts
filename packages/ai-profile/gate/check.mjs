// ゲートの改ざん・迂回を検査する（verify と CI から実行。CI は verify とは別に直接実行する）。
//   gate(deps)        すべての package.json の依存が allowlist.json にある
//   gate(tsconfig)    どの tsconfig も base を継承し、厳格系オプションを false にしない
//   gate(lint-config) lint / フォーマット設定は締める方向にしか変えない
//   gate(scripts)     verify と各パッケージの check-types から検査を外さない
//   gate(codeowners)  protected.mjs のゲートファイルがすべて CODEOWNERS の対象
// 先に fixtures/gate/ の違反例・正しい例で各検査が効いていることを確かめ、検査自体が骨抜きにされていないことを保証する。
// 使い方: bun packages/ai-profile/gate/check.mjs [--quiet]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { CODEOWNERS_PATH, findCodeownersGaps } from "./codeowners.mjs";
import { findUnlistedDeps, loadAllowlist } from "./deps.mjs";
import { findLooseLintConfig, isLintOrFormatConfig } from "./lint-config.mjs";
import { findWeakenedScripts } from "./scripts.mjs";
import { findWeakenedTsconfig } from "./tsconfig.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const fixtureDir = join(import.meta.dirname, "..", "fixtures", "gate");
const quiet = process.argv.includes("--quiet");

/** JSON / JSONC（コメント・末尾カンマ付き）を読む。 */
function parseJsonc(path, text) {
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  return error === undefined ? config : undefined;
}

// 追跡中と未追跡（.gitignore 対象外）のファイル。削除済みは除く。
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const files = listed.stdout
  .split("\0")
  .filter(
    (f) =>
      f.length > 0 &&
      existsSync(join(root, f)) &&
      !f.startsWith("packages/ai-profile/fixtures/gate/"),
  );

const tsconfigs = new Set(files.filter((f) => /(?:^|\/)tsconfig[^/]*\.json$/.test(f)));
const workspaceDirs = new Map(
  files
    .filter((f) => f.endsWith("package.json") && f !== "package.json")
    .map((f) => [JSON.parse(readFileSync(join(root, f), "utf8")).name, dirname(f)]),
);

/** extends の指定子をリポジトリ内の tsconfig のパスに解決する（解決できなければ undefined）。 */
function resolveExtends(from, spec) {
  let target;
  if (spec.startsWith(".")) {
    target = posix.normalize(posix.join(posix.dirname(from), spec));
  } else {
    const match = /^(@[^/]+\/[^/]+|[^@/][^/]*)\/(.+)$/.exec(spec);
    const dir = match === null ? undefined : workspaceDirs.get(match[1]);
    target = dir === undefined || match === null ? undefined : posix.join(dir, match[2]);
  }
  if (target !== undefined && !target.endsWith(".json")) {
    target = `${target}.json`;
  }
  return target !== undefined && tsconfigs.has(target) ? target : undefined;
}

const allow = loadAllowlist(root);
const CHECKS = {
  "gate(deps)": (path, text) => findUnlistedDeps(path, parseJsonc(path, text), allow),
  "gate(tsconfig)": (path, text) =>
    findWeakenedTsconfig(path, parseJsonc(path, text), resolveExtends),
  "gate(lint-config)": (path, text) =>
    findLooseLintConfig(path, path.endsWith(".json") ? parseJsonc(path, text) : undefined),
  "gate(scripts)": (path, text) => findWeakenedScripts(path, parseJsonc(path, text)),
  "gate(codeowners)": (_path, text) => findCodeownersGaps(text),
};

// --- 1. 検査自体が効いていることをフィクスチャで確かめる ---------------------------
// fixtures/gate/<rule>[.<name>].{invalid,valid}.<ext>。先頭のコメント行で検査対象を指定する:
//   // expect: gate(<rule>)   （# で始めてもよい）
//   // path: <リポジトリ内のパスとして扱う場所>
const fixtureFailures = [];
const fixtures = readdirSync(fixtureDir).filter((f) => /\.(?:invalid|valid)\.\w+$/.test(f));
for (const code of Object.keys(CHECKS)) {
  const rule = /\((.+)\)$/.exec(code)?.[1];
  for (const kind of ["invalid", "valid"]) {
    if (!fixtures.some((f) => f.startsWith(`${rule}.`) && f.includes(`.${kind}.`))) {
      fixtureFailures.push(
        `fixtures/gate: ${code} の ${kind} フィクスチャがない。\n` +
          `  直し方: packages/ai-profile/fixtures/gate/${rule}.${kind}.<ext> に違反例と正しい例の両方を置く。`,
      );
    }
  }
}
for (const name of fixtures.sort()) {
  const text = readFileSync(join(fixtureDir, name), "utf8");
  const header = (key) => new RegExp(`^(?://|#) ${key}: (\\S+)`, "m").exec(text)?.[1];
  const code = header("expect");
  const path = header("path");
  const check = code === undefined ? undefined : CHECKS[code];
  if (check === undefined || path === undefined) {
    fixtureFailures.push(
      `fixtures/gate/${name}: 先頭に "// expect: gate(<rule>)" と "// path: <path>" が必要。\n` +
        `  直し方: 違反例・正しい例の先頭に、期待する検査と、リポジトリ内のどのファイルとして扱うかを書く。`,
    );
    continue;
  }
  const found = check(path, text).filter((p) => p.code === code).length;
  const isValid = name.includes(".valid.");
  if (isValid ? found > 0 : found === 0) {
    fixtureFailures.push(
      `fixtures/gate/${name}: ${isValid ? `違反なしのはずが ${found} 件` : "違反ありのはずが 0 件"}（${code}）。\n` +
        `  直し方: packages/ai-profile/gate/ の ${code} の検査が外れていないか確認して戻す。ゲートの変更は人間の承認制。`,
    );
  }
}

// --- 2. リポジトリを検査する ---------------------------------------------------
const read = (f) => readFileSync(join(root, f), "utf8");
const problems = [
  ...files
    .filter((f) => f === "package.json" || f.endsWith("/package.json"))
    .flatMap((f) => [...CHECKS["gate(deps)"](f, read(f)), ...CHECKS["gate(scripts)"](f, read(f))]),
  ...[...tsconfigs].flatMap((f) => CHECKS["gate(tsconfig)"](f, read(f))),
  ...files.filter(isLintOrFormatConfig).flatMap((f) => CHECKS["gate(lint-config)"](f, read(f))),
  ...CHECKS["gate(codeowners)"](
    CODEOWNERS_PATH,
    existsSync(join(root, CODEOWNERS_PATH)) ? read(CODEOWNERS_PATH) : undefined,
  ),
];

const failures = [
  ...fixtureFailures,
  ...problems.map(
    (p) =>
      `${p.file}${p.where === undefined ? "" : ` (${p.where})`}: ${p.code} ${p.message}\n  直し方: ${p.hint}`,
  ),
];
if (failures.length > 0) {
  console.error(`gate check failed: ${failures.length} problem(s).\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
if (!quiet) {
  console.log(
    `gate check passed (${fixtures.length} fixtures, ${files.filter((f) => f.endsWith("package.json")).length} package.json, ${tsconfigs.size} tsconfig).`,
  );
}
