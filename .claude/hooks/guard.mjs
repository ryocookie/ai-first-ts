#!/usr/bin/env node
/**
 * guard — PreToolUse(Bash / Edit / Write / MultiEdit / NotebookEdit) hook
 *
 * 1. 既定スタックから外れる操作（Next.js / npm・pnpm・yarn / ESLint・Prettier・Biome）をブロック
 * 2. allowlist（packages/ai-profile/allowlist.json）にない依存の追加・実行をブロック（slopsquatting 対策）
 *    - `bun add <pkg>` の引数、`bunx <pkg>` / `bun create <x>` の実行対象
 *    - `bun install` / `bun add` / `bun update` の前に、全 package.json の依存を検査する
 *      （package.json を Edit で書き換えてから install する迂回を塞ぐ）
 * 3. ゲートファイル（packages/ai-profile/gate/protected.mjs）の編集は、人間の許可を求める（ask）
 *
 * exit 0 = 通す / exit 2 = ブロックし、stderr を Claude にフィードバック / JSON の ask = 人間に確認
 * ローカルの ~/.claude ではなくリポジトリに置くことで、クラウドスレッドにも適用される。
 * Bash の書き込み検出は経験則による。最終的な防御は CODEOWNERS と CI（gate/check.mjs）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const block = (reason) => {
  process.stderr.write(`[guard] ${reason}\n`);
  process.exit(2);
};
const ask = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `[guard] ${reason}`,
      },
    }),
  );
  process.exit(0);
};

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const tool = String(payload?.tool_name ?? "Bash");
const input = payload?.tool_input ?? {};
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const gateModule = async (name) => {
  try {
    return await import(pathToFileURL(join(projectDir, "packages/ai-profile/gate", name)).href);
  } catch {
    return undefined;
  }
};
const protectedModule = await gateModule("protected.mjs");
/** リポジトリルートからの相対パスに直す（リポジトリ外なら undefined）。 */
const toRepoPath = (p) => {
  const raw = String(p)
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\/?/, "");
  const rel = isAbsolute(raw) ? relative(projectDir, raw) : raw;
  return rel.startsWith("..") ? undefined : rel.split("\\").join("/").replace(/^\.\//, "");
};
const protectedReason = (p) => {
  const path = toRepoPath(p);
  if (path === undefined) return undefined;
  if (protectedModule === undefined) return "ゲート定義（gate/protected.mjs）を読めない";
  return protectedModule.protectedReason(path);
};
const protectedMessage = (path, reason) =>
  `${path} はゲートファイル（${reason}）です。AI が品質ゲートを弱められないよう、編集には人間の許可が要ります。` +
  "許可されていない変更なら実行せず、変更案と理由を報告して止まってください。";

// --- 0. Edit / Write 系: ゲートファイルなら人間に確認 ---------------------------
if (tool !== "Bash") {
  const target = input.file_path ?? input.notebook_path;
  if (target !== undefined) {
    const reason = protectedReason(target);
    if (reason !== undefined) ask(protectedMessage(toRepoPath(target), reason));
  }
  process.exit(0);
}

const command = String(input.command ?? "");
if (!command.trim()) process.exit(0);

// --- 1. スタック逸脱 -------------------------------------------------------
const forbidden = [
  [/\bcreate-next-app\b/, "Next.js は既定スタック外です。フロントは TanStack Start です。"],
  [
    /(^|[;&|]\s*|\s)(npm|pnpm|yarn)\s+(i|install|add|create|exec|dlx)\b/,
    "パッケージマネージャは bun のみです。bun add / bun install / bunx を使ってください。",
  ],
  [
    /\b(?:bun\s+(?:add|a|install|i)|bunx|bun\s+x)\b[^;&|]*\b(eslint|prettier|biome|ultracite|husky)\b/,
    "lint / format は oxlint / oxfmt、git hooks は lefthook に統一しています。",
  ],
];
for (const [re, reason] of forbidden) {
  if (re.test(command)) block(reason);
}

// --- 2. 依存追加・実行は allowlist のみ ------------------------------------
let allow;
try {
  allow = new Set(
    JSON.parse(readFileSync(join(projectDir, "packages/ai-profile/allowlist.json"), "utf8"))
      .packages,
  );
} catch {
  block(
    "packages/ai-profile/allowlist.json を読めません。依存追加は止めて人間に報告してください。",
  );
}
const SLOPSQUATTING =
  "存在しない・紛らわしい名前のパッケージを AI が提案する攻撃（slopsquatting）を防ぐため、" +
  "依存追加は人間の承認制です。実装を止め、パッケージ名・用途・npm 上の公開元・代替案を報告してください。";
