// 既存のリポジトリにプロファイルを導入する。既存のファイルは上書きせず、違うものは差分と追記内容を示して止まる。
// 使い方（導入先のリポジトリのルートで実行する）:
//   git clone https://github.com/ryocookie/ai-first-ts /tmp/ai-first-ts && git -C /tmp/ai-first-ts checkout <commit>
//   bun /tmp/ai-first-ts/packages/ai-profile/adopt/init.mjs --owner @your-org/your-team
// オプション:
//   --owner <@user|@org/team>  CODEOWNERS の所有者（CODEOWNERS がまだないときは必須）
//   --package-manager <pm>     bun / npm / pnpm / yarn（既定: lockfile と packageManager から判定）
//   --tsconfig <path>          厳格系オプションを持たせる基準の tsconfig（既定: tsconfig.base.json か tsconfig.json）
//   --update                   プロファイル本体と guard を、このコミットのものに置き換える（プロファイルの更新）
//   --dry-run                  何も書かずに、することだけを表示する
// 手順: 1 回目はファイルを足し、既存の設定への追記を示して止まる → 反映して install → もう一度実行するとベースラインを作る。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { loadAllowlist } from "../gate/deps.mjs";
import { PROTECTED_PATHS } from "../gate/protected.mjs";
import {
  ADOPTED_IGNORES,
  BASELINE_PATH,
  CONFIG_PATH,
  GRADUAL_RULES,
  LINT_REFERENCE,
  PACKAGE_MANAGERS,
  PROFILE_DIR,
  REQUIRED_COMPILER_OPTIONS,
  digestOf,
} from "./config.mjs";
import { formatText } from "./collect.mjs";

const source = resolve(import.meta.dirname, "..", "..", "..");
const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const flags = {
  owner: option("--owner"),
  packageManager: option("--package-manager"),
  tsconfig: option("--tsconfig"),
  target: resolve(option("--target") ?? process.cwd()),
  update: argv.includes("--update"),
  dryRun: argv.includes("--dry-run"),
};
const target = flags.target;

const stop = (message) => {
  console.error(`ai-profile init: ${message}`);
  process.exit(1);
};
const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const readText = (root, path) =>
  existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : undefined;
const readJsonc = (root, path) => {
  const text = readText(root, path);
  if (text === undefined) {
    return undefined;
  }
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  return error === undefined ? config : undefined;
};
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// --- 0. 前提 -------------------------------------------------------------------
if (target === source) {
  stop("プロファイルの開発元には導入できない。導入先のリポジトリのルートで実行する。");
}
if (!existsSync(join(target, "package.json"))) {
  stop(`${target} に package.json がない。導入先のリポジトリのルートで実行する。`);
}
const top = git(target, ["rev-parse", "--show-toplevel"]);
if (top.status !== 0 || resolve(top.stdout.trim()) !== target) {
  stop(`${target} は git リポジトリのルートではない。`);
}
const rootPackage = readJsonc(target, "package.json");
if (!isRecord(rootPackage)) {
  stop("package.json を読めない。");
}

/** lockfile と packageManager からパッケージマネージャを判定する。 */
function detectPackageManager() {
  if (flags.packageManager !== undefined) {
    return PACKAGE_MANAGERS.includes(flags.packageManager)
      ? flags.packageManager
      : stop(`--package-manager は ${PACKAGE_MANAGERS.join(" / ")} のどれか。`);
  }
  const declared = /^(bun|npm|pnpm|yarn)@/.exec(String(rootPackage.packageManager ?? ""))?.[1];
  if (declared !== undefined) {
    return declared;
  }
  const lockfiles = {
    bun: ["bun.lock", "bun.lockb"],
    npm: ["package-lock.json"],
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
  };
  const found = PACKAGE_MANAGERS.filter((pm) =>
    lockfiles[pm].some((f) => existsSync(join(target, f))),
  );
  if (found.length !== 1) {
    stop(
      found.length === 0
        ? "lockfile がなく、パッケージマネージャを判定できない。--package-manager で指定する。"
        : `lockfile が複数ある（${found.join(", ")}）。--package-manager で指定する。`,
    );
  }
  return found[0];
}
const packageManager = detectPackageManager();

const INSTALL = {
  bun: "bun install --frozen-lockfile",
  npm: "npm ci",
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --immutable",
};
const ADD_DEV = {
  bun: "bun add -d",
  npm: "npm install -D",
  pnpm: "pnpm add -D -w",
  yarn: "yarn add -D",
};
const RUN_TEST = { bun: "bun run test", npm: "npm test", pnpm: "pnpm test", yarn: "yarn test" };

