# テンプレートから新しいリポジトリを始める

このリポジトリは GitHub のテンプレートリポジトリとして使える。「Use this template」で作ったリポジトリは、
ファイル（`packages/ai-profile`・`.claude/` の guard・`.github/` の CI と CODEOWNERS・tsconfig・lint 設定）をそのまま引き継ぐ。
ただし **GitHub の設定（ブランチ保護など）はコピーされない**。下の手順 1〜3 を終えるまで、CI は落ちても止められない「助言」でしかない。

## 作った直後にやること

### 1. 置き換える（必須）

| 場所                                                                 | 今の値                 | 置き換え先                                                                     | 置き換えないと                                                                                                  |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `.github/CODEOWNERS` の全行                                          | `@ryocookie`           | 新しいリポジトリでゲートファイルをレビューする人かチーム（書き込み権限が必要） | 所有者が無効になり、ゲートファイルの変更がレビューなしでマージできる。GitHub は無効な所有者を警告なしに無視する |
| `packages/infra/alchemy.run.ts` の `Alchemy.Stack("ai-first-ts", …)` | `ai-first-ts`          | プロダクト名                                                                   | 同じ Cloudflare アカウントにこのテンプレートの別プロダクトがあると、Worker と D1 が同じ名前でぶつかる           |
| `CLAUDE.md` の見出しと「目的」                                       | プロファイル開発の説明 | 新しいプロダクトの目的                                                         | AI が「`apps/` は検証用サンプル」という前提で作業し続ける                                                       |
| `README.md` の見出し                                                 | `ai-first-ts`          | プロダクト名                                                                   | 見た目だけ                                                                                                      |

CODEOWNERS の置き換え漏れは、`bun run verify` と CI の `gate(template)` が検出して落とす。リポジトリ名は、CI では `GITHUB_REPOSITORY` から、手元では `origin` の URL から読む。

ルート `package.json` の `"name"` は変えてよい（どこからも参照されていない）。

### 2. 置き換えない

- **パッケージのスコープ `@ai-first-ts/*`**。guard（`.claude/hooks/guard.mjs`）・ゲート（`gate/deps.mjs`・`gate/scripts.mjs`）・lint ルール（`lint/user-scope.mjs` など）が
  このスコープでワークスペースのパッケージと境界を判定している。スコープを変えるとこれらのゲートファイルも変える必要があり、ゲートが緩む危険がある。
  スコープは `private` なワークスペース内の名前で、公開されないため変える必要はない。
- `packages/ai-profile/` の中身・`allowlist.json`・`tsconfig.base.json`・lint/format 設定。プロファイルのアップデートを取り込みやすくするため、手で変えない。

### 3. GitHub の設定（リポジトリの管理者が行う）

Settings → Rules → Rulesets（またはBranches → Branch protection rules）で `main` に次を設定する。

- Require a pull request before merging
  - Require review from Code Owners
- Require status checks to pass: `verify`（`.github/workflows/verify.yml` のジョブ。一度 PR で CI を走らせると候補に出る）
- Block force pushes

一人で開発する場合、自分の PR を自分で Code Owner として承認することはできない。
管理者を ruleset の bypass に入れるか、ゲートファイルの変更だけ別アカウントで承認する。

### 4. 手元の準備

```bash
bun install
bunx lefthook install   # pre-commit で oxlint / oxfmt を走らせる（Claude Code は SessionStart hook で自動実行）
bun run verify          # 全ゲートが通ることを確認する
```

`.env` は `apps/server/.env.schema`・`apps/web/.env.schema`・`packages/infra/.env.schema` を見て作る（`.env` はコミットしない）。

## サンプルアプリ（todo）

`apps/` と `packages/api`・`packages/db` の todo とタグは、プロファイルのルールを全部適用した書き方の見本として残してある。
自分のドメインを書き始めたら、次をまとめて消すか置き換える。

- `packages/db/src/schema/todo.ts`・`tag.ts` と、`schema/index.ts` の export
- `packages/api/src/routers/todo.ts`・`tag.ts`・`packages/api/src/domain/` とそれぞれのテスト、`routers/index.ts` の登録
- `apps/web/src/components/todo-board.tsx` と、それを使う `apps/web/src/routes/_auth/dashboard.tsx`

消すときも `bun run verify` が通る状態を保つ。テスト必須の層（`packages/ai-profile/test/required.mjs`）にあるファイルを足すときは、テストも一緒に足す。

## プロファイルを更新する

テンプレートから作ったリポジトリはテンプレートと履歴がつながらない。プロファイルの新しいルールを取り込むときは、
このリポジトリの `packages/ai-profile/`・`.claude/`・`.github/`・`packages/config/tsconfig.base.json`・`.oxlintrc.json`・`.oxfmtrc.json`・`lefthook.yml` を
PR で上書きし、`bun run verify` で既存コードの違反を直す。これらはゲートファイルなので、CODEOWNERS の所有者がレビューする。
