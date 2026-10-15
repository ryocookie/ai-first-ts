// ai-profile(no-throw): TypeScript ソースの throw 文と Promise.reject(...) を禁止する。失敗は Result で返す。
// throw の例外は throw-boundaries.mjs に登録された境界での、フレームワーク指定の throw だけ。
// Promise.reject はテスト（*.test.ts）でだけ許す。失敗する依存のスタブに使うため。
import ts from "typescript";
import { diagnostic, namedImports, parseSource } from "./ast.mjs";
import { THROW_BOUNDARIES } from "./throw-boundaries.mjs";

/** `throw f(...)` / `throw new F(...)` の f / F（識別子のときだけ）。 */
function thrownCallee(expression) {
  const inner = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (
    (ts.isCallExpression(inner) || ts.isNewExpression(inner)) &&
    ts.isIdentifier(inner.expression)
  ) {
    return inner.expression.text;
  }
  return undefined;
}

const testFile = /\.test\.[cm]?tsx?$/;

/** `Promise.reject(...)`（括弧付き・`Promise["reject"]` を含む）。 */
const unwrap = (node) => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);

function isPromiseReject(node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = unwrap(node.expression);
  const name = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
      ? callee.argumentExpression.text
      : undefined;
  if (name !== "reject") {
    return false;
  }
  const target = unwrap(callee.expression);
  return ts.isIdentifier(target) && target.text === "Promise";
}

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 */
export function findThrows(filename, text) {
  const path = filename.split("\\").join("/");
  const source = parseSource(path, text);
  if (source === undefined) {
    return [];
  }
  const boundaries = THROW_BOUNDARIES.filter((b) => b.files.test(path));
  const imports = boundaries.length > 0 ? namedImports(source) : new Map();

  const allowReject = testFile.test(path);

  const diagnostics = [];
  const visit = (node) => {
    if (!allowReject && isPromiseReject(node)) {
      diagnostics.push(
        diagnostic(
          source,
          node,
          "ai-profile(no-throw)",
          "Promise.reject is not allowed. Return a Result (err) instead.",
        ),
      );
    }
    if (ts.isThrowStatement(node)) {
      const callee = thrownCallee(node.expression);
      const imported = callee === undefined ? undefined : imports.get(callee);
      const allowed = boundaries.some(
        (b) => imported !== undefined && imported.module === b.module && imported.name === b.name,
      );
      if (!allowed) {
        const permitted = boundaries.map((b) => `${b.name} (${b.module})`).join(", ");
        diagnostics.push(
          diagnostic(
            source,
            node,
            "ai-profile(no-throw)",
            boundaries.length > 0
              ? `Only throwing ${permitted} is allowed in this file.`
              : "throw is not allowed. Return a Result instead.",
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return diagnostics;
}
