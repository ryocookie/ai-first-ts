// gate(lint-config): lint とフォーマットの設定は締める方向にしか変えられないようにする。
// 禁止ルールそのもの（any・as など）は lint/check-fixtures.mjs が検査するが、
// 対象外にする（ignorePatterns・入れ子の設定ファイル）・overrides で切る・カテゴリを warn に落とす変更はそこを素通りする。

const ROOT_LINT_CONFIG = ".oxlintrc.json";
const ROOT_FORMAT_CONFIG = ".oxfmtrc.json";
// 検査の対象外にしてよいパス。フィクスチャは違反例を含むため、検査スクリプトが別の設定で lint する。
export const ALLOWED_LINT_IGNORES = ["packages/ai-profile/fixtures/**"];

const LINT_CONFIG_FILE =
  /(?:^|\/)(?:\.oxlintrc(?:\.\w+)?|oxlint\.config\.\w+|\.eslintrc(?:\.\w+)?|eslint\.config\.\w+)$/;
const FORMAT_CONFIG_FILE =
  /(?:^|\/)(?:\.oxfmtrc(?:\.\w+)?|oxfmt\.config\.\w+|\.prettierrc(?:\.\w+)?|prettier\.config\.\w+)$/;

const HINT =
  "lint・フォーマットの設定はルートの .oxlintrc.json / .oxfmtrc.json だけに置き、対象外の追加・ルールの off / warn 化・カテゴリの緩和をしない。" +
  "指摘されたコードの側を直す。ルール自体が誤っていると判断したら、実装を止めて変更案を報告する（人間の承認制）。";

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const loosened = (setting) => {
  const level = Array.isArray(setting) ? setting[0] : setting;
  return level !== "error" && level !== "deny" && level !== 2;
};

/** @param {string} path リポジトリルートからの相対パス */
export function isLintOrFormatConfig(path) {
  return LINT_CONFIG_FILE.test(path) || FORMAT_CONFIG_FILE.test(path);
}

// oxlint / oxfmt の設定ファイル。導入モードでは、移行中の ESLint・Prettier の設定は残してよい（oxlint / oxfmt の検査を緩められない）ため、これだけを見る。
const OXC_CONFIG_FILE =
  /(?:^|\/)(?:\.oxlintrc(?:\.\w+)?|oxlint\.config\.\w+|\.oxfmtrc(?:\.\w+)?|oxfmt\.config\.\w+)$/;

/** @param {string} path リポジトリルートからの相対パス */
export function isOxcConfig(path) {
  return OXC_CONFIG_FILE.test(path);
}

/**
 * @param {string} path リポジトリルートからの相対パス
 * @param {unknown} config 設定ファイルの内容（JSON のとき。それ以外は undefined）
 * @param {{ lintIgnores?: readonly string[], formatIgnores?: readonly string[] }} [allowed]
 *   対象外にしてよいパス。導入モードでは、開発元で検査済みのプロファイル本体（packages/ai-profile/**）を対象外にできる。
 */
export function findLooseLintConfig(path, config, allowed = {}) {
  const lintIgnores = allowed.lintIgnores ?? ALLOWED_LINT_IGNORES;
  const formatIgnores = allowed.formatIgnores ?? [];
  const problems = [];
  const report = (message) =>
    problems.push({ code: "gate(lint-config)", file: path, message, hint: HINT });

  if (path !== ROOT_LINT_CONFIG && path !== ROOT_FORMAT_CONFIG) {
    if (isLintOrFormatConfig(path)) {
      report(
        "ルート以外の lint / フォーマット設定ファイルは置けない（入れ子の設定がルートのルールを上書きする）。",
      );
    }
    return problems;
  }
  const record = isRecord(config) ? config : {};
  const ignores = Array.isArray(record.ignorePatterns) ? record.ignorePatterns : [];

  if (path === ROOT_FORMAT_CONFIG) {
    for (const pattern of ignores.filter((p) => !formatIgnores.includes(p))) {
      report(`ignorePatterns に "${pattern}" がある。フォーマット検査の対象外は作れない。`);
    }
    return problems;
  }
  for (const pattern of ignores) {
    if (!lintIgnores.includes(pattern)) {
      report(
        `ignorePatterns に "${pattern}" がある。lint の対象外にできるのは ${lintIgnores.join(", ")} だけ。`,
      );
    }
  }
  const categories = isRecord(record.categories) ? record.categories : {};
  if (categories.correctness !== "error") {
    report(`categories.correctness が "error" でない。`);
  }
  for (const [category, level] of Object.entries(categories)) {
    if (category !== "correctness" && loosened(level)) {
      report(
        `categories.${category} を "${level}" にしている。カテゴリは "error" でだけ追加できる。`,
      );
    }
  }
  const ruleSets = [
    ["rules", record.rules],
    ...(Array.isArray(record.overrides) ? record.overrides : []).map((o, i) => [
      `overrides[${i}].rules`,
      isRecord(o) ? o.rules : undefined,
    ]),
  ];
  for (const [where, rules] of ruleSets) {
    if (isRecord(rules)) {
      for (const [rule, setting] of Object.entries(rules)) {
        if (loosened(setting)) {
          report(
            `${where} で ${rule} を ${JSON.stringify(setting)} にしている。ルールは "error" でだけ追加できる。`,
          );
        }
      }
    }
  }
  return problems;
}
