#!/usr/bin/env node
/**
 * guard — PreToolUse(Bash / Edit / Write / MultiEdit / NotebookEdit) hook
 *
 * 1. 既定スタックから外れる操作（Next.js / 決められた以外のパッケージマネージャ / ESLint・Prettier・Biome の追加）をブロック
 *    パッケージマネージャは bun。プロファイルを導入したリポジトリ（ai-profile.config.json）では、その packageManager。
 * 2. allowlist（packages/ai-profile/allowlist.json と、導入先では設定の dependencies）にない依存の追加・実行をブロック（slopsquatting 対策）
 *    - `bun add <pkg>`（npm install / pnpm add / yarn add）の引数、
 *      `bunx <pkg>`（npx / pnpm dlx / yarn dlx）と `bun create <x>`（npm create など）の実行対象
 *    - install / add / update の前に、全 package.json の依存を検査する
 *      （package.json を Edit で書き換えてから install する迂回を塞ぐ）
 * 3. ゲートファイル（packages/ai-profile/gate/protected.mjs）の編集は、人間の許可を求める（ask）
 *    ベースラインを作り直す（増やしうる）`adopt/verify.mjs --record-baseline` も人間の許可を求める
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
// パッケージマネージャごとの、依存を入れる（add / install）・更新する・パッケージを取得して実行する・create するコマンド。
// 各正規表現の (.*) は引数（パッケージ名やフラグ）。
const MANAGERS = {
  bun: {
    install: /\bbun\s+(?:add|a|install|i)\b(.*)$/,
    update: /\bbun\s+(?:update|upgrade)\b/,
    run: /(?:^|\s)(?:bunx|bun\s+x)\s+(.*)$/,
    create: /\bbun\s+(?:create|c)\s+(.*)$/,
  },
  npm: {
    install: /\bnpm\s+(?:install|i|in|add|ci|clean-install|install-test|it)\b(.*)$/,
    update: /\bnpm\s+(?:update|up|upgrade)\b/,
    run: /(?:^|\s)(?:npx|npm\s+(?:exec|x))\s+(.*)$/,
    create: /\bnpm\s+(?:create|init)\s+([^-\s].*)$/,
  },
  pnpm: {
    install: /\bpnpm\s+(?:add|install|i)\b(.*)$/,
    update: /\bpnpm\s+(?:update|up|upgrade)\b/,
    run: /(?:^|\s)(?:pnpx|pnpm\s+(?:dlx|exec))\s+(.*)$/,
    create: /\bpnpm\s+create\s+(.*)$/,
  },
  yarn: {
    install: /(?:\byarn\s+(?:add|install)\b(.*)$|^\s*yarn\s*$)/,
    update: /\byarn\s+(?:up|upgrade)\b/,
    run: /\byarn\s+(?:dlx|exec)\s+(.*)$/,
    create: /\byarn\s+create\s+(.*)$/,
  },
};
// プロファイルを導入したリポジトリでは、設定の packageManager を使う（読めなければ bun）。
let packageManager = "bun";
try {
  const configured = JSON.parse(
    readFileSync(join(projectDir, "ai-profile.config.json"), "utf8"),
  ).packageManager;
  if (Object.hasOwn(MANAGERS, configured)) packageManager = configured;
} catch {
  // 設定がない（プロファイルの開発元・テンプレートから作ったリポジトリ）なら bun。
}
const USAGE = {
  bun: "bun add / bun install / bunx",
  npm: "npm install / npm ci / npx",
  pnpm: "pnpm add / pnpm install / pnpm dlx",
  yarn: "yarn add / yarn install / yarn dlx",
};
if (/\bcreate-next-app\b/.test(command)) {
  block("Next.js は既定スタック外です。フロントは TanStack Start です。");
}

// --- 2. 依存追加・実行は allowlist のみ ------------------------------------
let allow;
try {
  allow = (await gateModule("deps.mjs")).loadAllowlist(projectDir);
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

// lint / format / git hooks は oxlint / oxfmt / lefthook に統一する（導入先で既に入っているものを実行するのは止めない）。
const OTHER_TOOLS = /^(?:eslint|prettier|biome|@biomejs\/biome|ultracite|husky)$/;
const STACK_TOOLS = "lint / format は oxlint / oxfmt、git hooks は lefthook に統一しています。";
const isLocalBin = (name) => existsSync(join(projectDir, "node_modules/.bin", name));

let installs = false;
for (const segment of segments) {
  // 決められた以外のパッケージマネージャ。bunx はプロファイルの実行に使うため、どのリポジトリでも下の検査付きで通す。
  for (const [manager, commands] of Object.entries(MANAGERS)) {
    if (manager === packageManager) continue;
    const kinds = manager === "bun" ? ["install", "update", "create"] : Object.keys(commands);
    if (kinds.some((kind) => commands[kind].test(segment))) {
      block(
        `パッケージマネージャは ${packageManager} のみです` +
          `${packageManager === "bun" ? "" : "（ai-profile.config.json の packageManager）"}。` +
          `${USAGE[packageManager]} を使ってください。`,
      );
    }
  }
  const commands = MANAGERS[packageManager];
  const add = segment.match(commands.install);
  if (add) {
    installs = true;
    const requested = words(add[1] ?? "")
      .filter((t) => !t.startsWith("-") && !t.startsWith("#"))
      .map(packageName);
    if (requested.some((p) => OTHER_TOOLS.test(p))) block(STACK_TOOLS);
    const denied = requested.filter((p) => !isAllowed(p));
    if (denied.length > 0) {
      block(`allowlist 外のパッケージです: ${denied.join(", ")}。${SLOPSQUATTING}`);
    }
  }
  if (commands.update.test(segment)) installs = true;

  // bunx <pkg>（npx・pnpm dlx・yarn dlx）はパッケージを取得して実行する。ローカルの bin か allowlist のものだけ。
  const run = segment.match(commands.run) ?? segment.match(MANAGERS.bun.run);
  const runTarget = run ? firstArg(run[1]) : undefined;
  if (runTarget !== undefined) {
    const name = packageName(runTarget);
    if (!isLocalBin(name) && OTHER_TOOLS.test(name)) block(STACK_TOOLS);
    if (!isLocalBin(name) && !isAllowed(name)) {
      block(`allowlist 外のパッケージを実行しようとしています: ${name}。${SLOPSQUATTING}`);
    }
  }
  // bun create <x>（npm create など）は create-<x> パッケージを取得して実行する。
  const create = segment.match(commands.create);
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
// ベースラインを作り直すと増えうる（--update-baseline は減らすだけなので通す）。
if (/\badopt\/verify\.mjs\b[^;&|]*--record-baseline\b/.test(command)) {
  ask(
    "ai-profile.baseline.json を今の違反で作り直します（増えうる）。層を有効にする時など人間が決めた場合だけ実行します。" +
      "違反を通すための実行なら止めて、コードを直してください。",
  );
}
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
