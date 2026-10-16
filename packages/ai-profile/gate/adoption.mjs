// 導入モード（ai-profile.config.json があるリポジトリ）でだけ動くゲートの検査。
//   gate(adopt-config) 設定が正しく、プロファイル本体が導入時（profile.digest）から変わっていない
//   gate(adopt-lint)   .oxlintrc.json がプロファイルの lint 設定（導入時に写した oxlintrc.profile.json）と同じ
//   gate(baseline)     ベースラインが正しく、基準のブランチから増えていない（層を有効にする＝設定を変える PR だけ増やせる）
import { findGrowth, parseBaseline } from "../adopt/baseline.mjs";
import { LINT_REFERENCE, validateConfig } from "../adopt/config.mjs";

const CONFIG_HINT =
  "ai-profile.config.json は docs/adopt.md の説明どおりに書く。packages/ai-profile/ は手で変えず、プロファイルを更新するときは " +
  "開発元の init.mjs を --update で実行する（digest も更新される）。設定の変更は人間の承認制（ゲートファイル）。";
const LINT_HINT = `.oxlintrc.json を ${LINT_REFERENCE} と同じ内容に戻す。ルールの追加・緩和はプロファイルの開発元に提案する（人間の承認制）。`;
const BASELINE_HINT =
  "違反はコードを直して減らす。ベースラインを増やせるのは、層を有効にする（ai-profile.config.json の rules を変える）PR だけで、" +
  "人間が bun packages/ai-profile/adopt/verify.mjs --record-baseline を実行して作り直す。";

// 各検査は JSON を読んだ値を受け取る（読めなかったときは undefined）。
/**
 * @param {string} path
 * @param {unknown} config ai-profile.config.json の内容
 * @param {string | undefined} actualDigest 今のプロファイル本体の digest
 */
export function findConfigProblems(path, config, actualDigest) {
  const problems =
    config === undefined ? ["JSON として読めない。"] : validateConfig(config, { actualDigest });
  return problems.map((message) => ({
    code: "gate(adopt-config)",
    file: path,
    message,
    hint: CONFIG_HINT,
  }));
}

/** 比較のために、表記の違い（キーの順番・$schema・ignorePatterns の場所）を無視する。 */
const canonical = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== "$schema")
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
};

/**
 * @param {string} path
 * @param {unknown} actual .oxlintrc.json の内容（ないか読めないときは undefined）
 * @param {unknown} reference oxlintrc.profile.json の内容（同上）
 */
export function findLintReferenceProblems(path, actual, reference) {
  const report = (message) => [{ code: "gate(adopt-lint)", file: path, message, hint: LINT_HINT }];
  if (reference === undefined) {
    return report(`${LINT_REFERENCE} がない（読めない）。`);
  }
  if (actual === undefined) {
    return report(".oxlintrc.json がない（読めない）。");
  }
  const a = canonical(actual);
  const e = canonical(reference);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(e)])].sort();
  const differs = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(e[k]));
  return differs.length === 0
    ? []
    : report(`${differs.join("・")} がプロファイルの lint 設定と違う。`);
}

/**
 * @param {string} path
 * @param {unknown} baseline ai-profile.baseline.json の内容
 * @param {unknown} previous 基準のブランチのベースライン（ないときは undefined。導入する PR なので比べない）
 * @param {boolean} configChanged 基準のブランチから ai-profile.config.json を変えたか
 */
export function findBaselineProblems(path, baseline, previous, configChanged) {
  const report = (message) => ({
    code: "gate(baseline)",
    file: path,
    message,
    hint: BASELINE_HINT,
  });
  const current = parseBaseline(baseline);
  if (current.problems.length > 0) {
    return current.problems.map(report);
  }
  if (previous === undefined || configChanged) {
    return [];
  }
  const before = parseBaseline(previous);
  return findGrowth(current.counts, before.counts).map((g) =>
    report(`${g.file} の ${g.code} が ${g.from} 件から ${g.to} 件に増えている。`),
  );
}
