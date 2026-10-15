// ai-profile(domain-purity): ドメイン層（domain-boundaries.mjs の DOMAIN_LAYERS）を純粋関数に保つ。
// 同じ入力に同じ出力を返し、外界に何も起こさないコードは、テストで振る舞いを固定でき、人間が全行を読まなくてよい。
// そのため、ドメイン層では次を禁止する:
//   - DOMAIN_IMPORTS 以外のモジュールの import / re-export / 動的 import / require（ドメイン層内の相対 import は可）
//   - I/O・実行環境・タイマー・乱数・現在時刻・動的評価のグローバル（fetch・console・process・Date.now・Math.random など）
//   - 非同期（async・await・Promise）。I/O は app 層で済ませ、結果を引数で渡す
//   - モジュールトップレベルの let / var（呼び出しをまたぐ可変状態）
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { diagnostic, parseSource } from "./ast.mjs";
import { DOMAIN_IMPORTS, DOMAIN_LAYERS } from "./domain-boundaries.mjs";

const CODE = "ai-profile(domain-purity)";

const testFile = /\.test\.[cm]?tsx?$/;

export const isDomainFile = (path) => DOMAIN_LAYERS.some((layer) => layer.files.test(path));

// 参照するだけで外界に触れる・結果が実行ごとに変わるグローバル。名前 → 分類。
const BANNED_GLOBALS = new Map([
  ...[
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "caches",
    "indexedDB",
    "localStorage",
    "sessionStorage",
    "document",
    "window",
    "navigator",
    "location",
    "history",
    "alert",
    "confirm",
    "prompt",
    "console",
  ].map((name) => [name, "I/O"]),
  ...["process", "Bun", "Deno", "globalThis", "self", "require", "module", "exports"].map(
    (name) => [name, "runtime environment"],
  ),
  ...["__dirname", "__filename"].map((name) => [name, "runtime environment"]),
  ...[
    "setTimeout",
    "setInterval",
    "setImmediate",
    "clearTimeout",
    "clearInterval",
    "clearImmediate",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
  ].map((name) => [name, "timer"]),
  ...["crypto", "performance"].map((name) => [name, "nondeterministic value"]),
  ...["eval", "Function"].map((name) => [name, "dynamic code"]),
  ["Promise", "async"],
]);

// 一部のメンバーだけが非決定的なグローバル。許すメンバー以外の使い方（別名への代入を含む）を禁止する。
const PURE_MEMBERS = new Map([
  ["Math", (member) => member !== "random"],
  ["Date", (member) => member === "UTC" || member === "parse"],
]);

/** node（またはその上）で name が宣言されていれば true（引数・変数・関数・クラス・import・catch）。 */
function declares(scope, name) {
  const bound = (binding) =>
    ts.isIdentifier(binding)
      ? binding.text === name
      : binding.elements.some((element) => !ts.isOmittedExpression(element) && bound(element.name));
  const declaredBy = (statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((d) => bound(d.name));
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      return statement.name?.text === name;
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      return (
        clause?.name?.text === name ||
        (bindings !== undefined &&
          (ts.isNamespaceImport(bindings)
            ? bindings.name.text === name
            : bindings.elements.some((e) => e.name.text === name)))
      );
    }
    return false;
  };
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) {
    return scope.statements.some(declaredBy);
  }
  if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return scope.statements.some(declaredBy);
  }
  if (ts.isFunctionLike(scope)) {
    const ownName =
      (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === name;
    return ownName || scope.parameters.some((p) => bound(p.name));
  }
  if (
    (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
    scope.initializer !== undefined &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    return scope.initializer.declarations.some((d) => bound(d.name));
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    return bound(scope.variableDeclaration.name);
  }
  return false;
}

/** 識別子が値の参照か（宣言名・プロパティ名・ラベルではない）。 */
function isReference(node) {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) {
    return parent.name === node;
  }
  if ("name" in parent && parent.name === node) {
    return false;
  }
  if ("propertyName" in parent && parent.propertyName === node) {
    return false;
  }
  if (ts.isQualifiedName(parent) || ts.isLabeledStatement(parent)) {
    return false;
  }
  return !(ts.isBreakOrContinueStatement(parent) && parent.label === node);
}

