// 既存リポジトリへの導入（adopt）の設定。導入先のルートに ai-profile.config.json があるリポジトリを「導入モード」として扱う。
// このリポジトリ（プロファイルの開発元）には設定ファイルがなく、全てのルールが全ファイルに掛かる。
// 設定ファイルを消すと全ルールが全ファイルに掛かる（厳しくなる）だけなので、消して緩めることはできない。
// 設定ファイルとベースラインはゲートファイル（gate/protected.mjs）で、変更には所有者のレビューが要る。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_PATH = "ai-profile.config.json";
export const BASELINE_PATH = "ai-profile.baseline.json";
// 導入先に置くプロファイルの場所。lint/oxlint.mjs などはこの深さからリポジトリルートを求めるため、開発元と同じ場所に置く。
export const PROFILE_DIR = "packages/ai-profile";
// 導入時に開発元の .oxlintrc.json を写したもの。導入先の .oxlintrc.json はこれと同じでなければならない。
export const LINT_REFERENCE = `${PROFILE_DIR}/oxlintrc.profile.json`;
// 導入先で lint・フォーマットの対象外にしてよいパス（プロファイル本体。開発元で検査済みで、digest で改変を検出する）。
export const ADOPTED_IGNORES = [`${PROFILE_DIR}/**`];

export const PACKAGE_MANAGERS = ["bun", "npm", "pnpm", "yarn"];

// 層ごとに有効にするルール。files に一致し except に一致しないファイルにだけ掛かる。
// それ以外のルール（any・as・!・ts-ignore・型・unsafe-sink・テスト・ドメイン層の純粋性）は導入初日から全ファイルに掛かる。
export const GRADUAL_RULES = {
  result: {
    codes: ["ai-profile(no-throw)"],
    summary: "throw を禁止し、失敗を Result で返す",
  },
  validation: {
    codes: ["ai-profile(untrusted-input)"],
    summary: "外部入力（JSON・env・リクエスト）を Zod で検証してから使う",
  },
  userScope: {
    codes: ["ai-profile(user-scope)"],
    summary: "データアクセスをログイン中のユーザーに限定する（Drizzle を使うリポジトリ向け）",
  },
};

// 導入先の基準の tsconfig が true にしていなければならないオプション（開発元の tsconfig.base.json の厳格系）。
// モジュール方式に関わるもの（verbatimModuleSyntax・isolatedModules）は既存のビルドを壊しうるため含めない。
export const REQUIRED_COMPILER_OPTIONS = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noPropertyAccessFromIndexSignature",
  "noFallthroughCasesInSwitch",
  "noUnusedLocals",
  "noUnusedParameters",
];

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");

/**
 * glob（`**`・`*`・`?`）をリポジトリルートからの相対パスに対する正規表現にする。
 * `src/domain/**` は src/domain 配下の全て、`src/*.ts` は src 直下の .ts に一致する。
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? "";
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      source += "[^/]*";
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

const matchesAny = (globs, path) => globs.some((g) => globToRegExp(g).test(path));

/**
 * 設定の中身を検査する（純粋関数）。
 * @param {unknown} config ai-profile.config.json の内容
 * @param {{ actualDigest?: string | undefined }} [options] actualDigest: 今のプロファイル本体の digest（比べないときは undefined）
 * @returns {string[]} 問題の説明
 */
