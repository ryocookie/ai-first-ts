// 導入先（ai-profile.config.json があるリポジトリ）の verify。
//   1. 違反を集める: 型エラー・lint（層ごとのルールは有効な層だけ）・フォーマット・テストの不足
//   2. ベースライン（ai-profile.baseline.json）と比べる: 増えた違反と、変更したファイルの違反を落とす
//   3. テストを実行する（config.test）
// ゲートの改ざん検査（gate/check.mjs）は CI が別に直接実行する。
// 使い方: bun packages/ai-profile/adopt/verify.mjs [--quick] [--base <ref>] [--update-baseline] [--record-baseline]
//   --quick            lint だけを検査する（ファイル編集ごとの hook 用）
//   --base <ref>       変更したファイルを求める基準（既定: CI の PR の基準 → origin/<baseBranch> → <baseBranch>）
//   --update-baseline  ベースラインを今の違反に合わせて減らす（増やさない）
//   --record-baseline  ベースラインを今の違反で作り直す（増えうる。導入時と、層を有効にする時に人間が実行する）
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareWithBaseline,
  countViolations,
  formatBaseline,
  parseBaseline,
  shrinkBaseline,
} from "./baseline.mjs";
import { changedFiles, resolveBase } from "./changes.mjs";
import {
  collectFormat,
  collectLint,
  collectMissingTests,
  collectTypeErrors,
  formatText,
  missingTools,
  repoFiles,
} from "./collect.mjs";
import { BASELINE_PATH, CONFIG_PATH, loadAdoption, validateConfig } from "./config.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const update = args.includes("--update-baseline");
const record = args.includes("--record-baseline");
const baseIndex = args.indexOf("--base");
const base = baseIndex === -1 ? undefined : args[baseIndex + 1];

const fail = (message) => {
  console.error(`ai-profile verify failed.\n\n${message}`);
  process.exit(1);
};

const adoption = loadAdoption(root);
if (adoption === undefined) {
  fail(
    `${CONFIG_PATH} がない。このスクリプトはプロファイルを導入したリポジトリ用。\n` +
      "  直し方: 導入するなら packages/ai-profile/adopt/init.mjs を実行する。プロファイルの開発元では bun run verify を使う。",
  );
}
const { config } = adoption;
const configProblems = validateConfig(config);
if (configProblems.length > 0) {
  fail(
    `${CONFIG_PATH} が正しくない:\n${configProblems.map((p) => `  - ${p}`).join("\n")}\n` +
      "  直し方: docs/adopt.md の設定の説明に従って直す（設定はゲートファイル。変更は人間の承認制）。",
  );
}
if (quick && record) {
  fail("--quick と --record-baseline は一緒に使えない。");
}
const missing = missingTools(root);
if (missing.length > 0) {
  fail(
    `検査に要るコマンドがない: ${missing.join(", ")}\n` +
      "  直し方: typescript・oxlint・oxlint-tsgolint・oxfmt を devDependencies に入れて install する（init が版を示す）。",
  );
}

// --- 1. 違反を集める ------------------------------------------------------------
const violations = [];
const fatal = [];
violations.push(...collectLint(root, config));
if (!quick) {
  const types = collectTypeErrors(root, config.typecheck);
  violations.push(...types.violations);
  fatal.push(...types.fatal);
  const format = collectFormat(root);
  violations.push(...format.violations);
  fatal.push(...format.fatal);
  violations.push(...collectMissingTests(root, repoFiles(root)));
}
if (fatal.length > 0) {
  fail(
    `${fatal.join("\n")}\n` +
      "  直し方: ファイルに結び付かないエラー（tsconfig の誤りなど）はベースラインにできない。設定を直してから再実行する。",
  );
}

const baselinePath = join(root, BASELINE_PATH);
if (record) {
  writeFileSync(
    baselinePath,
    formatText(root, BASELINE_PATH, formatBaseline(countViolations(violations))),
  );
  const files = new Set(violations.map((v) => v.file)).size;
  console.log(
    `${BASELINE_PATH} を作り直した（${files} ファイル・${violations.length} 件）。` +
      "増えた分は所有者のレビューを受ける（ゲートファイル）。",
  );
  process.exit(0);
}

