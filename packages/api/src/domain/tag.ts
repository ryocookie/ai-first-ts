import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";

export type Tag = { id: string; name: string; color: string };
export type TodoTagLink = { todoId: string; tagId: string };
export type TodoWithDue = { id: string; completed: boolean; dueAt: Date | null };

export type InvalidTag = { type: "InvalidTag"; message: string };

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeTagName(name: string): Result<string, InvalidTag> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err({ type: "InvalidTag", message: "Tag name must not be empty" });
  }
  return ok(normalized);
}

export function validateColor(color: string): Result<string, InvalidTag> {
  if (!COLOR_RE.test(color)) {
    return err({ type: "InvalidTag", message: `Invalid color: ${color}` });
  }
  return ok(color);
}

export function isOverdue(todo: TodoWithDue, now: Date): boolean {
  return !todo.completed && todo.dueAt !== null && todo.dueAt.getTime() < now.getTime();
}

export function attachTags<T extends { id: string }>(
  todos: T[],
  links: TodoTagLink[],
  tags: Tag[],
): (T & { tags: Tag[] })[] {
  const tagById = new Map(tags.map((t) => [t.id, t]));
  return todos.map((todo) => ({
    ...todo,
    tags: links
      .filter((l) => l.todoId === todo.id)
      .map((l) => tagById.get(l.tagId))
      .filter((t): t is Tag => t !== undefined),
  }));
}

export function filterByTag<T extends { tags: Tag[] }>(todos: T[], tagId: string): T[] {
  return todos.filter((t) => t.tags.some((tag) => tag.id === tagId));
}
