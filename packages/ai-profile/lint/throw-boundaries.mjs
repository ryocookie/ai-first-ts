// throw を例外的に許す境界。フレームワークが throw でしか制御を返せない箇所に限る。
// ここへの追加・変更は lint ルールの緩和にあたるため、変更せず提案として報告する（人間の承認制）。
// files はリポジトリルートからの相対パス（区切りは /）に対する正規表現。
// 許可されるのは `throw <name>(...)` / `throw new <name>(...)` で、<name> が module から import されている場合だけ。
export const THROW_BOUNDARIES = [
  {
    files: /^packages\/api\/src\//,
    module: "@orpc/server",
    name: "ORPCError",
    reason: "oRPC はエラー応答を ORPCError の throw でしか返せない",
  },
  {
    files: /^apps\/web\/src\/routes\//,
    module: "@tanstack/react-router",
    name: "redirect",
    reason: "TanStack Router の beforeLoad / loader はリダイレクトを throw で返す",
  },
  {
    files: /^apps\/web\/src\/routes\//,
    module: "@tanstack/react-router",
    name: "notFound",
    reason: "TanStack Router の loader は 404 を throw で返す",
  },
];
