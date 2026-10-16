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
 * 1 つのセッションで複数のリポジトリを扱う（プロファイルの開発元から導入先で作業する）ことがあるため、
 * 1・2 はコマンドを実行するディレクトリ（hook の cwd と `cd <dir>`）のリポジトリの設定で判定し、
 * 3 は編集するファイルのリポジトリのルートからの相対パスで判定する。
 * 判定に使うコード（gate/）はセッションのリポジトリ（CLAUDE_PROJECT_DIR）のものを使う。
 * 導入先の設定（ai-profile.config.json と allowlist.json）が揃っていないリポジトリは、セッションのリポジトリの設定で判定する（緩めない）。
 *
 * exit 0 = 通す / exit 2 = ブロックし、stderr を Claude にフィードバック / JSON の ask = 人間に確認
 * ローカルの ~/.claude ではなくリポジトリに置くことで、クラウドスレッドにも適用される。
 * Bash の書き込み先・実行ディレクトリの検出は経験則による。最終的な防御は CODEOWNERS と CI（gate/check.mjs）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const startDir = typeof payload?.cwd === "string" ? resolve(payload.cwd) : projectDir;

const gateModule = async (name) => {
  try {
    return await import(pathToFileURL(join(projectDir, "packages/ai-profile/gate", name)).href);
  } catch {
    return undefined;
  }
};
const protectedModule = await gateModule("protected.mjs");

/** dir を含む git リポジトリのルート（無ければ undefined）。dir 自体はまだ無くてもよい。 */
const gitRoot = (dir) => {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
};
/** コマンドの判定に使うリポジトリ: 導入先の設定が揃っていればそのリポジトリ、それ以外はセッションのリポジトリ。 */
const rulesRoot = (dir) => {
  const root = gitRoot(dir);
  if (
    root !== undefined &&
    existsSync(join(root, "ai-profile.config.json")) &&
    existsSync(join(root, "packages/ai-profile/allowlist.json"))
  ) {
    return root;
  }
  return projectDir;
};

/** パスを、それを含むリポジトリ（無ければセッションのリポジトリ）と、そのルートからの相対パスに直す。 */
const locate = (p, dir) => {
  const raw = String(p)
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?(?=\/|$)/, projectDir)
    .replace(/^~(?=\/|$)/, homedir());
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(dir, raw);
  const root = gitRoot(dirname(abs)) ?? projectDir;
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return { root, path: rel.split("\\").join("/") };
};
const protectedReason = (p, dir) => {
  const located = locate(p, dir);
  if (located === undefined) return undefined;
  if (protectedModule === undefined) {
    return { ...located, reason: "ゲート定義（gate/protected.mjs）を読めない" };
  }
  const reason = protectedModule.protectedReason(located.path);
  return reason === undefined ? undefined : { ...located, reason };
};
const protectedMessage = ({ root, path, reason }) =>
  `${root === projectDir ? path : join(root, path)} はゲートファイル（${reason}）です。` +
  "AI が品質ゲートを弱められないよう、編集には人間の許可が要ります。" +
  "許可されていない変更なら実行せず、変更案と理由を報告して止まってください。";

