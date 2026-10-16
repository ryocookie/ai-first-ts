// 導入先の違反を集める: 型エラー（tsc）・lint（oxlint とプロファイル独自の検査）・フォーマット（oxfmt）・テストの不足。
// 違反は { file, code, line, column, message, hint } にそろえ、ベースラインと比べる（baseline.mjs）。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { HINTS } from "../lint/hints.mjs";
import { lint } from "../lint/oxlint.mjs";
import { HINT as TEST_HINT, findMissingTest } from "../test/required.mjs";
import { hintFor } from "../tsc-hints/hints.mjs";
import { CONFIG_PATH, GRADUAL_RULES, PROFILE_DIR, ruleApplies } from "./config.mjs";

const inProfile = (file) => file === PROFILE_DIR || file.startsWith(`${PROFILE_DIR}/`);
const toRepoPath = (root, file) => relative(root, resolve(root, file)).split("\\").join("/");

export const FORMAT_CODE = "oxfmt(format)";

/** 追跡中と未追跡（.gitignore 対象外）のファイル。削除済みとプロファイル本体は除く。 */
export function repoFiles(root) {
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return listed.stdout
    .split("\0")
    .filter((f) => f.length > 0 && !inProfile(f) && existsSync(join(root, f)));
}

const bin = (root, name) => join(root, "node_modules", ".bin", name);

/** 検査に要るコマンドが入っていなければ、その名前を返す。 */
export function missingTools(root) {
  return ["tsc", "oxlint", "tsgolint", "oxfmt"].filter((name) => !existsSync(bin(root, name)));
}

/**
 * tsc --noEmit -p <project> の型エラー。tsconfig 自体のエラーなど、ファイルに結び付かないものは fatal に入れる。
 * @param {string} root
 * @param {string[]} projects
 */
export function collectTypeErrors(root, projects) {
  const violations = [];
  const fatal = [];
  const seen = new Set();
  for (const project of projects) {
    const run = spawnSync(bin(root, "tsc"), ["--noEmit", "--pretty", "false", "-p", project], {
      cwd: root,
      encoding: "utf8",
    });
    const lines = `${run.stdout}${run.stderr}`.split("\n");
    let last;
    for (const line of lines) {
      const located = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
      const unlocated = /^error TS(\d+): (.*)$/.exec(line);
      if (located !== null) {
        const [, file = "", lineNo = "0", column = "0", code = "0", message = ""] = located;
        const v = {
          file: toRepoPath(root, file),
          code: `TS${code}`,
          line: Number(lineNo),
          column: Number(column),
          message,
          hint: undefined,
        };
        const key = `${v.file}:${v.line}:${v.column}:${v.code}`;
        last = seen.has(key) || inProfile(v.file) ? undefined : v;
        if (last !== undefined) {
          seen.add(key);
          violations.push(last);
        }
      } else if (unlocated !== null) {
        fatal.push(`${project}: error TS${unlocated[1]}: ${unlocated[2]}`);
        last = undefined;
      } else if (last !== undefined && /^\s+\S/.test(line)) {
        last.message += `\n${line}`;
      }
    }
    if (run.status !== 0 && run.error !== undefined) {
      fatal.push(`${project}: tsc を起動できない（${run.error.message}）。`);
    }
  }
  for (const v of violations) {
    v.hint = hintFor(Number(v.code.slice(2)), v.message);
  }
  return { violations, fatal };
}

/** 直し方。層ごとのルールでは、境界の足し方を導入先のもの（設定の except）にする。 */
function adoptedHint(code) {
  const hint = HINTS[code];
  const layer = Object.entries(GRADUAL_RULES).find(([, rule]) => rule.codes.includes(code))?.[0];
  return hint === undefined || layer === undefined
    ? hint
    : `${hint}（導入先では、lint/ の境界ファイルではなく ${CONFIG_PATH} の rules.${layer}.except に、ファイルと理由を足すよう提案する。人間の承認制）`;
}

/**
 * oxlint とプロファイル独自の検査。層ごとに有効にするルール（config.rules）は、その層のファイルだけを数える。
 * @param {string} root
 * @param {unknown} config
 */
export function collectLint(root, config) {
  return lint([])
    .filter((d) => d.severity === "error")
    .map((d) => ({
      file: toRepoPath(root, d.filename),
      code: d.code,
      line: d.line,
      column: d.column,
      message: d.message,
      hint: adoptedHint(d.code),
    }))
    .filter((v) => !inProfile(v.file) && ruleApplies(config, v.code, v.file));
}

/** oxfmt で整形すると変わるファイル（1 ファイル 1 件）。 */
export function collectFormat(root) {
  const run = spawnSync(bin(root, "oxfmt"), ["--list-different"], { cwd: root, encoding: "utf8" });
  const fatal = run.error === undefined ? [] : [`oxfmt を起動できない（${run.error.message}）。`];
  const violations = run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((file) => toRepoPath(root, file))
    .filter((file) => !inProfile(file) && existsSync(join(root, file)))
    .map((file) => ({
      file,
      code: FORMAT_CODE,
      line: 1,
      column: 1,
      message: "oxfmt で整形されていない。",
      hint: "`oxfmt --write <file>` で整形する（手で揃えない）。",
    }));
  return { violations, fatal };
}

/**
 * oxfmt で整形した中身を返す（oxfmt がなければそのまま）。init と verify が書き込むファイルを、導入先の format 検査で落ちない形にする。
 * @param {string} root oxfmt を探すリポジトリ
 * @param {string} path 拡張子で整形の方法を決めるためのパス
 * @param {string} text
 */
export function formatText(root, path, text) {
  if (!existsSync(bin(root, "oxfmt"))) {
    return text;
  }
  const run = spawnSync(bin(root, "oxfmt"), [`--stdin-filepath=${path}`], {
    cwd: root,
    input: text,
    encoding: "utf8",
  });
  return run.status === 0 && run.stdout.length > 0 ? run.stdout : text;
}

/** ロジックを持つ層（test/required.mjs）のファイルのテストの不足。 */
export function collectMissingTests(root, files) {
  const set = new Set(files);
  return files.flatMap((file) =>
    findMissingTest(file, readFileSync(join(root, file), "utf8"), (p) => set.has(p)).map((p) => ({
      file: p.file,
      code: p.code,
      line: 1,
      column: 1,
      message: p.message,
      hint: TEST_HINT,
    })),
  );
}
