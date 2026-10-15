// .oxlintrc.json が禁止ルールを強制し続けていることを検査する:
// HINTS の各ルールに fixtures/lint/<rule>.invalid.ts と <rule>.valid.ts があり、
// invalid は先頭の `// expect: <code>` のルールだけで失敗し、valid は診断ゼロであること。
// 同じ違反を複数のルールが捕まえる場合は、2行目の `// also: <code>, <code>` に列挙する（列挙したものも必須）。
// あわせて、throw の境界（throw-boundaries.mjs）・外部入力の境界（untrusted-boundaries.mjs）・
// データアクセスの境界（data-access-boundaries.mjs）が許可する範囲を表形式のケースで検査する。
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { HINTS } from "./hints.mjs";
import { findThrows } from "./no-throw.mjs";
import { lint, repoRoot } from "./oxlint.mjs";
import { findUntrustedInput } from "./untrusted-input.mjs";
import { findUnscopedDataAccess } from "./user-scope.mjs";

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
  const also = /^.*\n\/\/ also: (.+)/.exec(readFileSync(join(fixtureDir, name), "utf8"));
  const required = [expected, ...(also?.[1].split(",").map((c) => c.trim()) ?? [])];
  const unexpected = codes.filter((c) => !required.includes(c));
  if (required.some((c) => !codes.includes(c)) || unexpected.length > 0) {
    const got = codes.length > 0 ? codes.join(", ") : "no diagnostics";
    failures.push(
      `${name}: expected only ${required.join(", ")} but got ${got}.\n` +
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
  { path: "packages/x/src/a.ts", text: `const p = Promise.reject(new Error("x"));`, throws: 1 },
  { path: "packages/x/src/a.ts", text: `const p = (Promise)["reject"]("x");`, throws: 1 },
  { path: "packages/api/src/index.ts", text: `const p = Promise.reject("x");`, throws: 1 },
  {
    path: "packages/x/src/a.test.ts",
    text: `const p = Promise.reject(new Error("x"));`,
    throws: 0,
  },
  { path: "packages/x/src/a.test.ts", text: `throw new Error("x");`, throws: 1 },
  { path: "packages/x/src/a.ts", text: `const p = Promise.resolve(1);`, throws: 0 },
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

// 外部入力の境界もファイルパスで決まるため、パスと内容の組で検査する。
const untrustedCases = [
  {
    path: "apps/web/src/env.public.ts",
    text: `export const url = import.meta.env["VITE_SERVER_URL"];`,
    found: 0,
  },
  {
    path: "apps/web/src/a.ts",
    text: `export const url = import.meta.env["VITE_SERVER_URL"];`,
    found: 1,
  },
  {
    path: "apps/server/src/env.server.ts",
    text: `export { env as ENV } from "cloudflare:workers";`,
    found: 0,
  },
  {
    path: "apps/server/src/a.ts",
    text: `export { env as ENV } from "cloudflare:workers";`,
    found: 1,
  },
  { path: "apps/server/src/a.ts", text: `import { env } from "hono/adapter";`, found: 1 },
  { path: "apps/server/src/a.ts", text: `app.get("/", (c) => c.text(c.env.SECRET));`, found: 1 },
  { path: "apps/server/src/env.server.ts", text: `export const x = JSON.parse("{}");`, found: 1 },
  { path: "packages/ai-profile/core/validate.ts", text: `const x = JSON.parse(t);`, found: 0 },
  { path: "packages/ai-profile/core/validate.ts", text: `const x = process.env.A;`, found: 1 },
  { path: "packages/x/src/a.ts", text: `const body = await c.req.json<Order>();`, found: 1 },
  { path: "packages/x/src/a.ts", text: `app.get("/", (c) => c.json({ ok: true }));`, found: 0 },
  { path: "packages/x/src/a.ts", text: `const z = { any: () => 1 };\nz.any();`, found: 0 },
  {
    path: "packages/x/src/a.ts",
    text: `import { z as zod } from "zod";\nexport const S = zod.any();`,
    found: 1,
  },
  {
    path: "packages/x/src/a.ts",
    text: `// JSON.parse(text) and process.env\nconst s = "res.json()";`,
    found: 0,
  },
  {
    path: "apps/web/src/a.tsx",
    text: `const C = () => <p dangerouslySetInnerHTML={h} />;`,
    found: 1,
  },
  {
    path: "packages/x/src/a.ts",
    text: `import { sql as q } from "drizzle-orm";\nq.raw(s);`,
    found: 1,
  },
];
for (const { path, text, found } of untrustedCases) {
  const actual = findUntrustedInput(path, text).length;
  if (actual !== found) {
    failures.push(
      `untrusted-input boundary case ${path}: expected ${found} violation(s), got ${actual}.\n${text}\n` +
        `  直し方: lint/untrusted-input.mjs と lint/untrusted-boundaries.mjs の判定を見直す。境界の追加・緩和は人間の承認が必要。`,
    );
  }
}

// データアクセスの境界もファイルパスで決まるため、パスと内容の組で検査する。
const createDbImport = `import { createDb, type Database } from "@ai-first-ts/db";`;
const scopeImport = `import { userScoped } from "@ai-first-ts/ai-profile/db";`;
const userScopeCases = [
  { path: "apps/server/src/services.ts", text: createDbImport, found: 0 },
  { path: "apps/server/src/services.ts", text: scopeImport, found: 1 },
  { path: "apps/server/src/context.ts", text: scopeImport, found: 0 },
  { path: "apps/server/src/context.ts", text: createDbImport, found: 2 },
  { path: "packages/api/src/routers/a.ts", text: createDbImport, found: 2 },
  { path: "packages/db/src/index.ts", text: `import { drizzle } from "drizzle-orm/d1";`, found: 0 },
  { path: "packages/db/src/index.ts", text: `drizzle(env.DB);`, found: 0 },
  { path: "packages/db/src/todo.ts", text: `import { createDb } from "./index";`, found: 1 },
  { path: "packages/db/src/todo.ts", text: `import { createDb } from ".";`, found: 1 },
  {
    path: "packages/auth/src/index.ts",
    text: `import type { Database } from "@ai-first-ts/db";`,
    found: 0,
  },
  { path: "packages/x/src/a.ts", text: `export * from "@ai-first-ts/db";`, found: 1 },
  {
    path: "packages/x/src/a.ts",
    text: `export { createDb as c } from "@ai-first-ts/db/index";`,
    found: 1,
  },
  { path: "packages/x/src/a.ts", text: `import type { SQL } from "drizzle-orm";`, found: 0 },
  { path: "packages/x/src/a.ts", text: `import { eq, sql } from "drizzle-orm";`, found: 0 },
  {
    path: "packages/x/src/a.ts",
    text: `import { sqliteTable, text } from "drizzle-orm/sqlite-core";`,
    found: 0,
  },
  {
    path: "packages/x/src/a.ts",
    text: `import type { DrizzleD1Database } from "drizzle-orm/d1";`,
    found: 1,
  },
  {
    path: "packages/x/src/a.ts",
    text: `import { migrate } from "drizzle-orm/d1/migrator";`,
    found: 1,
  },
  {
    path: "packages/x/src/a.ts",
    text: `import type { UserScopedDb } from "@ai-first-ts/ai-profile/db";`,
    found: 0,
  },
  {
    path: "packages/ai-profile/db/index.ts",
    text: `export { userScoped } from "./user-scope";`,
    found: 0,
  },
  {
    path: "packages/ai-profile/db/testing.ts",
    text: `import { drizzle } from "drizzle-orm/sqlite-proxy";\nimport { userScoped } from "./user-scope";`,
    found: 0,
  },
  {
    path: "packages/ai-profile/db/testing.test.ts",
    text: `import { drizzle } from "drizzle-orm/sqlite-proxy";`,
    found: 1,
  },
  {
    path: "packages/ai-profile/db/other.ts",
    text: `export { userScoped } from "./index";`,
    found: 1,
  },
  {
    path: "apps/server/src/a.ts",
    text: `const rows = ENV.DB.prepare("select * from todo");`,
    found: 1,
  },
  { path: "apps/server/src/a.ts", text: `const { DB: d1 } = ENV;`, found: 1 },
  { path: "apps/server/src/a.ts", text: `const d1 = ENV["DB"];`, found: 1 },
  {
    path: "apps/server/src/a.ts",
    text: `// ENV.DB and createDb\nconst s = "drizzle-orm/d1";`,
    found: 0,
  },
];
for (const { path, text, found } of userScopeCases) {
  const actual = findUnscopedDataAccess(path, text).length;
  if (actual !== found) {
    failures.push(
      `user-scope boundary case ${path}: expected ${found} violation(s), got ${actual}.\n${text}\n` +
        `  直し方: lint/user-scope.mjs と lint/data-access-boundaries.mjs の判定を見直す。境界の追加・緩和は人間の承認が必要。`,
    );
  }
}

if (failures.length > 0) {
  console.error(`lint rule fixtures failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(
  `lint rule fixtures passed (${files.length} files, ${throwCases.length} no-throw and ` +
    `${untrustedCases.length} untrusted-input and ${userScopeCases.length} user-scope boundary cases).`,
);