// --- 0. Edit / Write 系: ゲートファイルなら人間に確認 ---------------------------
if (tool !== "Bash") {
  const target = input.file_path ?? input.notebook_path;
  if (target !== undefined) {
    const found = protectedReason(target, startDir);
    if (found !== undefined) ask(protectedMessage(found));
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
const deps = await gateModule("deps.mjs");
const rulesCache = new Map();
/** リポジトリごとのパッケージマネージャと allowlist。 */
const rulesOf = (root) => {
  const cached = rulesCache.get(root);
  if (cached !== undefined) return cached;
  // プロファイルを導入したリポジトリでは、設定の packageManager を使う（読めなければ bun）。
  let packageManager = "bun";
  try {
    const configured = JSON.parse(
      readFileSync(join(root, "ai-profile.config.json"), "utf8"),
    ).packageManager;
    if (Object.hasOwn(MANAGERS, configured)) packageManager = configured;
  } catch {
    // 設定がない（プロファイルの開発元・テンプレートから作ったリポジトリ）なら bun。
  }
  let allow;
  try {
    allow = deps.loadAllowlist(root);
  } catch {
    block(
      `${join(root, "packages/ai-profile/allowlist.json")} を読めません。依存追加は止めて人間に報告してください。`,
    );
  }
  const rules = { root, packageManager, allow };
  rulesCache.set(root, rules);
  return rules;
};
const SLOPSQUATTING =
  "存在しない・紛らわしい名前のパッケージを AI が提案する攻撃（slopsquatting）を防ぐため、" +
  "依存追加は人間の承認制です。実装を止め、パッケージ名・用途・npm 上の公開元・代替案を報告してください。";
// "@scope/name@1.2.3" -> "@scope/name", "name@^1" -> "name"
const packageName = (t) => (t.startsWith("@") ? "@" + t.slice(1).split("@")[0] : t.split("@")[0]);

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

// 各セグメントを実行するディレクトリ。`cd <dir>` / `pushd <dir>` で後続のセグメントのディレクトリが変わる。
const dirs = [];
{
  let dir = startDir;
  for (const segment of segments) {
    const cd = segment.match(/^\s*\(?\s*(?:cd|pushd)\s+(\S+)\s*\)?\s*$/);
    if (cd) {
      const target = cd[1]
        .replace(/^['"]|['"]$/g, "")
        .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?(?=\/|$)/, projectDir)
        .replace(/^~(?=\/|$)/, homedir());
      dir = resolve(dir, target);
    }
    dirs.push(dir);
  }
}

// lint / format / git hooks は oxlint / oxfmt / lefthook に統一する（導入先で既に入っているものを実行するのは止めない）。
const OTHER_TOOLS = /^(?:eslint|prettier|biome|@biomejs\/biome|ultracite|husky)$/;
const STACK_TOOLS = "lint / format は oxlint / oxfmt、git hooks は lefthook に統一しています。";

if (deps === undefined) {
  block(
    "packages/ai-profile/gate/deps.mjs を読めません。依存の追加・実行は止めて人間に報告してください。",
  );
}
const installRoots = new Set();
segments.forEach((segment, i) => {
  const { root, packageManager, allow } = rulesOf(rulesRoot(dirs[i]));
  const isAllowed = (p) => p.startsWith("@ai-first-ts/") || allow.has(p);
  const isLocalBin = (name) => existsSync(join(root, "node_modules/.bin", name));
  const where = root === projectDir ? "" : `（${root}）`;
  // 決められた以外のパッケージマネージャ。bunx はプロファイルの実行に使うため、どのリポジトリでも下の検査付きで通す。
  for (const [manager, commands] of Object.entries(MANAGERS)) {
    if (manager === packageManager) continue;
    const kinds = manager === "bun" ? ["install", "update", "create"] : Object.keys(commands);
    if (kinds.some((kind) => commands[kind].test(segment))) {
      block(
        `パッケージマネージャは ${packageManager} のみです${where}` +
          `${packageManager === "bun" ? "" : "（ai-profile.config.json の packageManager）"}。` +
          `${USAGE[packageManager]} を使ってください。` +
          "別のリポジトリで実行するなら、`cd <そのリポジトリ> && <コマンド>` の形で実行してください。",
      );
    }
  }
  const commands = MANAGERS[packageManager];
  const add = segment.match(commands.install);
  if (add) {
    installRoots.add(root);
    const requested = words(add[1] ?? "")
      .filter((t) => !t.startsWith("-") && !t.startsWith("#"))
      .map(packageName);
    if (requested.some((p) => OTHER_TOOLS.test(p))) block(STACK_TOOLS);
    const denied = requested.filter((p) => !isAllowed(p));
    if (denied.length > 0) {
      block(`allowlist 外のパッケージです${where}: ${denied.join(", ")}。${SLOPSQUATTING}`);
    }
  }
  if (commands.update.test(segment)) installRoots.add(root);

  // bunx <pkg>（npx・pnpm dlx・yarn dlx）はパッケージを取得して実行する。ローカルの bin か allowlist のものだけ。
  const run = segment.match(commands.run) ?? segment.match(MANAGERS.bun.run);
  const runTarget = run ? firstArg(run[1]) : undefined;
  if (runTarget !== undefined) {
    const name = packageName(runTarget);
    if (!isLocalBin(name) && OTHER_TOOLS.test(name)) block(STACK_TOOLS);
    if (!isLocalBin(name) && !isAllowed(name)) {
      block(`allowlist 外のパッケージを実行しようとしています${where}: ${name}。${SLOPSQUATTING}`);
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
      block(`allowlist 外のパッケージを実行しようとしています${where}: ${name}。${SLOPSQUATTING}`);
    }
  }
});

// install 系は、package.json を直接書き換えた依存も入れてしまうため、そのリポジトリの全 package.json を検査する。
for (const root of installRoots) {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  const files = (listed.stdout ?? "")
    .split("\n")
    .filter(
      (f) =>
        (f === "package.json" || f.endsWith("/package.json")) &&
        !f.startsWith("packages/ai-profile/fixtures/") &&
        existsSync(join(root, f)),
    );
  const problems = deps.checkDeps(root, files);
  if (problems.length > 0) {
    block(
      `package.json に allowlist 外の依存があるため install を止めました${root === projectDir ? "" : `（${root}）`}:\n` +
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
segments.forEach((segment, i) => {
  const targets = [...segment.matchAll(/(?:^|[^<>&\d])\d*>>?\s*([^\s;&|<>]+)/g)].map((m) => m[1]);
  if (WRITERS.test(segment)) {
    targets.push(...words(segment).filter((t) => !t.startsWith("-")));
  }
  for (const t of targets) {
    if (t.startsWith("&")) continue;
    const found = protectedReason(t, dirs[i]);
    if (found !== undefined) ask(protectedMessage(found));
  }
});

process.exit(0);
