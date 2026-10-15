// ai-profile(test-required): ロジックを持つ層のファイルには、隣にテスト（<name>.test.ts）を必ず置く。
// AI が書いたコードを全行読まずに出すには、振る舞いがテストで固定されていることが前提になるため。
// 対象は値を export するファイル（関数・定数・クラス）で、型だけ・再 export だけのファイルとテスト専用の testing.ts は除く。
import { basename } from "node:path";
import ts from "typescript";
import { parseSource } from "../lint/ast.mjs";

export const CODE = "ai-profile(test-required)";

// テストを必須にする層。files はリポジトリルートからの相対パス（区切りは /）に対する正規表現。
// ここから外す・狭める変更はゲートの緩和にあたるため、変更せず提案として報告する（人間の承認制）。
export const TEST_REQUIRED_LAYERS = [
  {
    files: /^packages\/ai-profile\/(?:core|db)\//,
    reason: "プロファイルの Result・検証・データアクセス",
  },
  { files: /^packages\/api\/src\//, reason: "oRPC の手続き（認証・入力検証・エラーへの変換）" },
  { files: /(?:^|\/)domain\//, reason: "ドメイン層（純粋関数）" },
];

export const HINT =
  '隣に <name>.test.ts を作り、`import { describe, expect, test } from "bun:test"` で export した振る舞いを検証する' +
  "（成功・失敗の両方の分岐、Result の err の種類、他のユーザーのデータに触れないこと）。" +
  "DB を使う処理は `@ai-first-ts/ai-profile/db/testing` の memoryDatabase で実際の SQL を通す。" +
  "テストを書けない構造なら、依存を引数で受け取る形に分けてから書く。";

/** 値（実行時に存在するもの）を export しているか。型だけ・`export ... from` だけなら false。 */
function exportsValues(source) {
  const exported = (node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return source.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) {
      return true;
    }
    if (ts.isExportDeclaration(statement)) {
      return statement.moduleSpecifier === undefined && !statement.isTypeOnly;
    }
    return (
      exported(statement) &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isVariableStatement(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement))
    );
  });
}

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 * @param {(path: string) => boolean} exists リポジトリ内にそのパスのファイルがあるか
 */
export function findMissingTest(filename, text, exists) {
  const path = filename.split("\\").join("/");
  const match = /^(.*)\.([cm]?tsx?)$/.exec(path);
  if (
    match === null ||
    /\.(?:test|d)$/.test(match[1] ?? "") ||
    basename(match[1] ?? "") === "testing" ||
    !TEST_REQUIRED_LAYERS.some((layer) => layer.files.test(path))
  ) {
    return [];
  }
  const source = parseSource(path, text);
  if (source === undefined || !exportsValues(source)) {
    return [];
  }
  const candidates = ["ts", "tsx"].map((ext) => `${match[1]}.test.${ext}`);
  if (candidates.some(exists)) {
    return [];
  }
  return [
    {
      code: CODE,
      file: path,
      message: `${basename(path)} exports logic but has no test (${basename(candidates[0] ?? "")}).`,
    },
  ];
}
