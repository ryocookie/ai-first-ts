// .oxlintrc.json が禁止ルールを強制し続けていることを検査する:
// HINTS の各ルールに fixtures/lint/<rule>.invalid.ts と <rule>.valid.ts があり、
// invalid は先頭の `// expect: <code>` のルールだけで失敗し、valid は診断ゼロであること。
// あわせて、throw の境界（throw-boundaries.mjs）が許可する範囲を表形式のケースで検査する。
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { HINTS } from "./hints.mjs";
import { findThrows } from "./no-throw.mjs";
import { lint, repoRoot } from "./oxlint.mjs";

const fixtureDir = join(import.meta.dirname, "..", "fixtures", "lint");
const ruleName = (code) => /\((.+)\)$/.exec(code)?.[1] ?? code;

// ルートの設定はフィクスチャを ignorePatterns で除外しているため、それだけ外した設定で検査する。
const { ignorePatterns: _ignored, ...config } = JSON.parse(
  readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8"),
);
delete config.$schema;
const tmp = mkdtempSync(join(tmpdir(), "ai-profile-lint-"));
const configPath = join(tmp, "oxlintrc.json");
writeFileSync(configPath, JSON.stringify(config));

let diagnostics;
try {
  diagnostics = lint(["-c", configPath, relative(repoRoot, fixtureDir)]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const codesByFile = new Map();
for (const d of diagnostics) {
  const name = relative(fixtureDir, join(repoRoot, d.filename));
  codesByFile.set(name, [...(codesByFile.get(name) ?? []), d.code]);
}

const files = readdirSync(fixtureDir).filter((f) => /\.(?:invalid|valid)\.tsx?$/.test(f));
const failures = [];

for (const code of Object.keys(HINTS)) {
  for (const kind of ["invalid", "valid"]) {
    if (!files.includes(`${ruleName(code)}.${kind}.ts`)) {
      failures.push(
        `${ruleName(code)}.${kind}.ts: missing fixture for ${code}.\n` +
          `  直し方: packages/ai-profile/fixtures/lint/ に違反例と正しい例の両方を置く。`,
      );
    }
  }
}

for (const name of files.sort()) {
  const codes = codesByFile.get(name) ?? [];
  if (name.includes(".valid.")) {
    if (codes.length > 0) {
      failures.push(
        `${name}: expected no diagnostics, got ${codes.join(", ")}.\n` +
          `  直し方: 正しい例が通らなくなった。.oxlintrc.json の変更を見直すか、ルールの意図どおりにフィクスチャを更新する。`,
      );
    }
    continue;
  }

  const header = /^\/\/ expect: (\S+)/.exec(readFileSync(join(fixtureDir, name), "utf8"));
  if (!header) {
    failures.push(
      `${name}: missing "// expect: <plugin>(<rule>)" header.\n` +
        `  直し方: 違反例の1行目に期待する診断コードを書く（例: // expect: typescript(no-explicit-any)）。`,
    );
    continue;
  }
  const [, expected] = header;
  const unexpected = codes.filter((c) => c !== expected);
  if (!codes.includes(expected) || unexpected.length > 0) {
    const got = codes.length > 0 ? codes.join(", ") : "no diagnostics";
    failures.push(
      `${name}: expected only ${expected} but got ${got}.\n` +
        (expected.startsWith("ai-profile(")
          ? `  直し方: packages/ai-profile/lint/ の独自検査（${ruleName(expected)}）が外れていないか確認して戻す。`
          : `  直し方: .oxlintrc.json で "${expected.replace("(", "/").replace(")", "")}" を "error" に戻す。`) +
        `型情報を使うルール（no-unsafe-* など）なら "options": { "typeAware": true } も戻す。` +
        `無効化・緩和は人間の承認が必要。`,
    );
  }
}

// 境界はファイルパスで決まるため、フィクスチャファイルではなくパスと内容の組で検査する。
const orpc = `import { ORPCError } from "@orpc/server";\n`;
const router = `import { notFound, redirect } from "@tanstack/react-router";\n`;
const throwCases = [
  {
    path: "packages/api/src/index.ts",
    text: `${orpc}throw new ORPCError("UNAUTHORIZED");`,
    throws: 0,
  },
  { path: "packages/api/src/index.ts", text: `${orpc}throw new Error("x");`, throws: 1 },
  {
    path: "packages/api/src/index.ts",
    text: `class ORPCError {}\nthrow new ORPCError();`,
    throws: 1,
  },
  { path: "packages/domain/src/a.ts", text: `${orpc}throw new ORPCError("NOT_FOUND");`, throws: 1 },
  { path: "apps/web/src/routes/a.tsx", text: `${router}throw redirect({ to: "/" });`, throws: 0 },
  { path: "apps/web/src/routes/a.tsx", text: `${router}throw notFound();`, throws: 0 },
  { path: "apps/web/src/routes/a.tsx", text: `${orpc}throw new ORPCError("X");`, throws: 1 },
  {
    path: "apps/web/src/components/a.tsx",
    text: `${router}throw redirect({ to: "/" });`,
    throws: 1,
  },
  {
    path: "packages/x/src/a.ts",
    text: `// throw new Error("comment")\nconst s = "throw x";`,
    throws: 0,
  },
  { path: "packages/x/src/a.ts", text: `const f = () => {\n  throw 1;\n};`, throws: 1 },
];
for (const { path, text, throws } of throwCases) {
  const found = findThrows(path, text).length;
  if (found !== throws) {
    failures.push(
      `no-throw boundary case ${path}: expected ${throws} violation(s), got ${found}.\n${text}\n` +
        `  直し方: lint/no-throw.mjs と lint/throw-boundaries.mjs の判定を見直す。境界の追加・緩和は人間の承認が必要。`,
    );
  }
}

if (failures.length > 0) {
  console.error(`lint rule fixtures failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(
  `lint rule fixtures passed (${files.length} files, ${throwCases.length} no-throw boundary cases).`,
);
