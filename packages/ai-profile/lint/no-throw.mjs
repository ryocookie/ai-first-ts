// ai-profile(no-throw): TypeScript ソースの throw 文を禁止する。失敗は Result で返す。
// 例外は throw-boundaries.mjs に登録された境界での、フレームワーク指定の throw だけ。
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

  const diagnostics = [];
  const visit = (node) => {
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
