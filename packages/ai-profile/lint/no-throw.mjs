// ai-profile(no-throw): TypeScript ソースの throw 文を禁止する。失敗は Result で返す。
// 例外は throw-boundaries.mjs に登録された境界での、フレームワーク指定の throw だけ。
// コメントや文字列に反応しないよう、正規表現ではなく TypeScript の構文木で判定する。
import ts from "typescript";
import { THROW_BOUNDARIES } from "./throw-boundaries.mjs";

const tsFile = /\.[cm]?tsx?$/;

/** import { a as b } from "m" を「ローカル名 b → { module: m, name: a }」に変換する。 */
function namedImports(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    for (const element of bindings.elements) {
      imports.set(element.name.text, {
        module: statement.moduleSpecifier.text,
        name: (element.propertyName ?? element.name).text,
      });
    }
  }
  return imports;
}

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
  if (!tsFile.test(path) || path.endsWith(".d.ts")) {
    return [];
  }
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
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
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const permitted = boundaries.map((b) => `${b.name} (${b.module})`).join(", ");
        diagnostics.push({
          code: "ai-profile(no-throw)",
          severity: "error",
          message:
            boundaries.length > 0
              ? `Only throwing ${permitted} is allowed in this file.`
              : "throw is not allowed. Return a Result instead.",
          filename: path,
          line: position.line + 1,
          column: position.character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return diagnostics;
}
