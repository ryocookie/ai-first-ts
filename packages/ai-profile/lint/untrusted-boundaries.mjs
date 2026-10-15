// 外部入力を「未検証のまま型付きで受け取る」ことを例外的に許す境界。
// ここに登録されたファイルが、その入力を検証して型付きの値として公開する唯一の場所になる。
// ここへの追加・変更は lint ルールの緩和にあたるため、変更せず提案として報告する（人間の承認制）。
// files はリポジトリルートからの相対パス（区切りは /）に対する正規表現。
// sources はこのファイルで許す入口: "env"（環境変数・バインディング）/ "json"（JSON.parse・.json()）。
export const UNTRUSTED_BOUNDARIES = [
  {
    files: /^apps\/web\/src\/env\.public\.ts$/,
    sources: ["env"],
    reason: "import.meta.env を Zod で検証し、ENV として公開する",
  },
  {
    files: /^apps\/server\/src\/env\.server\.ts$/,
    sources: ["env"],
    reason:
      "Workers の env は .env.schema（varlock）がデプロイ時に検証し、Alchemy のバインディング型で ENV として公開する",
  },
  {
    files: /^packages\/ai-profile\/core\/validate\.ts$/,
    sources: ["json"],
    reason: "parseJson の実装。JSON.parse の結果を unknown として Zod に渡す",
  },
];
