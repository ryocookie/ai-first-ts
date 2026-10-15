#!/usr/bin/env node
// tsc のラッパー。引数をそのまま tsc に渡し、各エラーの直後に「直し方」を表示する。
// 終了コードは tsc と同じなので、verify の合否は変わらない。
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { annotate } from "../tsc-hints/annotate.mjs";

// 呼び出し元パッケージの typescript を使う（パッケージごとのバージョン解決に従う）
const tscPath = createRequire(join(process.cwd(), "package.json")).resolve("typescript/bin/tsc");

// 出力形式を固定する（pretty 形式だとエラー行を確実に拾えない）。後に書いた指定が優先される
const args = [tscPath, ...process.argv.slice(2), "--pretty", "false"];
const run = spawnSync(process.execPath, args, { encoding: "utf8" });

if (run.error) {
  console.error(`tsc-hints: tsc を起動できません: ${run.error.message}`);
  process.exit(1);
}

const { text, codes } = annotate(`${run.stdout}${run.stderr}`);
process.stdout.write(text);
if (codes.length > 0) {
  console.log(
    `\n型エラー ${codes.length} 件。各エラーの「直し方」に従って修正する。` +
      "`any` / `as` / `!` / `@ts-ignore` で黙らせない。",
  );
}
process.exit(run.status ?? 1);
