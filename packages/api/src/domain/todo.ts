// todo のドメイン層。純粋関数だけで書く（ai-profile(domain-purity) が強制する）。
// DB の行の型は import せず、必要な項目だけの型を定義する。行はそのまま渡せる（構造的型付け）。
export type TodoStatus = { readonly completed: boolean };

export type TodoSummary = {
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
  /** 完了率（0〜100 の整数、切り捨て）。todo がなければ 0。 */
  readonly percentCompleted: number;
};

export function summarizeTodos(todos: readonly TodoStatus[]): TodoSummary {
  const total = todos.length;
  const completed = todos.filter((t) => t.completed).length;
  return {
    total,
    completed,
    remaining: total - completed,
    percentCompleted: total === 0 ? 0 : Math.floor((completed * 100) / total),
  };
}
