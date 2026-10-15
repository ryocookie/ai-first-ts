// 生の DB（drizzle のインスタンス・createDb・Database 型・D1 バインディング）と、
// ユーザースコープのアクセサを作る userScoped を例外的に扱える境界。
// ここに登録されたファイル以外は、@ai-first-ts/ai-profile/db の UserScopedDb（ログイン中のユーザーに限定済み）
// を受け取ってデータに触れる。
// ここへの追加・変更は lint ルールの緩和にあたるため、変更せず提案として報告する（人間の承認制）。
// files はリポジトリルートからの相対パス（区切りは /）に対する正規表現。
// sources はこのファイルで許す入口: "database"（生の DB に触れる）/ "scope"（userScoped でアクセサを作る）。
export const DATA_ACCESS_BOUNDARIES = [
  {
    files: /^packages\/db\/src\/index\.ts$/,
    sources: ["database"],
    reason: "createDb の実装。D1 バインディングから drizzle のインスタンスを作る",
  },
  {
    files: /^packages\/ai-profile\/db\/user-scope\.ts$/,
    sources: ["database"],
    reason: "userScoped の実装。全てのクエリに userId の条件を付ける",
  },
  {
    files: /^packages\/ai-profile\/db\/index\.ts$/,
    sources: ["scope"],
    reason: "userScoped をパッケージの入口から公開する",
  },
  {
    files: /^packages\/auth\/src\/index\.ts$/,
    sources: ["database"],
    reason:
      "better-auth の drizzle アダプタは認証テーブル（user / session / account）を生の DB で読み書きする",
  },
  {
    files: /^apps\/server\/src\/services\.ts$/,
    sources: ["database"],
    reason: "リクエストごとに createDb で DB を作り、better-auth に渡す",
  },
  {
    files: /^apps\/server\/src\/context\.ts$/,
    sources: ["scope"],
    reason:
      "認証済みセッションのユーザー ID で userScoped を作り、oRPC のコンテキストに渡す唯一の場所",
  },
];