// "@scope/name@1.2.3" -> "@scope/name", "name@^1" -> "name"
const packageName = (t) => (t.startsWith("@") ? "@" + t.slice(1).split("@")[0] : t.split("@")[0]);
const isAllowed = (p) => p.startsWith("@ai-first-ts/") || allow.has(p);

// コマンドチェーン（&&, ||, ;, |, 改行）を分割して各セグメントを検査
const segments = command.split(/&&|\|\||;|\||\n/);
// リダイレクト（2>&1・>/dev/null・< file）はパッケージ名ではないので取り除く
const withoutRedirects = (s) => s.replace(/\d*(?:>>?|<)&?\s*[^\s;&|]*/g, " ");
const words = (s) =>
  withoutRedirects(s)
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ""))
    .filter((t) => t.length > 0);
const firstArg = (s) => words(s).find((t) => !t.startsWith("-"));

let installs = false;
for (const segment of segments) {
  const add = segment.match(/\bbun\s+(?:add|a|install|i)\b(.*)$/);
  if (add) {
    installs = true;
    const denied = words(add[1])
      .filter((t) => !t.startsWith("-") && !t.startsWith("#"))
      .map(packageName)
      .filter((p) => !isAllowed(p));
    if (denied.length > 0) {
      block(`allowlist 外のパッケージです: ${denied.join(", ")}。${SLOPSQUATTING}`);
    }
  }
  if (/\bbun\s+(?:update|upgrade)\b/.test(segment)) installs = true;

  // bunx <pkg> / bun x <pkg> はパッケージを取得して実行する。ローカルの bin か allowlist のものだけ。
  const run = segment.match(/(?:^|\s)(?:bunx|bun\s+x)\s+(.*)$/);
  const runTarget = run ? firstArg(run[1]) : undefined;
  if (runTarget !== undefined) {
    const name = packageName(runTarget);
    if (!existsSync(join(projectDir, "node_modules/.bin", name)) && !isAllowed(name)) {
      block(`allowlist 外のパッケージを実行しようとしています: ${name}。${SLOPSQUATTING}`);
    }
  }
  // bun create <x> は create-<x> パッケージを取得して実行する。
  const create = segment.match(/\bbun\s+(?:create|c)\s+(.*)$/);
  const createTarget = create ? firstArg(create[1]) : undefined;
  if (createTarget !== undefined && !/^[./]/.test(createTarget)) {
    const name = createTarget.startsWith("@")
      ? createTarget.replace(/^(@[^/]+)\/?(.*)$/, (_m, s, n) => `${s}/create${n ? `-${n}` : ""}`)
      : `create-${packageName(createTarget)}`;
    if (!isAllowed(name)) {
      block(`allowlist 外のパッケージを実行しようとしています: ${name}。${SLOPSQUATTING}`);
    }
  }
}

// install 系は、package.json を直接書き換えた依存も入れてしまうため、全 package.json を検査する。
if (installs) {
  const deps = await gateModule("deps.mjs");
  if (deps === undefined) {
    block(
      "packages/ai-profile/gate/deps.mjs を読めません。install は止めて人間に報告してください。",
    );
  }
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  const files = listed.stdout
    .split("\n")
    .filter(
      (f) =>
        (f === "package.json" || f.endsWith("/package.json")) &&
        !f.startsWith("packages/ai-profile/fixtures/") &&
        existsSync(join(projectDir, f)),
    );
  const problems = deps.checkDeps(projectDir, files);
  if (problems.length > 0) {
    block(
      "package.json に allowlist 外の依存があるため install を止めました:\n" +
        problems.map((p) => `  ${p.file} (${p.where}): ${p.message}`).join("\n") +
        `\n${SLOPSQUATTING}`,
    );
  }
}

// --- 3. ゲートファイルへの書き込みは人間に確認 -----------------------------
const WRITERS =
  /^\s*(?:sudo\s+)?(?:sed\b.*\s-i|perl\b.*\s-[a-z]*i|tee\b|mv\b|cp\b|rm\b|rmdir\b|truncate\b|chmod\b|chown\b|ln\b|install\b|touch\b|dd\b|rsync\b|git\s+(?:checkout|restore|rm|mv|apply|am|cherry-pick|revert|stash|reset|clean)\b|(?:node|bun|python3?|perl|ruby|deno)\s+-[ec]\b)/;
for (const segment of segments) {
  const targets = [...segment.matchAll(/(?:^|[^<>&\d])\d*>>?\s*([^\s;&|<>]+)/g)].map((m) => m[1]);
  if (WRITERS.test(segment)) {
    targets.push(...words(segment).filter((t) => !t.startsWith("-")));
  }
  for (const t of targets) {
    if (t.startsWith("&")) continue;
    const reason = protectedReason(t);
    if (reason !== undefined) ask(protectedMessage(toRepoPath(t), reason));
  }
}

process.exit(0);
