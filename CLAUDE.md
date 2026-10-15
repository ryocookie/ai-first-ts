# ai-first-ts

## 目的

TypeScript を AI ファーストにするプロファイル（`packages/ai-profile`）を開発する。
`apps/` と `packages/` のその他は検証用のサンプルアプリであり、プロファイルの全ルールを適用した状態を常に保つ。
プロファイルの目標は「AI が書いたコードを、人間が全行を読まずに本番投入できる品質ゲートを機械強制すること」。

## スタック（変更禁止）

- Frontend: TanStack Start（`apps/web`）
- API: oRPC（`packages/api`）。データ取得は必ず oRPC クライアント経由
- HTTP: Hono on Cloudflare Workers（`apps/server`）
- DB: Drizzle + Cloudflare D1（`packages/db`）
- Auth: better-auth（`packages/auth`）
- Infra / Deploy: Alchemy（`packages/infra/alchemy.run.ts` がバインディングと環境の唯一の正）
- Env: varlock（`.env.schema` が型と必須項目の正）
- Monorepo: Turborepo + Bun workspaces / Lint: oxlint / Format: oxfmt / Git hooks: lefthook
- 検証ライブラリは Zod v4。Result は今後 `packages/ai-profile/core` に自前実装する

スタック外の技術が必要だと判断したら、実装前に理由と代替案を報告して止まる。

## コマンド

- 全検証: `bun run verify`（型チェック・lint・フォーマット）。作業完了前に必ず実行し、結果を最終報告に貼る
- 高速検証: `bun run verify:quick`（ファイル編集ごとに hook で自動実行される）
- 依存追加: `bun add <pkg>`。ただし `packages/ai-profile/allowlist.json` にないものは hook がブロックする。
  ブロックされたら回避せず、パッケージ名・用途・npm 上の公開元・代替案を報告して止まる
- デプロイ（`bun run deploy` / alchemy / wrangler）は禁止。デプロイは main マージ後に人間か CI が行う

## 強制の仕組み（変更は人間の承認制）

- `.claude/settings.json`: 破壊的操作・デプロイ・シークレット読み取りの deny、hooks の登録
- `.claude/hooks/guard.mjs`: スタック逸脱と allowlist 外の依存追加をブロック
- `.github/workflows/verify.yml`: PR と main への push で `bun run verify` を実行
- これらのファイルと `allowlist.json`、tsconfig の厳格度、lint ルールの無効化は、変更せず提案として報告する

## 構造ルール（プロファイル開発に伴い順次機械強制される）

- 外部入力（oRPC 入力・Webhook・外部 API・LLM 出力・env・Cookie・URL）は Untrusted として扱い、検証後のみ Validated
- SQL・HTML・リダイレクト・fetch などの sink には Validated のみ渡す。`sql.raw` と `dangerouslySetInnerHTML` は使わない
- ドメイン層は純粋関数。drizzle・env・fetch・`Date.now`・`Math.random` を直接 import しない
- domain / app 層で throw しない。Result を返す
- `any`・`as`・`!`・`@ts-ignore` は使わない
- データアクセスは必ずユーザースコープ付き（認可を型で強制する）

## ルール違反に当たったら

ルールを回避するコードを書かない。lint や hook のメッセージに従って直す。
ルール自体が誤っていると判断した場合は、実装を止めて理由を報告する。
