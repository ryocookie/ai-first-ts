# 既存のリポジトリにプロファイルを導入する

新しく作るなら [docs/template.md](template.md)（テンプレートから作る）が簡単。既に動いているプロダクトには、`init` で段階的に導入する。
既存のコードは入れた瞬間に大量の違反が出るため、次の 3 つで「今より悪くしない」状態から始める。

- **既存の設定は上書きしない。** tsconfig・CODEOWNERS・lint 設定などが既にあれば、差分と追記する内容を示して止まる。反映するのは人間。
- **ベースライン方式。** 導入した時点の違反を `ai-profile.baseline.json` に記録し、それより増えた分だけを落とす。変更したファイルは、ベースラインにある違反も含めて 0 件にする。
- **層ごとの有効化。** 型・lint・テストは初日から全ファイルに掛かる。設計の移行が要る Result（throw 禁止）・Zod の境界・userScoped は、`ai-profile.config.json` で層（glob）ごとに有効にする。

## 取得と実行

npm には公開していない。`bunx ai-profile` のような名前で実行すると、第三者が同じ名前で npm に置いたパッケージが実行されうる（slopsquatting）ため、このリポジトリを特定のコミットで取得して実行する。

```bash
git clone https://github.com/ryocookie/ai-first-ts /tmp/ai-first-ts
git -C /tmp/ai-first-ts checkout <コミット>      # 導入するプロファイルの版。設定の profile.commit に記録される
cd /tmp/ai-first-ts && bun install --frozen-lockfile && cd -

# 導入先のリポジトリのルートで
bun /tmp/ai-first-ts/packages/ai-profile/adopt/init.mjs --owner @your-org/your-team
```

| オプション                  | 意味                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `--owner <@user/@org/team>` | CODEOWNERS の所有者。CODEOWNERS がまだないときは必須（リポジトリへの書き込み権限が要る）  |
| `--package-manager <pm>`    | `bun` / `npm` / `pnpm` / `yarn`。既定は `packageManager` と lockfile から判定する         |
| `--tsconfig <path>`         | 厳格系オプションを持たせる基準の tsconfig。既定は `tsconfig.base.json` か `tsconfig.json` |
| `--update`                  | プロファイル本体と guard を、取得したコミットのものに置き換える（更新）                   |
| `--dry-run`                 | 何も書かずに、することだけを表示する                                                      |

前提: 導入先は git リポジトリのルートに `package.json` がある TypeScript のリポジトリ。検査は bun で実行する（アプリのパッケージマネージャは npm・pnpm・yarn のままでよい）。

## 手順

1. **1 回目の `init`。** 無いファイルを足し、既存のファイルへの変更は示して止まる（終了コード 1）。主に示されるもの:
   - 基準の tsconfig で true にする厳格系オプション（`strict`・`noUncheckedIndexedAccess` など。増える型エラーは導入時の分がベースラインに入る）。
     ただし `tsconfig.json` が既に `strict: true` で、足りないのが追加の厳格系オプションだけなら、`tsconfig.json` は変えずに、それを extends して厳格系オプションを持つ `tsconfig.ai-profile.json` を作って基準にする。アプリのビルド（`next build` など）は今の型チェックのままで、増えた型エラーで落ちない。`strict` まで無いときは、型情報付きの lint（tsgolint は各ファイルに一番近い `tsconfig.json` しか使えない）が正しく働かないため、`tsconfig.json` 自体を厳格にする
   - ESLint の設定に、プロファイル本体（`packages/ai-profile/**`）を検査しない指定（本体は導入先の ESLint の規約では書かれていない）
   - `devDependencies` に足す `typescript`・`oxlint`・`oxlint-tsgolint`・`oxfmt`
   - 型チェックする tsconfig がプロファイル本体（`packages/ai-profile/`）を含むとき（`"include": ["**/*.ts"]` など）、`exclude` に足す行。本体は導入先の依存では型チェックできず、アプリの tsc やビルドが落ちる
   - 既存の CODEOWNERS に追記する、ゲートファイルの所有者の行
   - 既にある `.oxlintrc.json`・`.claude/settings.json`・CI との差分