export function validateConfig(config, options = {}) {
  const problems = [];
  if (!isRecord(config)) {
    return ["JSON のオブジェクトでない。"];
  }
  const profile = config.profile;
  if (
    !isRecord(profile) ||
    typeof profile.source !== "string" ||
    typeof profile.commit !== "string" ||
    typeof profile.digest !== "string"
  ) {
    problems.push("profile に source・commit・digest（文字列）がない。");
  } else if (options.actualDigest !== undefined && profile.digest !== options.actualDigest) {
    problems.push(
      `${PROFILE_DIR}/ の中身が導入時（profile.digest）と違う。プロファイル本体は手で変えない（今の digest: ${options.actualDigest}）。`,
    );
  }
  if (!PACKAGE_MANAGERS.includes(config.packageManager)) {
    problems.push(`packageManager が ${PACKAGE_MANAGERS.join(" / ")} のどれでもない。`);
  }
  if (typeof config.tsconfig !== "string") {
    problems.push("tsconfig（厳格系オプションを持つ基準の tsconfig のパス）がない。");
  }
  if (!isStringArray(config.typecheck) || config.typecheck.length === 0) {
    problems.push("typecheck（tsc --noEmit -p で検査する tsconfig のパス）が 1 つもない。");
  }
  if (config.test !== null && typeof config.test !== "string") {
    problems.push("test（テストを実行するコマンド。テストがなければ null）がない。");
  }
  if (typeof config.baseBranch !== "string" || config.baseBranch.length === 0) {
    problems.push("baseBranch（変更したファイルを求める基準のブランチ）がない。");
  }
  if (!isStringArray(config.dependencies)) {
    problems.push("dependencies（導入時からあった依存の名前）が文字列の配列でない。");
  }
  const rules = isRecord(config.rules) ? config.rules : undefined;
  if (rules === undefined) {
    problems.push(`rules がない（${Object.keys(GRADUAL_RULES).join("・")} を書く）。`);
  }
  for (const name of Object.keys(GRADUAL_RULES)) {
    const layer = rules?.[name];
    if (rules === undefined) {
      continue;
    }
    if (!isRecord(layer) || !isStringArray(layer.files) || !Array.isArray(layer.except)) {
      problems.push(`rules.${name} に files（glob の配列）と except（配列）がない。`);
      continue;
    }
    layer.except.forEach((e, i) => {
      if (!isRecord(e) || typeof e.files !== "string" || typeof e.reason !== "string") {
        problems.push(`rules.${name}.except[${i}] に files（glob）と reason（理由）がない。`);
      } else if (e.reason.trim().length === 0) {
        problems.push(`rules.${name}.except[${i}] の reason が空。例外には理由を書く。`);
      }
    });
  }
  for (const key of Object.keys(rules ?? {})) {
    if (!(key in GRADUAL_RULES)) {
      problems.push(`rules.${key} は層ごとに有効にできるルールではない。`);
    }
  }
  return problems;
}

/**
 * 導入モードかどうかと設定を読む。設定ファイルがなければ undefined（開発元のモード）。
 * @param {string} root
 */
export function loadAdoption(root) {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) {
    return undefined;
  }
  const text = readFileSync(path, "utf8");
  try {
    const config = JSON.parse(text);
    return { config, text };
  } catch {
    return { config: undefined, text };
  }
}

/**
 * 診断コードのルールが、このファイルに掛かるか。開発元のモード（config が undefined）では全て掛かる。
 * @param {unknown} config
 * @param {string} code 診断コード（例: ai-profile(no-throw)）
 * @param {string} path リポジトリルートからの相対パス
 */
export function ruleApplies(config, code, path) {
  if (!isRecord(config) || !isRecord(config.rules)) {
    return true;
  }
  for (const [name, rule] of Object.entries(GRADUAL_RULES)) {
    if (!rule.codes.includes(code)) {
      continue;
    }
    const layer = config.rules[name];
    if (!isRecord(layer) || !isStringArray(layer.files)) {
      return false;
    }
    const except = Array.isArray(layer.except)
      ? layer.except.filter(isRecord).map((e) => String(e.files))
      : [];
    return matchesAny(layer.files, path) && !matchesAny(except, path);
  }
  return true;
}

/** 導入先のプロファイル本体のファイル（リポジトリルートからの相対パス、ソート済み）。 */
export function profileFiles(root) {
  const result = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = `${dir}/${name}`;
      if (name === "node_modules" || name === "dist") {
        continue;
      }
      if (statSync(join(root, path)).isDirectory()) {
        walk(path);
      } else {
        result.push(path);
      }
    }
  };
  if (existsSync(join(root, PROFILE_DIR))) {
    walk(PROFILE_DIR);
  }
  return result;
}

/**
 * プロファイル本体の digest（パスと中身の sha256）。改行コードの違い（CRLF）は無視する。
 * @param {string} root
 */
export function profileDigest(root) {
  return digestOf(profileFiles(root).map((path) => [path, readFileSync(join(root, path), "utf8")]));
}

/**
 * @param {[string, string][]} entries パスと中身の組（init が書き込む前に期待値を求めるのにも使う）
 */
export function digestOf(entries) {
  const hash = createHash("sha256");
  for (const [path, content] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(`${path}\0`);
    hash.update(content.replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}
