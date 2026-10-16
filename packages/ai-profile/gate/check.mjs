// ゲートの改ざん・迂回を検査する（verify と CI から実行。CI は verify とは別に直接実行する）。
//   gate(deps)        すべての package.json の依存が allowlist.json にある
//   gate(tsconfig)    どの tsconfig も base を継承し、厳格系オプションを false にしない
//   gate(lint-config) lint / フォーマット設定は締める方向にしか変えない
//   gate(scripts)     verify と各パッケージの check-types から検査を外さない
//   gate(codeowners)  protected.mjs のゲートファイルがすべて CODEOWNERS の対象
//   gate(template)    テンプレートから作ったリポジトリで、CODEOWNERS の所有者がテンプレート元のまま残っていない
// 導入モード（ai-profile.config.json があるリポジトリ。adopt/config.mjs）では、さらに次を検査する（gate/adoption.mjs）:
//   gate(adopt-config) 設定が正しく、プロファイル本体が導入時から変わっていない
//   gate(adopt-lint)   .oxlintrc.json がプロファイルの lint 設定と同じ
//   gate(baseline)     ベースラインが基準のブランチから増えていない（設定を変える PR を除く）
// 導入モードでは、プロファイル本体（packages/ai-profile/）は digest で検査し、基準の tsconfig は設定の tsconfig、
// verify の構成（gate(scripts)）は CI が直接実行するので検査しない。
// 先に fixtures/gate/ の違反例・正しい例で各検査が効いていることを確かめ、検査自体が骨抜きにされていないことを保証する。
// 使い方: bun packages/ai-profile/gate/check.mjs [--quiet]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { resolveBase, showFile } from "../adopt/changes.mjs";
import {
  ADOPTED_IGNORES,
  BASELINE_PATH,
  CONFIG_PATH,
  LINT_REFERENCE,
  PROFILE_DIR,
  REQUIRED_COMPILER_OPTIONS,
  loadAdoption,
  profileDigest,
} from "../adopt/config.mjs";
import {
  findBaselineProblems,
  findConfigProblems,
  findLintReferenceProblems,
} from "./adoption.mjs";
import { CODEOWNERS_PATH, findCodeownersGaps } from "./codeowners.mjs";
import { findUnlistedDeps, loadAllowlist } from "./deps.mjs";
import { findLooseLintConfig, isLintOrFormatConfig, isOxcConfig } from "./lint-config.mjs";
import { findWeakenedScripts } from "./scripts.mjs";
import { currentRepository, findTemplateLeftovers } from "./template.mjs";
import { BASE, findWeakenedTsconfig } from "./tsconfig.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const fixtureDir = join(import.meta.dirname, "..", "fixtures", "gate");
const quiet = process.argv.includes("--quiet");
// 導入モードかどうか（設定ファイルがなければ開発元のモードで、これまでどおりの検査だけを行う）。
const adoption = loadAdoption(root);
const adoptedConfig =
  adoption !== undefined && typeof adoption.config === "object" && adoption.config !== null
    ? adoption.config
    : {};
const adoptedBase = typeof adoptedConfig.tsconfig === "string" ? adoptedConfig.tsconfig : BASE;

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
      !f.startsWith("packages/ai-profile/fixtures/gate/") &&
      (adoption === undefined || !f.startsWith(`${PROFILE_DIR}/`)),
  );

const tsconfigs = new Set(files.filter((f) => /(?:^|\/)tsconfig[^/]*\.json$/.test(f)));
const workspaceDirs = new Map(
  files
    .filter((f) => f.endsWith("package.json") && f !== "package.json")
    .map((f) => [JSON.parse(readFileSync(join(root, f), "utf8")).name, dirname(f)]),
);

/**
 * extends の指定子をリポジトリ内の tsconfig のパスに解決する関数を作る（解決できなければ undefined を返す）。
 * @param {Set<string>} known リポジトリ内の tsconfig
 * @param {Map<string, string>} dirs ワークスペースのパッケージ名 → ディレクトリ
 */
