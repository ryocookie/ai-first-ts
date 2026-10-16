// 既存リポジトリへの導入（init → ベースライン → verify → ゲート → guard）を、構成の違う 2 つのサンプルで通しで検証する。
//   A: npm・単一パッケージ・ESLint あり・strict でない tsconfig・検査用の devDependencies なし
//   B: bun・ワークスペース（apps/ と libs/）・基準は tsconfig.base.json・既存の CODEOWNERS と CI あり
// サンプルの node_modules はこのリポジトリのもの（typescript・oxlint・oxfmt）を指す。install は行わない。
// 外部コマンドの実行は時間がかかるため、モジュールの読み込み時に全て実行して結果を記録し、各テストは結果を検証する。
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseJson } from "../core";

const repo = join(import.meta.dirname, "..", "..", "..");
const init = join(repo, "packages", "ai-profile", "adopt", "init.mjs");
const work = mkdtempSync(join(tmpdir(), "ai-profile-adopt-"));

type Run = { readonly status: number | null; readonly out: string };

function run(cwd: string, command: string, args: readonly string[], input = ""): Run {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", input });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
const bun = (cwd: string, ...args: string[]): Run => run(cwd, process.execPath, args);
const git = (cwd: string, ...args: string[]): Run =>
  run(cwd, "git", ["-c", "user.email=dev@example.com", "-c", "user.name=dev", ...args]);
const read = (cwd: string, path: string): string =>
  existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), "utf8") : "";

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function sample(name: string, files: Readonly<Record<string, string>>): string {
  const root = join(work, name);
  writeFiles(root, { ...files, ".gitignore": "node_modules\n" });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", `https://github.com/acme/${name}.git`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

/**
 * guard（PreToolUse hook）に Bash コマンドを渡し、allow / block / ask を返す。
 * session はセッションのリポジトリ（CLAUDE_PROJECT_DIR）、cwd は hook の入力の cwd。
 * tool が Bash 以外なら、command を編集するファイルのパスとして渡す。
 */
function guard(
  root: string,
  command: string,
  options: { readonly session?: string; readonly cwd?: string; readonly tool?: string } = {},
): string {
  const session = options.session ?? root;
  const tool = options.tool ?? "Bash";
  const toolInput = tool === "Bash" ? { command } : { file_path: command };
  const result = run(
    session,
    "sh",
    ["-c", 'CLAUDE_PROJECT_DIR="$1" "$2" .claude/hooks/guard.mjs', "sh", session, process.execPath],
    JSON.stringify({
      tool_name: tool,
      tool_input: toolInput,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
  );
  if (result.out.includes('"permissionDecision":"ask"')) {
    return "ask";
  }
  return result.status === 2 ? "block" : "allow";
}

const Baseline = z.object({
  violations: z.record(z.string(), z.record(z.string(), z.number())),
});
const Config = z.object({
  packageManager: z.string(),
  tsconfig: z.string(),
  typecheck: z.array(z.string()),
  test: z.string().nullable(),
  dependencies: z.array(z.string()),
});
const baselineOf = (root: string) => parseJson(Baseline, read(root, "ai-profile.baseline.json"));
const configOf = (root: string) => parseJson(Config, read(root, "ai-profile.config.json"));

const STRICT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitReturns: true,
  noPropertyAccessFromIndexSignature: true,
  noFallthroughCasesInSwitch: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
};
const TOOLS = {
  oxfmt: "^0.72.0",
  oxlint: "^1.87.0",
  "oxlint-tsgolint": "^7.0.2004",
  typescript: "^6.0.3",
};

// --- A: npm・単一パッケージ ------------------------------------------------------
const looseTsconfig = `{
  // 既存のプロダクトの tsconfig（strict ではない）
  "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": false, "noEmit": true, "types": ["node"] },
  "include": ["src"]
}
`;
const a = sample("npm-single", {
  "package.json": JSON.stringify({
    name: "legacy-api",
    private: true,
    type: "module",
    scripts: { test: "bun test" },
    dependencies: { express: "^4.19.2", lodash: "^4.17.21" },
    devDependencies: { eslint: "^9.0.0", typescript: "^6.0.3" },
  }),
  "package-lock.json": '{"name":"legacy-api","lockfileVersion":3,"requires":true,"packages":{}}\n',
  "tsconfig.json": looseTsconfig,
  "eslint.config.js": "export default [];\n",
  "src/server.ts": [
    "export function handle(body: string): any {",
    "  const data = JSON.parse(body);",
    "  if (!data.id) {",
    '    throw new Error("missing id");',
    "  }",
    "  return { id: data.id, port: process.env.PORT };",
    "}",
    "",
  ].join("\n"),
  "src/domain/price.ts":
    "export function total(items: readonly number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\n",
  "src/util.ts": "export function first<T>(items: T[]): T {\n  return items[0];\n}\n",
  "src/util.test.ts":
    'import { expect, test } from "bun:test";\nimport { first } from "./util";\n\ntest("first", () => {\n  expect(first([1, 2])).toBe(1);\n});\n',
});

// 1 回目: 既存の tsconfig と package.json は書き換えずに止まる。
const aFirst = run(a, process.execPath, [init, "--owner", "@acme/platform"]);
const aTsconfigAfterFirst = read(a, "tsconfig.json");

// 示された内容を人間が反映して、2 回目でゲートを通してベースラインを作る。
writeFiles(a, {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { ...STRICT, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
    include: ["src"],
  }),
  "package.json": JSON.stringify({
    name: "legacy-api",
    private: true,
    type: "module",
    scripts: { test: "bun test" },
    dependencies: { express: "^4.19.2", lodash: "^4.17.21" },
    devDependencies: { ...TOOLS, eslint: "^9.0.0" },
  }),
});
const aSecond = run(a, process.execPath, [init]);
const aBaseline = baselineOf(a);
const aViolations = aBaseline.ok ? aBaseline.value.violations : {};
const aConfig = configOf(a);
git(a, "add", "-A");
git(a, "commit", "-qm", "adopt ai-profile");
git(a, "checkout", "-qb", "feature");

const verify = (root: string, ...args: string[]): Run =>
  bun(root, "packages/ai-profile/adopt/verify.mjs", "--base", "main", ...args);
const gate = (root: string): Run => bun(root, "packages/ai-profile/gate/check.mjs");

const aClean = verify(a);
// ベースラインにある型エラーのファイルに触れる（直さない）。
appendFileSync(join(a, "src/util.ts"), "// touched\n");
const aTouched = verify(a);
git(a, "checkout", "-q", "src/util.ts");
// 新しいファイルで違反する（lint だけを見る --quick）。
writeFiles(a, { "src/new.ts": "export const n = (v: unknown) => v as number;\n" });
const aNewFile = verify(a, "--quick");
rmSync(join(a, "src/new.ts"));
// 層を有効にしない変更で、ベースラインに違反を足して通そうとする。
const original = read(a, "ai-profile.baseline.json");
writeFiles(a, {
  "ai-profile.baseline.json": original.replace(
    '"violations": {',
    '"violations": {\n    "src/new.ts": { "typescript(consistent-type-assertions)": 1 },',
  ),
});
const aGrownBaseline = gate(a);
writeFiles(a, { "ai-profile.baseline.json": original });
// プロファイル本体を書き換えて検査を外そうとする。
const noThrow = read(a, "packages/ai-profile/lint/no-throw.mjs");
appendFileSync(join(a, "packages/ai-profile/lint/no-throw.mjs"), "\n// tampered\n");
const aTampered = gate(a);
writeFiles(a, { "packages/ai-profile/lint/no-throw.mjs": noThrow });
// 層を有効にする（src/ で throw 禁止）。既存の throw はまだベースラインにないので落ちる。
const configText = read(a, "ai-profile.config.json");
writeFiles(a, {
  "ai-profile.config.json": configText.replace(
    /"result": \{\s*"files": \[\]/,
    '"result": { "files": ["src/**"]',
  ),
});
run(a, join(a, "node_modules", ".bin", "oxfmt"), ["ai-profile.config.json"]);
const aLayerOn = verify(a);
// 人間がベースラインを作り直すと、設定を変える PR なので増えた分も通る。
const aRecorded = verify(a, "--record-baseline");
const aGateAfterLayer = gate(a);
const aVerifyAfterLayer = verify(a);
const aLayerBaseline = baselineOf(a);
const aLayerViolations = aLayerBaseline.ok ? aLayerBaseline.value.violations : {};

const aGuard = {
  allowedDependency: guard(a, "npm install lodash"),
  unknownDependency: guard(a, "npm install left-pad"),
  otherManager: guard(a, "bun add zod"),
  recordBaseline: guard(a, "bun packages/ai-profile/adopt/verify.mjs --record-baseline"),
  updateBaseline: guard(a, "bun packages/ai-profile/adopt/verify.mjs --update-baseline"),
};

// --- B: bun・ワークスペース ------------------------------------------------------
const b = sample("bun-workspaces", {
  "package.json": JSON.stringify({
    name: "acme",
    private: true,
    type: "module",
    workspaces: ["apps/*", "libs/*"],
    scripts: { test: "bun test" },
    devDependencies: TOOLS,
    packageManager: "bun@1.4.2",
  }),
  "bun.lock": "",
  "tsconfig.base.json": JSON.stringify({
    compilerOptions: { ...STRICT, module: "ESNext", moduleResolution: "bundler", noEmit: true },
  }),
  "apps/api/package.json": JSON.stringify({
    name: "@acme/api",
    private: true,
    dependencies: { "@acme/shared": "workspace:*", hono: "^4.0.0" },
  }),
  "apps/api/tsconfig.json": '{ "extends": "../../tsconfig.base.json", "include": ["src"] }\n',
  "apps/api/src/index.ts": "export const port = 3000;\n",
  "libs/shared/package.json": JSON.stringify({ name: "@acme/shared", private: true }),
  "libs/shared/tsconfig.json": '{ "extends": "../../tsconfig.base.json", "include": ["src"] }\n',
  "libs/shared/src/money.ts": "export const yen = (n: number): string => `${n}円`;\n",
  ".github/CODEOWNERS": "* @acme/maintainers\n",
  ".github/workflows/ci.yml": "name: ci\non: [push]\n",
});
const bFirst = run(b, process.execPath, [init]);
const bCodeownersAfterFirst = read(b, ".github/CODEOWNERS");
const missingLines = bFirst.out
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("/") && line.endsWith("@<所有者>"))
  .map((line) => line.replace("@<所有者>", "@acme/maintainers"));
appendFileSync(join(b, ".github/CODEOWNERS"), `${missingLines.join("\n")}\n`);
const bSecond = run(b, process.execPath, [init]);
const bConfig = configOf(b);
const bWorkflow = read(b, ".github/workflows/ai-profile.yml");
const bOwnWorkflow = read(b, ".github/workflows/ci.yml");
// 開発元のリポジトリ（bun）のセッションから、導入先（A: npm）で実行する。判定は導入先の設定で行う。
const plain = sample("no-profile", {
  "package.json": JSON.stringify({ name: "plain", private: true }),
});
const crossGuard = {
  cdOwnManager: guard(a, `cd ${a} && npm install lodash`, { session: repo }),
  cwdOwnManager: guard(a, "npm install lodash", { session: repo, cwd: a }),
  cdUnknownDependency: guard(a, `cd ${a} && npm install left-pad`, { session: repo }),
  cdOtherManager: guard(a, `cd ${a} && bun add zod`, { session: repo }),
  backToSession: guard(a, `cd ${a} && ls && cd ${repo} && npm install lodash`, { session: repo }),
  noProfile: guard(a, `cd ${plain} && npm install`, { session: repo }),
  editConfig: guard(a, join(a, "ai-profile.config.json"), { session: repo, tool: "Write" }),
  writeConfig: guard(a, `cd ${a} && echo {} > ai-profile.config.json`, { session: repo }),
  editSource: guard(a, join(a, "src/server.ts"), { session: repo, tool: "Edit" }),
};

const bGuard = {
  otherManager: guard(b, "npm install zod"),
  ownManager: guard(b, "bun add zod"),
};

const fromOrigin = run(repo, process.execPath, [init, "--owner", "@acme/platform"]);

rmSync(work, { recursive: true, force: true });

describe("init", () => {
  test("既存の tsconfig・package.json は書き換えず、反映する内容を示して止まる", () => {
    expect(aFirst.status).toBe(1);
    expect(aFirst.out).toContain("noUncheckedIndexedAccess");
    expect(aFirst.out).toContain('"oxlint-tsgolint": "^7.0.2004"');
    expect(aTsconfigAfterFirst).toBe(looseTsconfig);
  });

  test("反映後の 2 回目でゲートを通し、導入時の違反をベースラインに記録する", () => {
    expect(aSecond.status).toBe(0);
    expect(aBaseline.ok).toBeTrue();
    const server = aViolations["src/server.ts"] ?? {};
    expect(server["typescript(no-explicit-any)"]).toBe(1);
    // 層ごとのルール（throw 禁止・外部入力の検証）は有効にするまで数えない。
    expect(server["ai-profile(no-throw)"]).toBeUndefined();
    expect(server["ai-profile(untrusted-input)"]).toBeUndefined();
    expect(aViolations["src/domain/price.ts"]).toEqual({ "ai-profile(test-required)": 1 });
  });

  test("パッケージマネージャ・既存の依存・テストのコマンドを設定に記録する", () => {
    expect(aConfig).toMatchObject({
      ok: true,
      value: {
        packageManager: "npm",
        test: "npm test",
        dependencies: ["eslint", "express", "lodash"],
      },
    });
  });

  test("既存の CODEOWNERS には追記する行を示して止まり、追記後は導入できる", () => {
    expect(bFirst.status).toBe(1);
    expect(bCodeownersAfterFirst).toBe("* @acme/maintainers\n");
    expect(missingLines).toContain("/ai-profile.baseline.json @acme/maintainers");
    expect(bSecond.status).toBe(0);
  });

  test("ワークスペースでは各パッケージの tsconfig を型チェックし、既存の CI は残す", () => {
    expect(bConfig).toMatchObject({
      ok: true,
      value: {
        tsconfig: "tsconfig.base.json",
        typecheck: ["apps/api/tsconfig.json", "libs/shared/tsconfig.json"],
      },
    });
    expect(bWorkflow).toContain("bun install --frozen-lockfile");
    expect(bOwnWorkflow).toBe("name: ci\non: [push]\n");
  });

  test("プロファイルの開発元には導入しない", () => {
    expect(fromOrigin.status).toBe(1);
    expect(fromOrigin.out).toContain("開発元");
  });
});

describe("verify（ベースライン）", () => {
  test("導入直後はベースラインの違反だけなので通る", () => {
    expect(aClean.status).toBe(0);
  });

  test("変更したファイルは、ベースラインにある違反も含めて 0 件にする", () => {
    expect(aTouched.status).toBe(1);
    expect(aTouched.out).toContain("src/util.ts:2:3: TS2322");
    expect(aTouched.out).toContain("変更したファイルは");
  });

  test("新しい違反は直し方付きで落ちる", () => {
    expect(aNewFile.status).toBe(1);
    expect(aNewFile.out).toContain("typescript(consistent-type-assertions)");
    expect(aNewFile.out).toContain("直し方:");
  });

  test("層を有効にすると、その層の既存の違反が数えられる", () => {
    expect(aLayerOn.status).toBe(1);
    expect(aLayerOn.out).toContain("src/server.ts:4:5: ai-profile(no-throw)");
    expect(aLayerOn.out).toContain("rules.result.except");
  });

  test("層を有効にする変更では、人間がベースラインを作り直せる", () => {
    expect(aRecorded.status).toBe(0);
    expect(aGateAfterLayer.status).toBe(0);
    expect(aVerifyAfterLayer.status).toBe(0);
    expect(aLayerBaseline.ok).toBeTrue();
    expect(aLayerViolations["src/server.ts"]?.["ai-profile(no-throw)"]).toBe(1);
  });
});

describe("gate（導入モード）", () => {
  test("層を有効にしない変更で、ベースラインを増やすと落ちる", () => {
    expect(aGrownBaseline.status).toBe(1);
    expect(aGrownBaseline.out).toContain("gate(baseline) src/new.ts");
  });

  test("プロファイル本体を書き換えると落ちる", () => {
    expect(aTampered.status).toBe(1);
    expect(aTampered.out).toContain("gate(adopt-config)");
  });
});

describe("guard（導入モード）", () => {
  test("導入先のパッケージマネージャで、導入時からある依存は入れられる", () => {
    expect(aGuard.allowedDependency).toBe("allow");
    expect(bGuard.ownManager).toBe("allow");
  });

  test("allowlist にも導入時の依存にもないパッケージは止める", () => {
    expect(aGuard.unknownDependency).toBe("block");
  });

  test("導入先と違うパッケージマネージャは止める", () => {
    expect(aGuard.otherManager).toBe("block");
    expect(bGuard.otherManager).toBe("block");
  });

  test("ベースラインを作り直すコマンドは人間に確かめ、減らすだけのコマンドは通す", () => {
    expect(aGuard.recordBaseline).toBe("ask");
    expect(aGuard.updateBaseline).toBe("allow");
  });
});

describe("guard（別のリポジトリのセッションから導入先で実行する）", () => {
  test("cd 先・hook の cwd のリポジトリの設定で判定する", () => {
    expect(crossGuard.cdOwnManager).toBe("allow");
    expect(crossGuard.cwdOwnManager).toBe("allow");
    expect(crossGuard.cdUnknownDependency).toBe("block");
    expect(crossGuard.cdOtherManager).toBe("block");
  });

  test("セッションのリポジトリに戻ったら、セッションのリポジトリの設定で判定する", () => {
    expect(crossGuard.backToSession).toBe("block");
  });

  test("プロファイルを導入していないリポジトリは、セッションのリポジトリの設定で判定する（緩めない）", () => {
    expect(crossGuard.noProfile).toBe("block");
  });

  test("導入先のゲートファイルの編集は人間に確かめ、それ以外は通す", () => {
    expect(crossGuard.editConfig).toBe("ask");
    expect(crossGuard.writeConfig).toBe("ask");
    expect(crossGuard.editSource).toBe("allow");
  });
});