2. **反映して install する。** 示された内容を反映し、依存を入れる（lockfile が更新される）。
3. **2 回目の `init`。** ゲートの検査（`gate/check.mjs`）を通し、今の違反でベースラインを作る。
4. **コミットして PR を出す。** 足したファイルはゲートファイルなので、CODEOWNERS の所有者がレビューする。
5. **ブランチ保護を設定する。** `main` に、PR 必須・Code Owners のレビュー必須・`ai-profile` チェック必須・force push 禁止（[docs/template.md の手順 3](template.md#3-github-の設定リポジトリの管理者が行う) と同じ）。

## 置かれるもの

| パス                                       | 中身                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `packages/ai-profile/`                     | プロファイル本体（lint・gate・test の検査と Result・userScoped）。手で変えない。digest で改変を検出する |
| `ai-profile.config.json`                   | 導入の設定（下の表）。ゲートファイル                                                                    |
| `ai-profile.baseline.json`                 | 導入時からある違反（ファイル → 診断コード → 件数）。ゲートファイル                                      |
| `.github/workflows/ai-profile.yml`         | CI。`gate/check.mjs` と `adopt/verify.mjs` を実行する（既存の CI はそのまま）                           |
| `.github/CODEOWNERS`                       | ゲートファイルの所有者                                                                                  |
| `.claude/settings.json`・`hooks/guard.mjs` | Claude Code の hook。allowlist 外の依存とゲートファイルの編集を止める。編集ごとに lint を検査する       |
| `.oxlintrc.json`・`.oxfmtrc.json`          | プロファイルの lint 設定と同じ内容（`gate(adopt-lint)` が一致を検査する）                               |

ESLint・Prettier の設定は残してよい（プロファイルは oxlint・oxfmt で検査する）。移行が済んだら外す。

## 設定（ai-profile.config.json）

| 項目             | 意味                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`        | 取得元・コミット・プロファイル本体の digest。`--update` が書き換える                                                                                                                                                                                                                |
| `packageManager` | guard が通すパッケージマネージャ。他のものは止める                                                                                                                                                                                                                                  |
| `tsconfig`       | 厳格系オプションを true にしておく基準の tsconfig。他の tsconfig はこれを（直接か間接に）extends する。`tsconfig.ai-profile.json` のときは逆に、それが extends する `tsconfig.json` は extends が要らず、基準が上書きするオプションは false でもよい（`strict` だけは true のまま） |
| `typecheck`      | `tsc --noEmit -p` で型チェックする tsconfig                                                                                                                                                                                                                                         |
| `test`           | テストを実行するコマンド（テストがなければ `null`）。失敗すると verify が落ちる                                                                                                                                                                                                     |
| `baseBranch`     | 「変更したファイル」を求める基準のブランチ                                                                                                                                                                                                                                          |
| `dependencies`   | 導入時からあった依存。`allowlist.json` と同じ扱いで、これ以外の追加は人間の承認制                                                                                                                                                                                                   |
| `rules`          | 層ごとに有効にするルール（下の表）。`files` は有効にする glob、`except` は理由付きの例外（境界）                                                                                                                                                                                    |

| `rules` のキー | ルール                        | 有効にするときに要るもの                                                                     |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `result`       | `ai-profile(no-throw)`        | `@ai-first-ts/ai-profile/core` の Result（下の「core を使う」）                              |
| `validation`   | `ai-profile(untrusted-input)` | core の `parseJson`・`readJson`・`validate` と zod。env を読むモジュールは `except` に入れる |
| `userScope`    | `ai-profile(user-scope)`      | Drizzle と `@ai-first-ts/ai-profile/db`。生の DB を作るモジュールは `except` に入れる        |

```json
"rules": {
  "result": {
    "files": ["src/domain/**", "src/services/**"],
    "except": [{ "files": "src/services/legacy-sdk.ts", "reason": "SDK が throw でしかエラーを返さない" }]
  },
  "validation": { "files": [], "except": [] },
  "userScope": { "files": [], "except": [] }
}
```

設定ファイルを消すと、全てのルールが全てのファイルに掛かる（緩まない）。

## ベースライン

`bun packages/ai-profile/adopt/verify.mjs`（CI も同じ）は次の順に検査する。

1. 違反を集める: 型エラー（`typecheck` の tsconfig）・lint（層ごとのルールは有効な層だけ）・フォーマット・テストの不足（`domain/` など）
2. ベースラインと比べる: ファイルごと・診断コードごとの件数が増えたら落ちる。基準のブランチから**変更したファイルは 0 件**でなければ落ちる
3. `test` のコマンドを実行する

| コマンド                       | 誰が     | すること                                                             |
| ------------------------------ | -------- | -------------------------------------------------------------------- |
| `verify.mjs`                   | AI・CI   | 検査する。`--base <ref>` で基準を指定できる                          |
| `verify.mjs --quick`           | hook     | lint だけを検査する（ファイル編集ごと）                              |
| `verify.mjs --update-baseline` | AI・人間 | 直した分だけベースラインを減らす（増やさない）                       |
| `verify.mjs --record-baseline` | 人間     | 今の違反でベースラインを作り直す（増えうる）。guard が人間に確かめる |

`gate(baseline)` は、基準のブランチのベースラインから増えたエントリを落とす。増やせるのは `ai-profile.config.json` を変える PR（層を有効にする PR）だけで、どちらのファイルも所有者がレビューする。

## 層を有効にする

1. `rules.<層>.files` に glob を足す（例: `"src/domain/**"`）。
2. `verify.mjs` を実行し、その層で数えられるようになった違反を確かめる。直せるものは直す。
3. 残りは人間が `verify.mjs --record-baseline` でベースラインに入れる。設定とベースラインを同じ PR で出す。

### core を使う（result・validation）

`@ai-first-ts/ai-profile/core` は TypeScript のソースのまま公開している。bun・Vite・tsx など TypeScript を直接読める実行環境で使う。

- **ワークスペースのあるリポジトリ（bun・pnpm・yarn）**: `packages/ai-profile` をワークスペースに入れ、使うパッケージの依存に `"@ai-first-ts/ai-profile": "workspace:*"` を足す。zod を依存に足す。
- **npm・単一パッケージ**: ルートの `package.json` に `"workspaces": ["packages/ai-profile"]` を足して install する（npm は workspace のパッケージを node_modules にリンクする）。zod を依存に足す。

## プロファイルを更新する

新しいコミットを取得し、`init.mjs --update` を実行する。プロファイル本体・guard・設定の `profile` が置き換わり、lint 設定などに差分があれば示して止まる。
新しいルールで増えた違反は、層を有効にするときと同じく人間が `--record-baseline` で入れるか、直す。

## 制約

- `extends` で npm の tsconfig（`@tsconfig/node20` など）を継承している tsconfig は、`gate(tsconfig)` が「リポジトリ内の tsconfig を指していない」と報告する。基準の tsconfig 以外は、リポジトリ内の tsconfig を extends する。
- pnpm の CI（`pnpm/action-setup`）は `package.json` の `packageManager` で版を決める。無ければ足す。
- guard は、コマンドを実行するディレクトリ（hook の cwd と `cd <dir>`）のリポジトリの設定で判定する。開発元のリポジトリのセッションから導入先で作業するときは、`cd <導入先> && npm install` の形で実行する。設定の揃っていないリポジトリは、セッションのリポジトリの設定（bun と allowlist.json）で判定する。
- ファイルに結び付かない型エラー（tsconfig の誤りなど）はベースラインにできない。直してから導入する。
- 導入先では lint のフィクスチャ（`lint/check-fixtures.mjs`）を実行しない。代わりに `.oxlintrc.json` がプロファイルの lint 設定と同じことを `gate(adopt-lint)` が検査し、ルールが効いていることは開発元のフィクスチャが保証する。