const extendsResolver = (known, dirs) => (from, spec) => {
  let target;
  if (spec.startsWith(".")) {
    target = posix.normalize(posix.join(posix.dirname(from), spec));
  } else {
    const match = /^(@[^/]+\/[^/]+|[^@/][^/]*)\/(.+)$/.exec(spec);
    const dir = match === null ? undefined : dirs.get(match[1]);
    target = dir === undefined || match === null ? undefined : posix.join(dir, match[2]);
  }
  if (target !== undefined && !target.endsWith(".json")) {
    target = `${target}.json`;
  }
  return target !== undefined && known.has(target) ? target : undefined;
};
const resolveExtends = extendsResolver(tsconfigs, workspaceDirs);
// フィクスチャは開発元の構成（packages/config の tsconfig.base.json）を前提に書かれているため、導入先でもその構成として解決する。
const resolveFixtureExtends = extendsResolver(
  new Set([...tsconfigs, BASE]),
  new Map([...workspaceDirs, ["@ai-first-ts/config", "packages/config"]]),
);

const allow = loadAllowlist(root);
const repository = currentRepository(root);
// 各検査は (path, text, context) を受け取る。context はフィクスチャでは先頭のコメント行から、リポジトリの検査では実物から作る。
const CHECKS = {
  "gate(deps)": (path, text) => findUnlistedDeps(path, parseJsonc(path, text), allow),
  "gate(tsconfig)": (path, text, context) =>
    findWeakenedTsconfig(path, parseJsonc(path, text), context.resolve ?? resolveExtends, {
      base: context.base ?? (context.adopted === true ? adoptedBase : BASE),
      required: context.adopted === true ? REQUIRED_COMPILER_OPTIONS : [],
      ...(context.overriddenByBase?.get(path) === undefined
        ? {}
        : { overriddenByBase: context.overriddenByBase.get(path) }),
    }),
  "gate(lint-config)": (path, text, context) =>
    findLooseLintConfig(
      path,
      path.endsWith(".json") ? parseJsonc(path, text) : undefined,
      context.adopted === true
        ? { lintIgnores: ADOPTED_IGNORES, formatIgnores: ADOPTED_IGNORES }
        : {},
    ),
  "gate(scripts)": (path, text) => findWeakenedScripts(path, parseJsonc(path, text)),
  "gate(codeowners)": (_path, text) => findCodeownersGaps(text),
  "gate(template)": (path, text, context) =>
    findTemplateLeftovers(path, text, context.repo ?? repository),
  "gate(adopt-config)": (path, text, context) =>
    findConfigProblems(path, parseJsonc(path, text), context.digest),
  "gate(adopt-lint)": (path, text, context) =>
    findLintReferenceProblems(
      path,
      text === undefined ? undefined : parseJsonc(path, text),
      context.reference === undefined ? undefined : parseJsonc(LINT_REFERENCE, context.reference),
    ),
  "gate(baseline)": (path, text, context) =>
    findBaselineProblems(
      path,
      parseJsonc(path, text),
      context.previous === undefined ? undefined : parseJsonc(path, context.previous),
      context.configChanged === true,
    ),
};

// --- 1. 検査自体が効いていることをフィクスチャで確かめる ---------------------------
// fixtures/gate/<rule>[.<name>].{invalid,valid}.<ext>。先頭のコメント行で検査対象を指定する:
//   // expect: gate(<rule>)   （# で始めてもよい）
//   // path: <リポジトリ内のパスとして扱う場所>
//   // repo: <owner/name>    （任意。今のリポジトリとして扱う名前。gate(template) が使う）
//   // adopted: true         （任意。導入モードとして検査する）
//   // base: <path>          （任意。基準の tsconfig として扱うパス。gate(tsconfig) が使う）
//   // digest: <digest>      （任意。今のプロファイル本体の digest として扱う値。gate(adopt-config) が使う）
//   // reference: <file>     （任意。プロファイルの lint 設定として扱う fixtures/gate/ のファイル。gate(adopt-lint) が使う）
//   // previous: <file>      （任意。基準のブランチのベースラインとして扱う fixtures/gate/ のファイル。gate(baseline) が使う）
//   // config-changed: true  （任意。基準のブランチから設定を変えた PR として扱う。gate(baseline) が使う）
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
  const fixtureFile = (key) => {
    const file = header(key);
    return file === undefined ? undefined : readFileSync(join(fixtureDir, file), "utf8");
  };
  const context = {
    repo: header("repo"),
    adopted: header("adopted") === "true",
    base: header("base"),
    resolve: resolveFixtureExtends,
    digest: header("digest"),
    reference: fixtureFile("reference"),
    previous: fixtureFile("previous"),
    configChanged: header("config-changed") === "true",
    // overridden-by-base: <flag>,<flag>  （任意。base の extends の先として扱い、base が true にするオプション。gate(tsconfig) が使う）
    overriddenByBase:
      header("overridden-by-base") === undefined
        ? undefined
        : new Map([[path, new Set(String(header("overridden-by-base")).split(","))]]),
  };
  const found = check(path, text, context).filter((p) => p.code === code).length;
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
const readIfExists = (f) => (existsSync(join(root, f)) ? read(f) : undefined);
const adopted = adoption !== undefined;
/**
 * 導入モードで、基準の tsconfig が extends する先（アプリの tsconfig）と、基準の tsconfig が true にするオプション。
 * 基準の tsconfig をアプリの tsconfig を extends する検査用のファイルにすると、アプリのビルドは今の設定のまま、
 * 検査だけを厳格にできる。extends の先はアプリの設定なので、基準が上書きするオプションは false でもよい。
 */
