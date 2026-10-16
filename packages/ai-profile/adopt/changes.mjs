// 基準のブランチから変更したファイルを求める（verify の「変更したファイルは違反ゼロ」と gate(baseline) が使う）。
import { spawnSync } from "node:child_process";

const git = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

/**
 * 基準のブランチとの merge-base を求める。
 * 優先順: 引数 --base → CI の PR の基準（GITHUB_BASE_REF）→ origin/<baseBranch> → <baseBranch>。
 * @param {string} root
 * @param {{ base?: string | undefined, baseBranch: string }} options
 * @returns {{ mergeBase: string, ref: string } | { error: string }}
 */
export function resolveBase(root, { base, baseBranch }) {
  const prBase = process.env["GITHUB_BASE_REF"];
  const candidates =
    base !== undefined
      ? [base]
      : [
          ...(prBase !== undefined && prBase.length > 0 ? [`origin/${prBase}`] : []),
          `origin/${baseBranch}`,
          baseBranch,
        ];
  for (const ref of candidates) {
    if (git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
      continue;
    }
    const mergeBase = git(root, ["merge-base", "HEAD", ref]);
    if (mergeBase.status === 0) {
      return { mergeBase: mergeBase.stdout.trim(), ref };
    }
  }
  return {
    error:
      `基準のブランチ（${candidates.join(" / ")}）が見つからない。` +
      "CI では actions/checkout に fetch-depth: 0 を指定する。手元では git fetch origin で取得するか、--base <ref> を渡す。",
  };
}

/**
 * merge-base から変更・追加したファイル（コミット済み・未コミット・未追跡。削除は除く）。
 * @param {string} root
 * @param {string} mergeBase
 */
export function changedFiles(root, mergeBase) {
  const diff = git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=d",
    "-z",
    mergeBase,
  ]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return new Set(`${diff.stdout}\0${untracked.stdout}`.split("\0").filter((f) => f.length > 0));
}

/**
 * あるリビジョンのファイルの中身（なければ undefined）。
 * @param {string} root
 * @param {string} rev
 * @param {string} path
 */
export function showFile(root, rev, path) {
  const result = git(root, ["show", `${rev}:${path}`]);
  return result.status === 0 ? result.stdout : undefined;
}