const isShadowed = (node, name) => {
  for (let scope = node.parent; scope !== undefined; scope = scope.parent) {
    if (declares(scope, name)) {
      return true;
    }
  }
  return false;
};

/** 相対 import の解決先がドメイン層か。 */
function resolvesToDomain(path, specifier) {
  const resolved = normalize(join(dirname(path), specifier))
    .split("\\")
    .join("/");
  return isDomainFile(resolved) || isDomainFile(`${resolved}/`);
}

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 */
export function findImpureDomainCode(filename, text) {
  const path = filename.split("\\").join("/");
  if (!isDomainFile(path)) {
    return [];
  }
  const source = parseSource(path, text);
  if (source === undefined) {
    return [];
  }
  const isTest = testFile.test(path);
  const diagnostics = [];
  const report = (node, message) => diagnostics.push(diagnostic(source, node, CODE, message));

  const checkModule = (node, specifier) => {
    const allowed = specifier.startsWith(".")
      ? resolvesToDomain(path, specifier)
      : DOMAIN_IMPORTS.some((m) => m.module === specifier && (m.tests !== true || isTest));
    if (!allowed) {
      report(node, `The domain layer must not depend on "${specifier}".`);
    }
  };

  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      checkModule(statement, statement.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      report(statement, "`import = require(...)` is not allowed in the domain layer.");
    }
    const scoping = ts.isVariableStatement(statement)
      ? statement.declarationList.flags & ts.NodeFlags.BlockScoped
      : undefined;
    if (scoping === ts.NodeFlags.Let || scoping === ts.NodeFlags.None) {
      report(statement, "Module-level `let` / `var` is mutable state shared across calls.");
    }
  }

  const visit = (node) => {
    // 型の位置（型注釈・typeof の型クエリ）は実行時に存在しない。extends 句の式は実行時の値なので見る。
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) {
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        checkModule(node, argument.text);
      } else {
        report(node, "Dynamic `import()` is not allowed in the domain layer.");
      }
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      report(node, "`import.meta` is runtime environment and not allowed in the domain layer.");
    }
    if (ts.isAwaitExpression(node)) {
      report(node, "`await` is not allowed in the domain layer. Do I/O in the app layer.");
    }
    if (
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      report(
        node,
        "`async` functions are not allowed in the domain layer. Do I/O in the app layer.",
      );
    }
    if (ts.isIdentifier(node) && isReference(node)) {
      checkGlobal(node);
    }
    ts.forEachChild(node, visit);
  };

  const checkGlobal = (node) => {
    const name = node.text;
    const category = BANNED_GLOBALS.get(name);
    const pureMember = PURE_MEMBERS.get(name);
    if ((category === undefined && pureMember === undefined) || isShadowed(node, name)) {
      return;
    }
    if (category !== undefined) {
      report(node, `\`${name}\` (${category}) is not allowed in the domain layer.`);
      return;
    }
    const parent = node.parent;
    const member =
      ts.isPropertyAccessExpression(parent) && parent.expression === node
        ? parent.name.text
        : undefined;
    // new Date(value) は値の変換なので許す。引数なしの new Date() と Date() は現在時刻。
    const dateFromValue =
      name === "Date" &&
      ts.isNewExpression(parent) &&
      parent.expression === node &&
      (parent.arguments?.length ?? 0) > 0;
    if (dateFromValue || (member !== undefined && pureMember?.(member))) {
      return;
    }
    const what =
      member !== undefined
        ? `${name}.${member}`
        : ts.isNewExpression(parent) && parent.expression === node
          ? `new ${name}()`
          : ts.isCallExpression(parent) && parent.expression === node
            ? `${name}()`
            : name;
    report(node, `\`${what}\` (nondeterministic value) is not allowed in the domain layer.`);
  };

  visit(source);
  return diagnostics;
}