function overriddenByBase() {
  const result = new Map();
  if (!adopted || !tsconfigs.has(adoptedBase)) {
    return result;
  }
  const baseConfig = parseJsonc(adoptedBase, read(adoptedBase));
  const baseOptions = isPlainObject(baseConfig?.compilerOptions) ? baseConfig.compilerOptions : {};
  const flags = new Set(Object.keys(baseOptions).filter((k) => baseOptions[k] === true));
  const queue = [adoptedBase];
  while (queue.length > 0) {
    const from = queue.shift() ?? "";
    const config = parseJsonc(from, read(from));
    for (const spec of [config?.extends].flat().filter((s) => typeof s === "string")) {
      const target = resolveExtends(from, spec);
      if (target !== undefined && target !== adoptedBase && !result.has(target)) {
        result.set(target, flags);
        queue.push(target);
      }
    }
  }
  return result;
}
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const context = { adopted, overriddenByBase: overriddenByBase() };
const problems = [
  ...files
    .filter((f) => f === "package.json" || f.endsWith("/package.json"))
    .flatMap((f) => [
      ...CHECKS["gate(deps)"](f, read(f), context),
      ...(adopted ? [] : CHECKS["gate(scripts)"](f, read(f), context)),
    ]),
  ...[...tsconfigs].flatMap((f) => CHECKS["gate(tsconfig)"](f, read(f), context)),
  ...files
    .filter(adopted ? isOxcConfig : isLintOrFormatConfig)
    .flatMap((f) => CHECKS["gate(lint-config)"](f, read(f), context)),
  ...[CHECKS["gate(codeowners)"], CHECKS["gate(template)"]].flatMap((check) =>
    check(CODEOWNERS_PATH, readIfExists(CODEOWNERS_PATH), context),
  ),
  ...(adopted ? adoptionProblems() : []),
];

/** 導入モードの検査（設定・プロファイル本体・lint 設定・ベースライン）。 */
function adoptionProblems() {
  const result = [
    ...CHECKS["gate(adopt-config)"](CONFIG_PATH, read(CONFIG_PATH), {
      digest: profileDigest(root),
    }),
    ...CHECKS["gate(adopt-lint)"](".oxlintrc.json", readIfExists(".oxlintrc.json"), {
      reference: readIfExists(LINT_REFERENCE),
    }),
  ];
  if (!tsconfigs.has(adoptedBase)) {
    result.push({
      code: "gate(tsconfig)",
      file: adoptedBase,
      message: `${CONFIG_PATH} の tsconfig（${adoptedBase}）がない。`,
      hint: "基準の tsconfig のパスを設定に書く（設定の変更は人間の承認制）。",
    });
  }
  const baseline = readIfExists(BASELINE_PATH);
  if (baseline === undefined) {
    // ベースラインがないことは verify が報告する（init はゲートを確かめてからベースラインを作る）。
    return result;
  }
  const baseBranch =
    typeof adoptedConfig.baseBranch === "string" ? adoptedConfig.baseBranch : "main";
  const resolved = resolveBase(root, { baseBranch });
  if ("error" in resolved) {
    if (process.env["CI"] === "true") {
      result.push({
        code: "gate(baseline)",
        file: BASELINE_PATH,
        message: resolved.error,
        hint: "基準のブランチと比べられないと、ベースラインが増えていないことを確かめられない。",
      });
    }
    return result;
  }
  const previousConfig = showFile(root, resolved.mergeBase, CONFIG_PATH);
  return [
    ...result,
    ...CHECKS["gate(baseline)"](BASELINE_PATH, baseline, {
      previous: showFile(root, resolved.mergeBase, BASELINE_PATH),
      configChanged: previousConfig !== undefined && previousConfig !== read(CONFIG_PATH),
    }),
  ];
}

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
