// テストの検査と実行（verify から呼ぶ）。
//   1. ai-profile(test-required) が効いていることを表形式のケース（違反例・正しい例）で確かめる
//   2. ロジックを持つ層のファイルにテストがあることを検査する
//   3. bun:test を使う全てのファイルを `bun test` で実行する（名前が *.test.ts でなくても漏らさない）
// skip / only・expect のないテスト・テスト専用モジュールの誤用は lint（lint/test-rules.mjs）が止める。
// 使い方: bun packages/ai-profile/test/run.mjs [bun test の引数...]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HINT, findMissingTest } from "./required.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const failures = [];

// --- 1. 検査自体が効いていることを確かめる -------------------------------------
const fn = "export function total(items: readonly number[]): number {\n  return items.length;\n}\n";
const cases = [
  { path: "packages/api/src/price.ts", text: fn, tests: [], found: 1 },
  {
    path: "packages/api/src/price.ts",
    text: fn,
    tests: ["packages/api/src/price.test.ts"],
    found: 0,
  },
  {
    path: "packages/api/src/routers/a.ts",
    text: "export const a = { x: 1 };",
    tests: [],
    found: 1,
  },
  { path: "packages/ai-profile/core/a.ts", text: "export class A {}", tests: [], found: 1 },
  { path: "packages/ai-profile/db/a.ts", text: "const a = 1;\nexport { a };", tests: [], found: 1 },
  { path: "apps/web/src/domain/cart.ts", text: "export default 1;", tests: [], found: 1 },
  {
    path: "apps/web/src/domain/cart.tsx",
    text: fn,
    tests: ["apps/web/src/domain/cart.test.tsx"],
    found: 0,
  },
  {
    path: "packages/api/src/context.ts",
    text: "export type Context = { a: 1 };",
    tests: [],
    found: 0,
  },
  {
    path: "packages/ai-profile/core/index.ts",
    text: 'export { ok } from "./result";',
    tests: [],
    found: 0,
  },
  {
    path: "packages/ai-profile/db/index.ts",
    text: 'export * from "./user-scope";',
    tests: [],
    found: 0,
  },
  { path: "packages/ai-profile/db/testing.ts", text: fn, tests: [], found: 0 },
  { path: "packages/api/src/price.test.ts", text: fn, tests: [], found: 0 },
  { path: "packages/api/src/env.d.ts", text: "export declare const a: 1;", tests: [], found: 0 },
  { path: "apps/web/src/components/a.tsx", text: fn, tests: [], found: 0 },
];
for (const { path, text, tests, found } of cases) {
  const actual = findMissingTest(path, text, (p) => tests.includes(p)).length;
  if (actual !== found) {
    failures.push(
      `test-required case ${path}: expected ${found} violation(s), got ${actual}.\n${text}\n` +
        "  直し方: packages/ai-profile/test/required.mjs の判定を見直す。対象の層の縮小・除外は人間の承認が必要。",
    );
  }
}

// --- 2. リポジトリを検査する ---------------------------------------------------
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const files = listed.stdout
  .split("\0")
  .filter(
    (f) =>
      f.length > 0 && existsSync(join(root, f)) && !f.startsWith("packages/ai-profile/fixtures/"),
  );
const fileSet = new Set(files);
const read = (f) => readFileSync(join(root, f), "utf8");

for (const file of files) {
  for (const problem of findMissingTest(file, read(file), (p) => fileSet.has(p))) {
    failures.push(`${problem.file}: ${problem.code} ${problem.message}\n  直し方: ${HINT}`);
  }
}

if (failures.length > 0) {
  console.error(`test check failed: ${failures.length} problem(s).\n\n${failures.join("\n\n")}`);
  process.exit(1);
}

// --- 3. テストを実行する -------------------------------------------------------
const testFiles = files.filter(
  (f) => /\.[cm]?tsx?$/.test(f) && /from\s+["']bun:test["']/.test(read(f)),
);
if (testFiles.length === 0) {
  console.error(`test check failed: no test files.\n  直し方: ${HINT}`);
  process.exit(1);
}
const run = spawnSync(
  process.execPath,
  ["test", ...process.argv.slice(2), ...testFiles.map((f) => `./${f}`)],
  { cwd: root, stdio: "inherit" },
);
if (run.status !== 0) {
  console.error(
    "\nbun test failed.\n" +
      "  直し方: 失敗したテストの期待値と実際の値を読み、コードを直す。テストを消す・弱める・skip するのではなく、" +
      "仕様が変わった場合だけ期待値を更新する（その理由をコミットメッセージに書く）。",
  );
  process.exit(run.status ?? 1);
}
console.log(`tests passed (${testFiles.length} files, ${cases.length} test-required cases).`);
