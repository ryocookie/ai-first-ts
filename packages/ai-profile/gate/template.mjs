// gate(template): テンプレートから作ったリポジトリで、CODEOWNERS の所有者がテンプレート元のまま残っていないことを検査する。
// GitHub は書き込み権限のない所有者を警告なしに無視するため、置き換え忘れるとゲートファイルの変更がレビューなしでマージできる。
import { spawnSync } from "node:child_process";

export const TEMPLATE_REPOSITORY = "ryocookie/ai-first-ts";
const TEMPLATE_OWNERS = ["@ryocookie"];

const HINT =
  "docs/template.md の「置き換える」に従い、.github/CODEOWNERS のテンプレート元の所有者を、" +
  "このリポジトリでゲートファイルをレビューする人かチーム（書き込み権限が必要）に置き換える。";

/**
 * 今のリポジトリの owner/name。CI では GITHUB_REPOSITORY、手元では origin の URL から読む。分からなければ undefined。
 * @param {string} root
 */
export function currentRepository(root) {
  const fromEnv = process.env["GITHUB_REPOSITORY"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.stdout.trim());
  return match?.[1];
}

/**
 * @param {string} path
 * @param {string | undefined} text CODEOWNERS の内容（ないときは undefined。gate(codeowners) が報告する）
 * @param {string | undefined} repository 今のリポジトリの owner/name（分からなければ検査しない）
 */
export function findTemplateLeftovers(path, text, repository) {
  if (
    text === undefined ||
    repository === undefined ||
    repository.toLowerCase() === TEMPLATE_REPOSITORY.toLowerCase()
  ) {
    return [];
  }
  const owners = new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .flatMap((line) => line.split(/\s+/).slice(1))
      .map((owner) => owner.toLowerCase()),
  );
  // テンプレート元の所有者が、このリポジトリの持ち主（owner/name の owner）でもあるなら書き込み権限があり、置き換え忘れではない。
  const repositoryOwner = `@${repository.split("/")[0] ?? ""}`.toLowerCase();
  return TEMPLATE_OWNERS.filter(
    (owner) => owners.has(owner.toLowerCase()) && owner.toLowerCase() !== repositoryOwner,
  ).map((owner) => ({
    code: "gate(template)",
    file: path,
    message: `所有者 ${owner} はテンプレート元（${TEMPLATE_REPOSITORY}）の所有者のまま。このリポジトリは ${repository}。`,
    hint: HINT,
  }));
}
