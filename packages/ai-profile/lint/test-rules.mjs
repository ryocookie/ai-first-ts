// テストを骨抜きにする書き方を禁止する（bun:test を import するファイル＝テストファイルが対象）。
//   ai-profile(test-focus)     test.only / test.skip / test.todo / describe.skip / xit などでテストを外す
//   ai-profile(test-assertion) expect を呼ばないテスト、テストを1つも持たないテストファイル
//   ai-profile(test-only)      テスト専用モジュール（testing.ts）をテスト以外から import する
import { basename } from "node:path";
import ts from "typescript";
import { diagnostic, parseSource } from "./ast.mjs";

const BUN_TEST = "bun:test";
// テストを宣言する関数（bun:test の名前）。
const TEST_FUNCTIONS = new Set(["test", "it"]);
const SUITE_FUNCTIONS = new Set(["describe"]);
// 実行されない・結果が反転する・フォーカスで他を外す修飾。
const BANNED_MODIFIERS = new Set(["only", "skip", "todo", "if", "skipIf", "todoIf", "failing"]);
// 修飾済みの別名（xit = it.skip など）。
const BANNED_EXPORTS = new Set(["xit", "xtest", "xdescribe"]);

/** テスト専用モジュールの import 指定子（./testing・../testing・@scope/pkg/testing・…/testing.ts）。 */
const testingModule = /(?:^|\/)testing(?:\.[cm]?tsx?)?$/;

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 */
export function findTestViolations(filename, text) {
  const path = filename.split("\\").join("/");
  const source = parseSource(path, text);
  if (source === undefined) {
    return [];
  }
  const diagnostics = [];
  const report = (node, code, message) => diagnostics.push(diagnostic(source, node, code, message));

  // bun:test から取り込んだローカル名 → bun:test 側の名前。
  const bunNames = new Map();
  const testingImports = [];
  let importsBunTest = false;
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) {
      continue;
    }
    if (testingModule.test(specifier.text)) {
      testingImports.push(statement);
    }
    if (specifier.text !== BUN_TEST) {
      continue;
    }
    importsBunTest = true;
    const bindings = isImport ? statement.importClause?.namedBindings : statement.exportClause;
    if (bindings === undefined || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      // import * as t from "bun:test" では t.only などを名前で追えないため、名前付き import に限る。
      report(statement, "ai-profile(test-focus)", `Import named functions from "${BUN_TEST}".`);
      continue;
    }
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (BANNED_EXPORTS.has(name)) {
        report(element, "ai-profile(test-focus)", `\`${name}\` skips tests.`);
      }
      bunNames.set(element.name.text, name);
    }
  }

  const isTestModule = basename(path).replace(/\.[cm]?tsx?$/, "") === "testing";
  if (!importsBunTest && !isTestModule) {
    for (const statement of testingImports) {
      report(
        statement,
        "ai-profile(test-only)",
        "Test-only modules (testing.ts) may be imported only from test files.",
      );
    }
  }
  if (!importsBunTest) {
    return diagnostics;
  }

  /** callee が bun:test の関数（test / it / describe）か。修飾（test.each など）を含めて辿る。 */
  const rootName = (expression) => {
    let current = expression;
    while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
      current = current.expression;
    }
    return ts.isIdentifier(current) ? bunNames.get(current.text) : undefined;
  };
  const containsExpect = (node) => {
    let found = false;
    const visit = (child) => {
      if (found) {
        return;
      }
      if (ts.isCallExpression(child) && rootName(child.expression) === "expect") {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };

  // test(name, fn) / it(name, fn) / test.each(table)(name, fn)。test.each(table) 自体は宣言ではない。
  const isTestDeclaration = (node) => {
    if (!ts.isCallExpression(node)) {
      return false;
    }
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      return TEST_FUNCTIONS.has(bunNames.get(callee.text) ?? "");
    }
    return (
      ts.isCallExpression(callee) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.expression.name.text === "each" &&
      TEST_FUNCTIONS.has(rootName(callee.expression) ?? "")
    );
  };

  let tests = 0;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const root = rootName(node.expression);
      const isTestApi =
        root !== undefined && (TEST_FUNCTIONS.has(root) || SUITE_FUNCTIONS.has(root));
      if (isTestApi && BANNED_MODIFIERS.has(node.name.text)) {
        report(node, "ai-profile(test-focus)", `\`.${node.name.text}\` skips or focuses tests.`);
      }
    }
    if (isTestDeclaration(node)) {
      tests += 1;
      const body = node.arguments[1];
      if (body === undefined || !(ts.isArrowFunction(body) || ts.isFunctionExpression(body))) {
        report(
          node,
          "ai-profile(test-assertion)",
          "Pass the test body as an inline function so its assertions can be checked.",
        );
      } else if (!containsExpect(body)) {
        report(node, "ai-profile(test-assertion)", "This test never calls expect.");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (tests === 0) {
    report(
      source.statements[0] ?? source,
      "ai-profile(test-assertion)",
      "This test file has no tests.",
    );
  }
  return diagnostics;
}
