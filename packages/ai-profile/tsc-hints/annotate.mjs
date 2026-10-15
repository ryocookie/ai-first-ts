import { hintFor } from "./hints.mjs";

// `file(line,col): error TS1234: message` / `error TS5083: message`（--pretty false の形式）
const errorLine = /(?:^|: )error TS(\d+): /;

/**
 * tsc の出力に、エラーごとの「直し方」行を差し込む。
 * エラー行に続くインデントされた行（詳細メッセージ）の後ろに付ける。
 * @param {string} output
 * @returns {{ text: string, codes: number[] }}
 */
export const annotate = (output) => {
  const lines = output.split("\n");
  /** @type {string[]} */
  const result = [];
  /** @type {number[]} */
  const codes = [];
  /** @type {number | undefined} */
  let pending;

  const flush = () => {
    if (pending === undefined) return;
    result.push(`  直し方 (TS${pending}): ${hintFor(pending)}`);
    pending = undefined;
  };

  for (const line of lines) {
    if (pending !== undefined && /^\s+\S/.test(line)) {
      result.push(line);
      continue;
    }
    flush();
    result.push(line);
    const match = errorLine.exec(line);
    if (match) {
      pending = Number(match[1]);
      codes.push(pending);
    }
  }
  flush();
  return { text: result.join("\n"), codes };
};
