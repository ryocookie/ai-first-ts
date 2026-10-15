// gate(codeowners): protected.mjs のゲートファイルがすべて CODEOWNERS で所有者のレビュー対象になっていることを検査する。
// ゲートファイルを増やしたのに CODEOWNERS を更新し忘れると、その変更が人間の目を通らずにマージされうる。
import { PROTECTED_PATHS } from "./protected.mjs";

export const CODEOWNERS_PATH = ".github/CODEOWNERS";

const HINT =
  "packages/ai-profile/gate/protected.mjs の各 codeowners パターンを、所有者付きの行（例: `/.claude/ @ryocookie`）として .github/CODEOWNERS に書く。" +
  "CODEOWNERS の変更は人間の承認制なので、差分を提案として報告する。";

/** @param {string | undefined} text CODEOWNERS の内容（ないときは undefined） */
export function findCodeownersGaps(text) {
  if (text === undefined) {
    return [
      {
        code: "gate(codeowners)",
        file: CODEOWNERS_PATH,
        message: "CODEOWNERS がない。",
        hint: HINT,
      },
    ];
  }
  const lines = text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/));
  const owned = new Set(
    lines
      .filter((fields) => fields.length >= 2 && fields.slice(1).every((f) => f.startsWith("@")))
      .map((fields) => fields[0]),
  );
  const problems = PROTECTED_PATHS.filter((p) => !owned.has(p.codeowners)).map((p) => ({
    code: "gate(codeowners)",
    file: CODEOWNERS_PATH,
    message: `${p.codeowners}（${p.reason}）に所有者の行がない。`,
    hint: HINT,
  }));
  // CODEOWNERS は後の行が勝つため、所有者のない行は手前の行の所有を外せる。
  for (const fields of lines.filter((f) => f.length === 1)) {
    problems.push({
      code: "gate(codeowners)",
      file: CODEOWNERS_PATH,
      message: `${fields[0]} に所有者がない。所有者のない行は手前の行の所有を外す。`,
      hint: HINT,
    });
  }
  return problems;
}
