// tsc-hints が verify の型エラーに「直し方」を付けることを検証する:
// - *.invalid.ts は `// expect: TS<code>` のエラーで失敗し、そのコードに登録済みの直し方が表示される
//   （`// expect: TS<code> <id>` なら messageHints の <id> の直し方が表示される）
// - *.valid.ts だけをチェックすると tsc-hints が成功する
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hints, messageHints } from "../tsc-hints/hints.mjs";

const packageDir = join(import.meta.dirname, "..");
const fixtureDir = join(packageDir, "fixtures", "tsc-hints");
const bin = join(packageDir, "bin", "tsc-hints.mjs");

const runTscHints = (tsconfig) =>
  spawnSync(process.execPath, [bin, "-p", join(fixtureDir, tsconfig)], {
    cwd: packageDir,
    encoding: "utf8",
  });

const failures = [];

// --- 違反例: 失敗し、各エラーに直し方が付く ---------------------------------
const all = runTscHints("tsconfig.json");
const lines = all.stdout.split("\n");
if (all.status === 0) {
  failures.push(
    "違反例を含むチェックが成功した。\n" +
      "  直し方: bin/tsc-hints.mjs が tsc の終了コードをそのまま返しているか確認する。",
  );
}

const errorLines = lines.filter((line) => / error TS\d+: /.test(line));
const hintLines = lines.filter((line) => line.startsWith("  直し方 (TS"));
if (errorLines.length === 0 || errorLines.length !== hintLines.length) {
  failures.push(
    `型エラー ${errorLines.length} 件に対し直し方が ${hintLines.length} 件しか出ていない。\n` +
      "  直し方: tsc-hints/annotate.mjs のエラー行の検出（--pretty false 形式）を確認する。",
  );
}

for (const name of readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".ts"))
  .sort()) {
  const errorsInFile = errorLines.filter((line) => line.includes(name));

  if (name.endsWith(".valid.ts")) {
    if (errorsInFile.length > 0) {
      failures.push(
        `${name}: 正しい例でエラーが出た。\n${errorsInFile.join("\n")}\n` +
          "  直し方: 正しい例を現在の tsconfig.base.json で通る書き方に直す。",
      );
    }
    continue;
  }

  const header = /^\/\/ expect: TS(\d+)(?: ([\w-]+))?/.exec(
    readFileSync(join(fixtureDir, name), "utf8"),
  );
  if (!header) {
    failures.push(
      `${name}: 1行目に "// expect: TS<code>" が無い。\n  直し方: 期待するエラーコードを書く。`,
    );
    continue;
  }
  const code = Number(header[1]);
  if (!errorsInFile.some((line) => line.includes(`error TS${code}:`))) {
    failures.push(
      `${name}: TS${code} が出なかった。\n` +
        "  直し方: 違反例がそのエラーを確実に起こすように書き直す（tsconfig を緩めない）。",
    );
  }
  const messageHintId = header[2];
  if (messageHintId !== undefined) {
    const messageHint = messageHints.find(({ id }) => id === messageHintId);
    if (messageHint === undefined) {
      failures.push(
        `${name}: 直し方 ${messageHintId} が messageHints に無い。\n` +
          `  直し方: packages/ai-profile/tsc-hints/hints.mjs の messageHints に ${messageHintId} を追加する。`,
      );
    } else if (
      !hintLines.some((line) => line.startsWith(`  直し方 (TS${code}): ${messageHint.hint}`))
    ) {
      failures.push(
        `${name}: TS${code} に ${messageHintId} の直し方が表示されていない。\n` +
          "  直し方: messageHints の pattern がエラーメッセージ（詳細行を含む）に一致するか確認する。",
      );
    }
  } else if (hints[code] === undefined) {
    failures.push(
      `${name}: TS${code} の直し方が未登録。\n` +
        `  直し方: packages/ai-profile/tsc-hints/hints.mjs に TS${code} の直し方を追加する。`,
    );
  } else if (!hintLines.some((line) => line.startsWith(`  直し方 (TS${code}): ${hints[code]}`))) {
    failures.push(
      `${name}: TS${code} の直し方が出力に表示されていない。\n` +
        "  直し方: tsc-hints/annotate.mjs がエラー行の後ろに直し方を挿入しているか確認する。",
    );
  }
}

// --- 正しい例: 成功し、直し方は出ない -----------------------------------------
const valid = runTscHints("tsconfig.valid.json");
if (valid.status !== 0) {
  failures.push(
    `正しい例だけのチェックが失敗した。\n${valid.stdout}\n` +
      "  直し方: 正しい例を現在の tsconfig.base.json で通る書き方に直す。",
  );
}

if (failures.length > 0) {
  console.error(`tsc-hints fixtures failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`tsc-hints fixtures passed (${errorLines.length} errors annotated).`);