// --- 1. 置くファイル --------------------------------------------------------------
const sourcePackage = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const catalog = sourcePackage.workspaces?.catalog ?? {};
const versionOf = (name) => {
  const spec = sourcePackage.devDependencies?.[name] ?? sourcePackage.dependencies?.[name];
  return spec === "catalog:" ? catalog[name] : spec;
};
const sourceCommit = git(source, ["rev-parse", "HEAD"]).stdout.trim();
const sourceDirty =
  git(source, ["status", "--porcelain", "--", PROFILE_DIR]).stdout.trim().length > 0;
const sourceUrl = git(source, ["remote", "get-url", "origin"]).stdout.trim() || source;

// プロファイル本体のうち導入先に置くもの。開発用のもの（テスト・lint と tsc-hints のフィクスチャ・tsconfig）は置かない。
const VENDORED =
  /^packages\/ai-profile\/(?:allowlist\.json|(?:adopt|core|db|gate|lint|test|tsc-hints)\/.+|fixtures\/gate\/.+)$/;
const listed = git(source, [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
  PROFILE_DIR,
]);
const profileEntries = listed.stdout
  .split("\0")
  .filter((f) => VENDORED.test(f) && !/\.test\.tsx?$/.test(f) && existsSync(join(source, f)))
  .map((f) => [f, readFileSync(join(source, f), "utf8")]);

const profilePackage = JSON.parse(readFileSync(join(source, PROFILE_DIR, "package.json"), "utf8"));
const peers = Object.fromEntries(
  Object.keys(profilePackage.dependencies ?? {}).map((name) => [
    name,
    profilePackage.dependencies[name] === "catalog:"
      ? catalog[name]
      : profilePackage.dependencies[name],
  ]),
);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
profileEntries.push([
  `${PROFILE_DIR}/package.json`,
  json({
    name: profilePackage.name,
    version: profilePackage.version,
    private: true,
    type: "module",
    exports: profilePackage.exports,
    // core（Result・検証）は zod、db（userScoped）は drizzle-orm を使う。使う層を有効にした時にアプリ側に入れる。
    peerDependencies: peers,
    peerDependenciesMeta: Object.fromEntries(
      Object.keys(peers).map((n) => [n, { optional: true }]),
    ),
  }),
]);
const sourceLint = JSON.parse(readFileSync(join(source, ".oxlintrc.json"), "utf8"));
const lintConfig = json({ ...sourceLint, ignorePatterns: ADOPTED_IGNORES });
profileEntries.push([LINT_REFERENCE, lintConfig]);
const digest = digestOf(profileEntries);

const sourceSettings = JSON.parse(readFileSync(join(source, ".claude", "settings.json"), "utf8"));
const settings = json({
  $schema: sourceSettings.$schema,
  permissions: sourceSettings.permissions,
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: `cd "$CLAUDE_PROJECT_DIR" && ${INSTALL[packageManager]} >/dev/null 2>&1; exit 0`,
          },
        ],
      },
    ],
    PreToolUse: sourceSettings.hooks.PreToolUse,
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          {
            type: "command",
            command: `cd "$CLAUDE_PROJECT_DIR" && bun ${PROFILE_DIR}/adopt/verify.mjs --quick`,
          },
        ],
      },
    ],
  },
});

const bunVersion = /^bun@(.+)$/.exec(String(sourcePackage.packageManager))?.[1] ?? "latest";
const nodeSetup =
  packageManager === "bun"
    ? ""
    : [
        ...(packageManager === "pnpm" ? ["      - uses: pnpm/action-setup@v4"] : []),
        "      - uses: actions/setup-node@v4",
        "        with:",
        existsSync(join(target, ".nvmrc"))
          ? "          node-version-file: .nvmrc"
          : "          node-version: lts/*",
        ...(packageManager === "yarn" ? ["      - run: corepack enable"] : []),
        "",
      ].join("\n");

