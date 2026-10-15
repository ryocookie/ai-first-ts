// ai-profile(untrusted-input): 外部入力が Zod スキーマを通らずに型付きの値になる経路を禁止する。
// 外部入力は unknown として受け取れば、TypeScript が検証（絞り込み）前の利用を型エラーにする。
// したがって「unknown を経由しない入口」を塞げば、型付きの外部入力 = Zod で検証済み（Validated）になる。
// ai-profile(unsafe-sink): 検証済みでもエスケープを迂回する sink（sql.raw / dangerouslySetInnerHTML）を禁止する。
import ts from "typescript";
import { diagnostic, importedNames, namedImports, parseSource } from "./ast.mjs";
import { UNTRUSTED_BOUNDARIES } from "./untrusted-boundaries.mjs";

// 取り込むだけで未検証の値が型付きで手に入る import（module と元の名前）。
const UNTRUSTED_IMPORTS = [
  { module: "cloudflare:workers", name: "env", kind: "env" },
  { module: "hono/adapter", name: "env", kind: "env" },
  // oRPC の type<T>() はスキーマなしで入力に型を付ける（実行時検査のない型アサーション）。
  { module: "@orpc/server", name: "type", kind: "type" },
  { module: "@orpc/contract", name: "type", kind: "type" },
];

const isZod = (module) => module === "zod" || module.startsWith("zod/");
const isDrizzle = (module) => module === "drizzle-orm" || module.startsWith("drizzle-orm/");

/** `<x>.<name>` の x が import された `binding` か（例: z.any の z が zod の z）。 */
function isImportedObject(expression, imports, binding, module) {
  if (!ts.isIdentifier(expression)) {
    return false;
  }
  const imported = imports.get(expression.text);
  return imported !== undefined && imported.name === binding && module(imported.module);
}

/**
 * @param {string} filename リポジトリルートからの相対パス
 * @param {string} text ファイルの内容
 */
export function findUntrustedInput(filename, text) {
  const path = filename.split("\\").join("/");
  const source = parseSource(path, text);
  if (source === undefined) {
    return [];
  }
  const allowed = new Set(
    UNTRUSTED_BOUNDARIES.filter((b) => b.files.test(path)).flatMap((b) => b.sources),
  );
  const imports = namedImports(source);
  const diagnostics = [];
  const report = (node, code, message) => diagnostics.push(diagnostic(source, node, code, message));
  const untrusted = (node, kind, message) => {
    if (!allowed.has(kind)) {
      report(node, "ai-profile(untrusted-input)", message);
    }
  };

  for (const { module, name, node } of importedNames(source)) {
    const banned = UNTRUSTED_IMPORTS.find((i) => i.module === module && i.name === name);
    if (banned !== undefined) {
      untrusted(node, banned.kind, `\`${name}\` from "${module}" yields unvalidated input.`);
    }
  }

  const visit = (node) => {
    // process.env / import.meta.env / c.env（Hono）など、環境変数とバインディングの直接参照。
    if (ts.isPropertyAccessExpression(node) && node.name.text === "env") {
      untrusted(node, "env", "Environment variables must be read only in the env module.");
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      const method = callee.name.text;
      const object = callee.expression;

      // JSON.parse は any を返すため、検証なしで任意の型として使えてしまう。
      if (method === "parse" && ts.isIdentifier(object) && object.text === "JSON") {
        untrusted(node, "json", "JSON.parse returns unvalidated data typed as any.");
      }
      // Response / Request / Hono の body 読み取り `.json()` は any か呼び出し側が決めた型 <T> を返す。
      // 引数ありの `.json(data)`（Hono の c.json や Response.json）は書き出しなので対象外。
      if (method === "json" && (node.arguments.length === 0 || node.typeArguments !== undefined)) {
        untrusted(node, "json", "`.json()` returns an unvalidated body.");
      }
      // z.any() は検証しないスキーマ、引数なしの z.custom<T>() は検査関数のない型アサーション。
      if (isImportedObject(object, imports, "z", isZod)) {
        if (method === "any" || (method === "custom" && node.arguments.length === 0)) {
          untrusted(node, "zod", `z.${method}() accepts any input without validation.`);
        }
      }
      // sql.raw は値をエスケープせずに SQL へ埋め込む。
      if (method === "raw" && isImportedObject(object, imports, "sql", isDrizzle)) {
        report(
          node,
          "ai-profile(unsafe-sink)",
          "sql.raw embeds a string into SQL without escaping.",
        );
      }
    }

    // JSX 属性と createElement の props の両方で HTML の直接挿入を禁止する。
    const isHtmlProp =
      (ts.isJsxAttribute(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "dangerouslySetInnerHTML";
    if (isHtmlProp) {
      report(
        node,
        "ai-profile(unsafe-sink)",
        "dangerouslySetInnerHTML inserts HTML without escaping.",
      );
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return diagnostics;
}
