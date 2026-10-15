// ai-profile(user-scope): データアクセスを必ずログイン中のユーザーに限定する。
// ユーザーが所有するデータへのアクセス手段は @ai-first-ts/ai-profile/db の UserScopedDb だけにし、
// 全てのクエリに `userId = <ログイン中のユーザー>` を付ける処理はそこに閉じ込める。
// そのため、境界（data-access-boundaries.mjs）以外では「生の DB に触れる入口」と「アクセサを作る userScoped」を禁止する。
// 生の DB を一切持たないコードは、スコープなしのクエリを書きようがない（認可が型で強制される）。
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { DATA_ACCESS_BOUNDARIES } from "./data-access-boundaries.mjs";
import { diagnostic, parseSource } from "./ast.mjs";

const CODE = "ai-profile(user-scope)";

// ワークスペース内のファイルを相対パスで import した場合も、パッケージ名と同じものとして扱う。
const WORKSPACE_MODULES = new Map([
  ["packages/db/src/index", "@ai-first-ts/db"],
  ["packages/ai-profile/db/index", "@ai-first-ts/ai-profile/db"],
  ["packages/ai-profile/db/user-scope", "@ai-first-ts/ai-profile/db"],
]);

/** import 指定子を、判定に使うモジュール名にそろえる。 */
function moduleId(path, specifier) {
  if (specifier === "@ai-first-ts/db/index") {
    return "@ai-first-ts/db";
  }
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const resolved = normalize(join(dirname(path), specifier))
    .split("\\")
    .join("/")
    .replace(/\.[cm]?tsx?$/, "");
  return WORKSPACE_MODULES.get(resolved) ?? WORKSPACE_MODULES.get(`${resolved}/index`) ?? specifier;
}

// 生の DB を持てる名前（module ごと）。"*" はそのモジュールからの import 全て。
const SQLITE_DATABASES = [
  "BaseSQLiteDatabase",
  "SQLiteAsyncDatabase",
  "SQLiteSyncDatabase",
  "SQLiteSession",
  "SQLiteTransaction",
];
function bannedNames(module) {
  if (module === "@ai-first-ts/db") {
    return { kind: "database", names: ["createDb", "Database"] };
  }
  if (module === "@ai-first-ts/ai-profile/db") {
    return { kind: "scope", names: ["userScoped"] };
  }
  if (module === "drizzle-orm/sqlite-core") {
    return { kind: "database", names: SQLITE_DATABASES };
  }
  // drizzle-orm のルート（演算子・sql・型）と sqlite-core（スキーマ定義）以外はドライバなど DB 接続そのもの。
  if (module.startsWith("drizzle-orm/")) {
    return { kind: "database", names: "*" };
  }
  return undefined;
}

// D1 バインディング（packages/infra/alchemy.run.ts の DB）。ENV.DB から直接 SQL を実行できてしまう。
const BINDING = "DB";

const MESSAGES = {
  database: (what) => `${what} gives raw database access that is not scoped to the signed-in user.`,
  scope: () => "userScoped must be created only from the authenticated session.",
};

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 */
export function findUnscopedDataAccess(filename, text) {
  const path = filename.split("\\").join("/");
  const source = parseSource(path, text);
  if (source === undefined) {
    return [];
  }
  const allowed = new Set(
    DATA_ACCESS_BOUNDARIES.filter((b) => b.files.test(path)).flatMap((b) => b.sources),
  );
  const diagnostics = [];
  const report = (node, kind, what) => {
    if (!allowed.has(kind)) {
      diagnostics.push(diagnostic(source, node, CODE, MESSAGES[kind](what)));
    }
  };

  // import / re-export（名前付き・名前空間・export *）。
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) {
      continue;
    }
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) {
      continue;
    }
    const module = moduleId(path, specifier.text);
    const banned = bannedNames(module);
    if (banned === undefined) {
      continue;
    }
    if (banned.names === "*") {
      report(statement, banned.kind, `"${specifier.text}"`);
      continue;
    }
    const bindings = isImport ? statement.importClause?.namedBindings : statement.exportClause;
    if (bindings !== undefined && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      for (const element of bindings.elements) {
        const name = (element.propertyName ?? element.name).text;
        if (banned.names.includes(name)) {
          report(element, banned.kind, `\`${name}\` from "${specifier.text}"`);
        }
      }
    } else if (bindings !== undefined || !isImport) {
      // import * as x / export * / export * as x は中身を名前で判定できないため、モジュールごと禁止する。
      report(statement, banned.kind, `\`*\` from "${specifier.text}"`);
    }
  }

  const visit = (node) => {
    // import("drizzle-orm/d1") などの動的 import。
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const banned = bannedNames(moduleId(path, node.arguments[0].text));
      if (banned !== undefined) {
        report(node, banned.kind, `import("${node.arguments[0].text}")`);
      }
    }
    // ENV.DB / env["DB"] / const { DB } = ENV。
    const bindingAccess =
      (ts.isPropertyAccessExpression(node) && node.name.text === BINDING) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === BINDING) ||
      (ts.isBindingElement(node) &&
        ((node.propertyName === undefined &&
          ts.isIdentifier(node.name) &&
          node.name.text === BINDING) ||
          (node.propertyName !== undefined &&
            (ts.isIdentifier(node.propertyName) || ts.isStringLiteralLike(node.propertyName)) &&
            node.propertyName.text === BINDING)));
    if (bindingAccess) {
      report(node, "database", `The D1 binding \`${BINDING}\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return diagnostics;
}
