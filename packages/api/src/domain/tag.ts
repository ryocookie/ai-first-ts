// タグと期限のドメイン層。純粋関数だけで書く（ai-profile(domain-purity) が強制する）。
import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";

export type Tag = { readonly id: string; readonly name: string; readonly color: string };
export type TodoTagLink = { readonly todoId: string; readonly tagId: string };
/** 期限は YYYY-MM-DD の暦日。文字列の大小比較が日付の前後と一致する。 */
export type TodoDue = { readonly completed: boolean; readonly dueOn: string | null };

export type InvalidTag = { readonly type: "InvalidTag"; readonly message: string };

export const TAG_NAME_MAX = 32;
export const DEFAULT_TAG_COLOR = "#888888";
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** 前後の空白を除いて小文字にする。空・長すぎる名前は InvalidTag。 */
export function normalizeTagName(name: string): Result<string, InvalidTag> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err({ type: "InvalidTag", message: "Tag name must not be empty." });
  }
  if (normalized.length > TAG_NAME_MAX) {
    return err({
      type: "InvalidTag",
      message: `Tag name must be at most ${TAG_NAME_MAX} characters.`,
    });
  }
  return ok(normalized);
}

/** 色は #rrggbb だけを許す（CSS にそのまま渡すため、それ以外の文字列を通さない）。 */
export function validateColor(color: string): Result<string, InvalidTag> {
  if (!COLOR.test(color)) {
    return err({ type: "InvalidTag", message: "Color must be #rrggbb." });
  }
  return ok(color.toLowerCase());
}

/** UTC での暦日（YYYY-MM-DD）。利用者の「今日」が分からない場合の既定値に使う。 */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** 未完了で、期限日が today（YYYY-MM-DD）より前なら期限切れ。期限日の当日中は期限切れにしない。 */
export function isOverdue(todo: TodoDue, today: string): boolean {
  return !todo.completed && todo.dueOn !== null && todo.dueOn < today;
}

/** 各 todo に付いているタグを並べる。タグの一覧にないリンクは無視する。 */
export function attachTags<T extends { readonly id: string }>(
  todos: readonly T[],
  links: readonly TodoTagLink[],
  tags: readonly Tag[],
): (T & { readonly tags: readonly Tag[] })[] {
  const tagById = new Map(tags.map((t) => [t.id, t]));
  return todos.map((todo) => ({
    ...todo,
    tags: links
      .filter((l) => l.todoId === todo.id)
      .map((l) => tagById.get(l.tagId))
      .filter((t): t is Tag => t !== undefined),
  }));
}

export function filterByTag<T extends { readonly tags: readonly Tag[] }>(
  todos: readonly T[],
  tagId: string,
): T[] {
  return todos.filter((t) => t.tags.some((tag) => tag.id === tagId));
}
