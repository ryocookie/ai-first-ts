// 独自検査が共有する構文木ユーティリティ。コメントや文字列に反応しないよう、正規表現ではなく構文木で判定する。
import ts from "typescript";

const tsFile = /\.[cm]?tsx?$/;

/** 検査対象の TypeScript ソースなら構文木を返す（.d.ts と TS 以外は undefined）。 */
export function parseSource(path, text) {
  if (!tsFile.test(path) || path.endsWith(".d.ts")) {
    return undefined;
  }
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

/** import { a as b } from "m" を「ローカル名 b → { module: m, name: a }」に変換する。 */
export function namedImports(source) {
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

/** import / re-export で module から取り込まれる名前（元の名前）と、その文。 */
export function importedNames(source) {
  const result = [];
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) {
      continue;
    }
    const bindings = isImport ? statement.importClause?.namedBindings : statement.exportClause;
    if (bindings === undefined || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      continue;
    }
    for (const element of bindings.elements) {
      result.push({
        module: specifier.text,
        name: (element.propertyName ?? element.name).text,
        node: element,
      });
    }
  }
  return result;
}

export function diagnostic(source, node, code, message) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    code,
    severity: "error",
    message,
    filename: source.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}