/** 基準のブランチ（origin の HEAD。分からなければ main）。 */
function detectBaseBranch() {
  const head = git(target, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  return head.status === 0 ? head.stdout.trim().replace(/^origin\//, "") : "main";
}
const existingConfig = readJsonc(target, CONFIG_PATH);
const baseBranch = isRecord(existingConfig)
  ? String(existingConfig.baseBranch)
  : detectBaseBranch();

const workflow = `# ai-profile の品質ゲート（packages/ai-profile/adopt/init.mjs が作成）。
# 変更したファイルを基準のブランチと比べるため、履歴を全て取得する（fetch-depth: 0）。
name: ai-profile

on:
  pull_request:
  push:
    branches: [${baseBranch}]

permissions:
  contents: read

jobs:
  ai-profile:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${bunVersion}
${nodeSetup}      - run: ${INSTALL[packageManager]}
      # ゲートの改ざん検査（プロファイル本体の digest を含む）は verify とは別に直接実行する。
      - run: bun ${PROFILE_DIR}/gate/check.mjs
      - run: bun ${PROFILE_DIR}/adopt/verify.mjs
`;

const ownedPatterns = [`/${PROFILE_DIR}/`, ...PROTECTED_PATHS.map((p) => p.codeowners)];
const codeownersLines = (owner) =>
  [...new Set(ownedPatterns)].map((pattern) => `${pattern} ${owner}`);

/** @type {{ path: string, content: string, owned: boolean }[]} owned: プロファイルの持ち物（--update で置き換える） */
const files = [
  ...profileEntries.map(([path, content]) => ({ path, content, owned: true })),
  {
    path: ".claude/hooks/guard.mjs",
    content: readFileSync(join(source, ".claude", "hooks", "guard.mjs"), "utf8"),
    owned: true,
  },
  { path: ".claude/settings.json", content: settings, owned: false },
  { path: ".oxlintrc.json", content: lintConfig, owned: false },
  { path: ".oxfmtrc.json", content: json({ ignorePatterns: ADOPTED_IGNORES }), owned: false },
  { path: ".github/workflows/ai-profile.yml", content: workflow, owned: false },
];

// 導入先のフォーマット検査で落ちないよう、開発元の oxfmt で整形しておく。
for (const file of files) {
  if (!file.path.startsWith(`${PROFILE_DIR}/`)) {
    file.content = formatText(source, file.path, file.content);
  }
}

// --- 2. 既存のリポジトリを調べる ----------------------------------------------------------
/** @type {{ path: string, message: string, detail?: string }[]} */
const conflicts = [];
const notes = [];

const codeowners = readText(target, ".github/CODEOWNERS");
if (codeowners === undefined) {
  if (flags.owner === undefined || !flags.owner.startsWith("@")) {
    stop(
      "--owner @<ユーザー> か @<組織>/<チーム> を指定する（ゲートファイルの変更をレビューする人。リポジトリへの書き込み権限が必要）。",
    );
  }
  files.push({
    path: ".github/CODEOWNERS",
    content:
      "# ai-profile のゲートファイル（packages/ai-profile/gate/protected.mjs）の変更には所有者のレビューが要る。\n" +
      `${codeownersLines(flags.owner).join("\n")}\n`,
    owned: false,
  });
} else {
  const owned = new Set(
    codeowners
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim().split(/\s+/))
      .filter((fields) => fields.length >= 2)
      .map((fields) => fields[0]),
  );
  const missingLines = ownedPatterns.filter((p) => !owned.has(p));
  if (missingLines.length > 0) {
    const owner = flags.owner ?? "@<所有者>";
    conflicts.push({
      path: ".github/CODEOWNERS",
      message: "ゲートファイルの所有者の行がない。末尾に追記する（後の行が勝つので末尾に置く）:",
      detail: codeownersLines(owner)
        .filter((line) => missingLines.includes(line.split(" ")[0] ?? ""))
        .join("\n"),
    });
  }
}

// 基準の tsconfig と厳格系オプション。
const tsconfigPath =
  flags.tsconfig ??
  (isRecord(existingConfig) && typeof existingConfig.tsconfig === "string"
    ? existingConfig.tsconfig
    : existsSync(join(target, "tsconfig.base.json"))
      ? "tsconfig.base.json"
      : "tsconfig.json");
const tsconfig = readJsonc(target, tsconfigPath);
if (!isRecord(tsconfig)) {
  conflicts.push({
    path: tsconfigPath,
    message:
      "基準の tsconfig がない（読めない）。--tsconfig で、厳格系オプションを持たせる tsconfig を指定する。",
  });
} else {
  const options = isRecord(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
  const missingOptions = REQUIRED_COMPILER_OPTIONS.filter((name) => options[name] !== true);
  if (missingOptions.length > 0) {
    conflicts.push({
      path: tsconfigPath,
      message:
        "compilerOptions で次を true にする（型エラーが増えるが、導入時の分はベースラインに入る）:",
      detail: missingOptions.map((name) => `"${name}": true,`).join("\n"),
    });
  }
}

// 検査に使うツール。
const deps = { ...rootPackage.dependencies, ...rootPackage.devDependencies };
const tools = ["typescript", "oxlint", "oxlint-tsgolint", "oxfmt"].filter(
  (name) => deps[name] === undefined,
);
if (tools.length > 0) {
  conflicts.push({
    path: "package.json",
    message: `devDependencies に追加して install する（${ADD_DEV[packageManager]} ${tools.join(" ")}）:`,
    detail: tools.map((name) => `"${name}": "${versionOf(name)}",`).join("\n"),
  });
}

// 既存の lint・フォーマット設定（ESLint・Prettier は残してよい。プロファイルは oxlint・oxfmt で検査する）。
const otherLinters = git(target, ["ls-files", "-z"])
  .stdout.split("\0")
  .filter((f) =>
    /(?:^|\/)(?:\.eslintrc(?:\.\w+)?|eslint\.config\.\w+|\.prettierrc(?:\.\w+)?|prettier\.config\.\w+)$/.test(
      f,
    ),
  );
if (otherLinters.length > 0) {
  notes.push(
    `ESLint / Prettier の設定（${otherLinters.join(", ")}）は残してよい。プロファイルの検査は oxlint / oxfmt で行う。` +
      "両方が同じファイルを整形しないよう、移行が済んだら外す。",
  );
}

// --- 3. 書き込む -------------------------------------------------------------------
/** 既存のファイルとの差分（git diff --no-index）。 */
function diff(path, content) {
  const tmp = mkdtempSync(join(tmpdir(), "ai-profile-init-"));
  try {
    const proposed = join(tmp, "proposed");
    writeFileSync(proposed, content);
    const result = git(target, ["diff", "--no-index", "--no-color", "--", path, proposed]);
    return result.stdout.split(proposed).join(path);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const created = [];
const replaced = [];
for (const file of files) {
  const existing = readText(target, file.path);
  if (existing === file.content) {
    continue;
  }
  if (existing === undefined || (file.owned && flags.update)) {
    (existing === undefined ? created : replaced).push(file.path);
    if (!flags.dryRun) {
      mkdirSync(dirname(join(target, file.path)), { recursive: true });
      writeFileSync(join(target, file.path), file.content);
    }
    continue;
  }
  conflicts.push(
    file.owned
      ? {
          path: file.path,
          message:
            "プロファイル本体が、このコミットのものと違う。プロファイルを更新するなら --update で置き換える。",
        }
      : {
          path: file.path,
          message: "既にあり、プロファイルのものと違う。差分を見て反映する:",
          detail: diff(file.path, file.content),
        },
  );
}
// 開発元にない古いファイル（更新で消えたもの）。
const vendoredNow = new Set(profileEntries.map(([path]) => path));
const stale = git(target, [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
  PROFILE_DIR,
])
  .stdout.split("\0")
  .filter((f) => f.length > 0 && !vendoredNow.has(f) && existsSync(join(target, f)));
for (const path of stale) {
  conflicts.push({ path, message: "このコミットのプロファイルにないファイル。消す（git rm）。" });
}

// 設定。既にあれば導入先の判断（層・例外・依存）を残し、プロファイルの版だけを書き換える。
const allow = loadAllowlist(source);
const packageJsons = git(target, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .stdout.split("\0")
  .filter(
    (f) =>
      (f === "package.json" || f.endsWith("/package.json")) && !f.startsWith(`${PROFILE_DIR}/`),
  );
/** @type {Set<string>} */
const existingDeps = new Set();
for (const path of packageJsons) {
  const pkg = readJsonc(target, path);
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of Object.keys(isRecord(pkg?.[field]) ? pkg[field] : {})) {
      if (!allow.has(name) && !name.startsWith("@ai-first-ts/")) {
        existingDeps.add(name);
      }
    }
  }
}
const typecheck = git(target, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .stdout.split("\0")
  .filter((f) => /(?:^|\/)tsconfig\.json$/.test(f) && !f.startsWith(`${PROFILE_DIR}/`))
  .filter((f) => {
    const cfg = readJsonc(target, f);
    return !(isRecord(cfg) && Array.isArray(cfg.files) && cfg.files.length === 0);
  })
  .sort();
const testScript = isRecord(rootPackage.scripts) ? rootPackage.scripts.test : undefined;
const hasTests = typeof testScript === "string" && !/no test specified/.test(testScript);
const profile = { source: sourceUrl, commit: sourceCommit, digest };
const config = isRecord(existingConfig)
  ? { ...existingConfig, profile: flags.update ? profile : existingConfig.profile }
  : {
      $comment:
        "ai-profile の導入設定（ゲートファイル。変更には所有者のレビューが要る）。rules の files に glob を足すと、その層でルールが有効になる。",
      profile,
      packageManager,
      tsconfig: tsconfigPath,
      typecheck: typecheck.length > 0 ? typecheck : [tsconfigPath],
      test: hasTests ? RUN_TEST[packageManager] : null,
      baseBranch,
      dependencies: [...existingDeps].sort(),
      rules: Object.fromEntries(
        Object.keys(GRADUAL_RULES).map((name) => [name, { files: [], except: [] }]),
      ),
    };
if (!isRecord(existingConfig) || flags.update) {
  (existingConfig === undefined ? created : replaced).push(CONFIG_PATH);
  if (!flags.dryRun) {
    writeFileSync(join(target, CONFIG_PATH), formatText(source, CONFIG_PATH, json(config)));
  }
}

// --- 4. 報告する --------------------------------------------------------------------
const list = (title, paths) =>
  paths.length === 0 ? [] : [`${title}（${paths.length}）:`, ...paths.map((p) => `  ${p}`)];
const report = [
  `ai-profile init: ${sourceUrl} @ ${sourceCommit.slice(0, 12)}${sourceDirty ? "（未コミットの変更あり）" : ""} → ${target}`,
  `パッケージマネージャ: ${packageManager} / 基準の tsconfig: ${tsconfigPath} / 基準のブランチ: ${baseBranch}`,
  ...list(
    flags.dryRun ? "作るファイル" : "作ったファイル",
    created.filter((p) => !p.startsWith(`${PROFILE_DIR}/`)),
  ),
  ...(created.some((p) => p.startsWith(`${PROFILE_DIR}/`))
    ? [
        `  ${PROFILE_DIR}/（${created.filter((p) => p.startsWith(`${PROFILE_DIR}/`)).length} ファイル）`,
      ]
    : []),
  ...list(flags.dryRun ? "置き換えるファイル" : "置き換えたファイル", replaced),
  ...notes.map((n) => `メモ: ${n}`),
];
console.log(report.join("\n"));
if (!isRecord(existingConfig)) {
  console.log(
    `\n導入時からある依存 ${existingDeps.size} 件を ${CONFIG_PATH} の dependencies に記録した。これ以降の追加は allowlist と同じく人間の承認制。`,
  );
}
if (!hasTests && !isRecord(existingConfig)) {
  console.log(
    `テストのスクリプトがないため、${CONFIG_PATH} の test は null にした（テストを足したらコマンドを書く）。`,
  );
}

if (conflicts.length > 0) {
  console.error(
    `\n既存のファイルを上書きせずに止めた。次の ${conflicts.length} 件を反映してから、もう一度実行する:\n\n` +
      conflicts
        .map(
          (c) =>
            `■ ${c.path}: ${c.message}${c.detail === undefined ? "" : `\n${c.detail.replace(/^/gm, "    ")}`}`,
        )
        .join("\n\n"),
  );
  process.exit(1);
}
if (flags.dryRun) {
  process.exit(0);
}

// --- 5. ゲートを確かめ、ベースラインを作る -------------------------------------------------
const gate = spawnSync(process.execPath, [join(PROFILE_DIR, "gate", "check.mjs")], {
  cwd: target,
  encoding: "utf8",
});
if (gate.status !== 0) {
  console.error(
    `\nゲートの検査が通らない。直してから、もう一度実行する:\n\n${gate.stdout}${gate.stderr}`,
  );
  process.exit(1);
}
if (existsSync(join(target, BASELINE_PATH))) {
  console.log(`\n${BASELINE_PATH} は既にある（変えない）。導入は済んでいる。`);
  process.exit(0);
}
const recorded = spawnSync(
  process.execPath,
  [join(PROFILE_DIR, "adopt", "verify.mjs"), "--record-baseline"],
  { cwd: target, encoding: "utf8" },
);
process.stdout.write(recorded.stdout);
process.stderr.write(recorded.stderr);
if (recorded.status !== 0) {
  process.exit(recorded.status ?? 1);
}
console.log(
  [
    "",
    "導入できた。次にすること:",
    "  1. 変更をコミットして PR を出す（ゲートファイルなので CODEOWNERS の所有者がレビューする）。",
    "  2. main のブランチ保護で、PR 必須・Code Owners のレビュー必須・ai-profile チェック必須を設定する（docs/adopt.md）。",
    `  3. 層ごとのルール（${Object.keys(GRADUAL_RULES).join("・")}）は ${CONFIG_PATH} の rules に glob を足して有効にする。`,
  ].join("\n"),
);
