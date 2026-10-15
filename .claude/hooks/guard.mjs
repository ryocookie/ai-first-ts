#!/usr/bin/env node
/**
 * guard — PreToolUse(Bash) hook
 *
 * 1. 既定スタックから外れる操作（Next.js / npm・pnpm・yarn / ESLint・Prettier・Biome）をブロック
 * 2. allowlist（packages/ai-profile/allowlist.json）にない依存の追加をブロック（slopsquatting 対策）
 *
 * exit 0 = 通す / exit 2 = ブロックし、stderr を Claude にフィードバック
 * ローカルの ~/.claude ではなくリポジトリに置くことで、クラウドスレッドにも適用される。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const block = (reason) => {
  process.stderr.write(`[guard] ${reason}\n`);
  process.exit(2);
};

let command = "";
try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  command = String(payload?.tool_input?.command ?? "");
} catch {
  process.exit(0);
}
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

// --- 2. 依存追加は allowlist のみ -----------------------------------------
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
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

// コマンドチェーン（&&, ;, |）を分割して各セグメントを検査
for (const segment of command.split(/&&|\|\||;|\|/)) {
  const m = segment.match(/\bbun\s+(?:add|a|install|i)\b(.*)$/);
  if (!m) continue;

  const pkgs = m[1]
    .trim()
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-") && !t.startsWith("#"))
    .map((t) => t.replace(/^['"]|['"]$/g, ""))
    // "@scope/name@1.2.3" -> "@scope/name", "name@^1" -> "name"
    .map((t) => (t.startsWith("@") ? "@" + t.slice(1).split("@")[0] : t.split("@")[0]))
    .filter((p) => !p.startsWith("@ai-first-ts/"));

  const denied = pkgs.filter((p) => !allow.has(p));
  if (denied.length > 0) {
    block(
      `allowlist 外のパッケージです: ${denied.join(", ")}。` +
        "存在しない・紛らわしい名前のパッケージを AI が提案する攻撃（slopsquatting）を防ぐため、" +
        "依存追加は人間の承認制です。実装を止め、パッケージ名・用途・npm 上の公開元・代替案を報告してください。",
    );
  }
}

process.exit(0);
