// Verifies that tsconfig.base.json still enforces each strictness rule:
// every *.invalid.ts fixture must fail with the TS code named in its `// expect:` header,
// and every *.valid.ts fixture must type-check cleanly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const fixtureDir = join(import.meta.dirname, "..", "fixtures", "strictness");
const configPath = join(fixtureDir, "tsconfig.json");

const { config, error } = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
if (error) {
  console.error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, fixtureDir);
const program = ts.createProgram(parsed.fileNames, parsed.options);

const codesByFile = new Map();
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  const fileName = diagnostic.file?.fileName ?? "(global)";
  const codes = codesByFile.get(fileName) ?? [];
  codes.push(diagnostic.code);
  codesByFile.set(fileName, codes);
}

const failures = [];
for (const name of readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".ts"))
  .sort()) {
  const fileName = join(fixtureDir, name);
  const codes = codesByFile.get(fileName) ?? [];
  codesByFile.delete(fileName);

  if (name.endsWith(".valid.ts")) {
    if (codes.length > 0) {
      failures.push(
        `${name}: expected no errors, got TS${codes.join(", TS")}.\n` +
          `  直し方: 正しい例が通らなくなった。tsconfig.base.json の変更を見直すか、` +
          `ルールの意図どおりにフィクスチャを更新する。`,
      );
    }
    continue;
  }

  const header = /^\/\/ expect: TS(\d+) \((\w+)\)/.exec(readFileSync(fileName, "utf8"));
  if (!header) {
    failures.push(
      `${name}: missing "// expect: TS<code> (<option>)" header.\n` +
        `  直し方: 違反例の1行目に期待する TS エラーコードとオプション名を書く。`,
    );
    continue;
  }
  const [, code, option] = header;
  if (!codes.includes(Number(code))) {
    const got = codes.length > 0 ? `TS${codes.join(", TS")}` : "no errors";
    failures.push(
      `${name}: expected TS${code} but got ${got}.\n` +
        `  直し方: packages/config/tsconfig.base.json で "${option}": true に戻す。` +
        `緩める場合は人間の承認が必要。`,
    );
  }
}

for (const [fileName, codes] of codesByFile) {
  failures.push(`${fileName}: unexpected errors TS${codes.join(", TS")}.`);
}

if (failures.length > 0) {
  console.error(`tsconfig strictness fixtures failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`tsconfig strictness fixtures passed (${parsed.fileNames.length} files).`);
