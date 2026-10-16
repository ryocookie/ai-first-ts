// gate(deps): どの package.json にも allowlist.json にないパッケージを書かせない。
// .claude/hooks/guard.mjs は `bun add <pkg>` しか見られないため、package.json を直接編集して
// `bun install` する迂回を、ここ（verify と guard の両方から呼ばれる）で塞ぐ。
// 依存ファイルだけを読む純粋な検査で、node_modules がなくても動く（guard が install 前に呼ぶ）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const WORKSPACE_PREFIX = "@ai-first-ts/";
// npm レジストリ以外から取得する指定子。allowlist は npm の公開元を確認したうえでの許可なので通さない。
const NON_REGISTRY_SPEC =
  /^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|portal:|\.{0,2}\/)/;

export const DEPS_HINT =
  "allowlist.json にないパッケージは依存に書けない（slopsquatting 対策）。" +
  "package.json から外し、必要なら実装を止めてパッケージ名・用途・npm 上の公開元・代替案を報告する（allowlist の追加は人間の承認制）。";

/**
 * allowlist.json と、導入モードなら ai-profile.config.json の dependencies（導入時からあった依存）。
 * 設定もゲートファイルなので、依存を足すにはどちらにしても人間の承認が要る。
 * @param {string} root リポジトリルート
 */
export function loadAllowlist(root) {
  const allow = new Set(
    JSON.parse(readFileSync(join(root, "packages/ai-profile/allowlist.json"), "utf8")).packages,
  );
  const configPath = join(root, "ai-profile.config.json");
  if (existsSync(configPath)) {
    try {
      const { dependencies } = JSON.parse(readFileSync(configPath, "utf8"));
      for (const name of Array.isArray(dependencies) ? dependencies : []) {
        allow.add(String(name));
      }
    } catch {
      // 読めない設定は gate(adopt-config) が報告する。依存は allowlist.json の分だけを許す。
    }
  }
  return allow;
}

/** `npm:real-name@^1` のような別名指定子から実体のパッケージ名を取り出す。 */
function aliasTarget(spec) {
  const rest = spec.slice("npm:".length);
  const at = rest.indexOf("@", rest.startsWith("@") ? 1 : 0);
  return at === -1 ? rest : rest.slice(0, at);
}

/** overrides / resolutions のキー（`a/b`・`**\/@s/b`・`b@1`）から差し替え対象のパッケージ名を取り出す。 */
function overrideTarget(key) {
  const parts = key.split("/");
  const last = parts.at(-1) ?? key;
  const prev = parts.at(-2);
  const name = prev?.startsWith("@") ? `${prev}/${last}` : last;
  const at = name.indexOf("@", name.startsWith("@") ? 1 : 0);
  return at === -1 ? name : name.slice(0, at);
}

/**
 * @param {string} path リポジトリルートからの相対パス（メッセージ用）
 * @param {unknown} pkg package.json の内容
 * @param {Set<string>} allow allowlist
 */
export function findUnlistedDeps(path, pkg, allow) {
  const problems = [];
  const report = (where, message) =>
    problems.push({ code: "gate(deps)", file: path, where, message, hint: DEPS_HINT });
  const check = (where, name, spec) => {
    if (name.startsWith(WORKSPACE_PREFIX)) {
      if (typeof spec === "string" && !spec.startsWith("workspace:")) {
        report(where, `${name} はワークスペースのパッケージなので "workspace:*" で参照する。`);
      }
      return;
    }
    if (!allow.has(name)) {
      report(where, `${name} は allowlist にない。`);
    }
    if (typeof spec !== "string") {
      return;
    }
    if (spec.startsWith("npm:") && !allow.has(aliasTarget(spec))) {
      report(where, `${name} の別名先 ${aliasTarget(spec)} は allowlist にない。`);
    }
    if (NON_REGISTRY_SPEC.test(spec)) {
      report(where, `${name} が npm レジストリ以外（${spec}）を指している。`);
    }
  };
  const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isRecord(pkg)) {
    return problems;
  }

  for (const field of DEPENDENCY_FIELDS) {
    if (isRecord(pkg[field])) {
      for (const [name, spec] of Object.entries(pkg[field])) {
        check(field, name, spec);
      }
    }
  }
  // overrides / resolutions は推移的な依存の実体を差し替えられる。値がオブジェクトの場合は入れ子もたどる。
  for (const field of ["overrides", "resolutions"]) {
    const visit = (record, where) => {
      for (const [name, spec] of Object.entries(record)) {
        if (name === ".") {
          // npm の入れ子 overrides で親自身のバージョンを指す。親の名前は 1 つ上で検査済み。
          if (typeof spec === "string" && NON_REGISTRY_SPEC.test(spec)) {
            report(where, `${where} が npm レジストリ以外（${spec}）を指している。`);
          }
          continue;
        }
        if (isRecord(spec)) {
          check(where, overrideTarget(name), undefined);
          visit(spec, `${where}.${name}`);
        } else {
          check(where, overrideTarget(name), spec);
        }
      }
    };
    if (isRecord(pkg[field])) {
      visit(pkg[field], field);
    }
  }
  // trustedDependencies に入れたパッケージは install 時にスクリプトを実行できる。
  if (Array.isArray(pkg.trustedDependencies)) {
    for (const name of pkg.trustedDependencies) {
      check("trustedDependencies", String(name), undefined);
    }
  }
  const workspaces = isRecord(pkg.workspaces) ? pkg.workspaces : {};
  const catalogs = [
    ["workspaces.catalog", workspaces.catalog],
    ["catalog", pkg.catalog],
    ...Object.entries(isRecord(workspaces.catalogs) ? workspaces.catalogs : {}).map(([k, v]) => [
      `workspaces.catalogs.${k}`,
      v,
    ]),
    ...Object.entries(isRecord(pkg.catalogs) ? pkg.catalogs : {}).map(([k, v]) => [
      `catalogs.${k}`,
      v,
    ]),
  ];
  for (const [where, catalog] of catalogs) {
    if (isRecord(catalog)) {
      for (const [name, spec] of Object.entries(catalog)) {
        check(where, name, spec);
      }
    }
  }
  return problems;
}

/**
 * @param {string} root リポジトリルート
 * @param {string[]} packageJsonPaths ルートからの相対パス
 */
export function checkDeps(root, packageJsonPaths) {
  const allow = loadAllowlist(root);
  return packageJsonPaths.flatMap((path) =>
    findUnlistedDeps(path, JSON.parse(readFileSync(join(root, path), "utf8")), allow),
  );
}