// --- 2. ベースラインと比べる ------------------------------------------------------
if (!existsSync(baselinePath)) {
  fail(
    `${BASELINE_PATH} がない。\n` +
      "  直し方: 導入時に init が作る。作り直すなら人間が bun packages/ai-profile/adopt/verify.mjs --record-baseline を実行する。",
  );
}
let parsedBaseline;
try {
  parsedBaseline = parseBaseline(JSON.parse(readFileSync(baselinePath, "utf8")));
} catch {
  parsedBaseline = { counts: {}, problems: ["JSON として読めない。"] };
}
if (parsedBaseline.problems.length > 0) {
  fail(
    `${BASELINE_PATH} が正しくない:\n${parsedBaseline.problems.map((p) => `  - ${p}`).join("\n")}\n` +
      "  直し方: 手で書き換えた箇所を戻す。",
  );
}
// --quick は lint だけを集める。集めていないコード（型・フォーマット）は今 0 件として比べるので落ちない。
const baseline = parsedBaseline.counts;

const resolved = resolveBase(root, { base, baseBranch: config.baseBranch });
let touched;
if ("error" in resolved) {
  if (process.env["CI"] === "true" || base !== undefined) {
    fail(resolved.error);
  }
  console.error(
    `警告: ${resolved.error}\n未コミットの変更だけを「変更したファイル」として扱う。\n`,
  );
  touched = changedFiles(root, "HEAD");
} else {
  touched = changedFiles(root, resolved.mergeBase);
}

const { current, failing, shrinkable } = compareWithBaseline(baseline, violations, (file) =>
  touched.has(file),
);

if (update && !quick) {
  const next = shrinkBaseline(parsedBaseline.counts, current);
  const removed = shrinkable.reduce((sum, s) => sum + (s.from - s.to), 0);
  if (removed > 0) {
    writeFileSync(baselinePath, formatText(root, BASELINE_PATH, formatBaseline(next)));
    console.log(`${BASELINE_PATH} を ${removed} 件減らした。`);
  }
}

if (failing.length > 0) {
  const lines = failing.map((v) => {
    const why = touched.has(v.file)
      ? "変更したファイルは、ベースラインにある違反も含めて 0 件にする"
      : `ベースライン ${v.allowed} 件 → 今 ${v.count} 件`;
    return (
      `${v.file}:${v.line}:${v.column}: ${v.code} ${v.message}\n  （${why}）` +
      (v.hint === undefined ? "" : `\n  直し方: ${v.hint}`)
    );
  });
  fail(
    `${failing.length} 件の違反（変更したファイル ${touched.size} 件）。\n\n${lines.join("\n\n")}\n\n` +
      "ベースラインに足して通すのではなく、コードを直す。",
  );
}

// --- 3. テストを実行する ----------------------------------------------------------
if (!quick && config.test !== null) {
  const run = spawnSync(config.test, { cwd: root, stdio: "inherit", shell: true });
  if (run.status !== 0) {
    fail(
      `テスト（${config.test}）が失敗した。\n` +
        "  直し方: 失敗したテストの期待値と実際の値を読み、コードを直す。テストを消す・弱める・skip しない。",
    );
  }
}

const total = Object.values(parsedBaseline.counts).reduce(
  (sum, byCode) => sum + Object.values(byCode).reduce((a, b) => a + b, 0),
  0,
);
const left = shrinkable.reduce((sum, s) => sum + (s.from - s.to), 0);
if (!quick) {
  console.log(
    `ai-profile verify passed（変更したファイル ${touched.size} 件、ベースライン ${total} 件）。` +
      (left > 0 && !update
        ? `\nベースラインを ${left} 件減らせる: bun packages/ai-profile/adopt/verify.mjs --update-baseline`
        : ""),
  );
}
