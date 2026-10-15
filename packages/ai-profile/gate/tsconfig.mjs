// gate(tsconfig): どの tsconfig も厳格度を下げられないようにする。
// packages/config/tsconfig.base.json の厳格さはフィクスチャ（packages/config/fixtures/strictness）が保証するが、
// 各パッケージの tsconfig が extends をやめたり、compilerOptions で個別に false へ戻したりすると素通りする。

const BASE = "packages/config/tsconfig.base.json";

// true が厳しい側のオプション。base 以外で false にすることを禁止する。
export const STRICT_FLAGS = [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictPropertyInitialization",
  "noImplicitThis",
  "alwaysStrict",
  "useUnknownInCatchVariables",
  "noUncheckedIndexedAccess",
  "noUnusedLocals",
  "noUnusedParameters",
  "noFallthroughCasesInSwitch",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noPropertyAccessFromIndexSignature",
  "isolatedModules",
  "verbatimModuleSyntax",
  "forceConsistentCasingInFileNames",
];

// true にすると型チェックを弱めるオプション。
const LOOSENING_FLAGS = ["suppressImplicitAnyIndexErrors", "suppressExcessPropertyErrors"];

const HINT =
  "厳格度を下げずに型エラーそのものを直す。tsconfig は packages/config/tsconfig.base.json を（直接か、それを extends する tsconfig 経由で）extends し、" +
  "厳格系オプションを個別に false にしない。緩める必要があると判断したら、実装を止めて理由を報告する（人間の承認制）。";

/**
 * @param {string} path リポジトリルートからの相対パス
 * @param {unknown} config tsconfig の内容（コメント除去済み）
 * @param {(from: string, spec: string) => string | undefined} resolveExtends extends をリポジトリ内の tsconfig のパスに解決する
 */
export function findWeakenedTsconfig(path, config, resolveExtends) {
  const problems = [];
  const report = (message) =>
    problems.push({ code: "gate(tsconfig)", file: path, message, hint: HINT });
  const record = typeof config === "object" && config !== null ? config : {};
  const options =
    typeof record.compilerOptions === "object" && record.compilerOptions !== null
      ? record.compilerOptions
      : {};

  if (path !== BASE) {
    const specs = [record.extends].flat().filter((s) => typeof s === "string");
    if (specs.length === 0) {
      report(`extends がない。${BASE} の厳格設定を継承していない。`);
    }
    for (const spec of specs) {
      if (resolveExtends(path, spec) === undefined) {
        report(`extends "${spec}" がリポジトリ内の tsconfig を指していない。`);
      }
    }
  }
  for (const flag of STRICT_FLAGS) {
    if (options[flag] === false) {
      report(`compilerOptions.${flag} を false にしている。`);
    }
  }
  for (const flag of LOOSENING_FLAGS) {
    if (options[flag] === true) {
      report(`compilerOptions.${flag} を true にしている。`);
    }
  }
  return problems;
}
