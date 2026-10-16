import { tag, todoTag } from "@ai-first-ts/db/schema/tag";
import { todo } from "@ai-first-ts/db/schema/todo";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { attachTags, filterByTag, isOverdue, utcDate } from "../domain/tag";
import { summarizeTodos } from "../domain/todo";
import { protectedProcedure } from "../index";

// データは context.data（ログイン中のユーザーに限定したアクセサ）からだけ読み書きする。
// where に書くのは絞り込み条件だけで、所有者の条件（userId = ログイン中のユーザー）は data が必ず付ける。
export const todoRouter = {
  // today は利用者の端末での今日（YYYY-MM-DD）。期限切れの判定にだけ使い、省略時は UTC の今日。
  list: protectedProcedure
    .input(
      z.object({ tagId: z.string().min(1).optional(), today: z.iso.date().optional() }).optional(),
    )
    .handler(async ({ context, input }) => {
      const todos = await context.data.select(todo);
      const tags = await context.data.select(tag);
      const links = await context.data.select(todoTag);
      if (!todos.ok || !tags.ok || !links.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      const today = input?.today ?? utcDate(new Date());
      const withTags = attachTags(todos.value, links.value, tags.value).map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        dueOn: t.dueOn,
        createdAt: t.createdAt,
        tags: t.tags,
        overdue: isOverdue(t, today),
      }));
      return input?.tagId === undefined ? withTags : filterByTag(withTags, input.tagId);
    }),

  // 集計はドメイン層の純粋関数に任せ、ここでは I/O（読み込み）とエラーへの変換だけを行う。
  summary: protectedProcedure.handler(async ({ context }) => {
    const todos = await context.data.select(todo);
    if (!todos.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    return summarizeTodos(todos.value);
  }),

  add: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        dueOn: z.iso.date().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const id = crypto.randomUUID();
      const added = await context.data.insert(todo, {
        id,
        userId: context.data.userId,
        title: input.title,
        dueOn: input.dueOn ?? null,
      });
      if (!added.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { id };
    }),

  setCompleted: protectedProcedure
    .input(z.object({ id: z.string(), completed: z.boolean() }))
    .handler(async ({ context, input }) => {
      const updated = await context.data.update(
        todo,
        { completed: input.completed },
        eq(todo.id, input.id),
      );
      if (!updated.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      // 他のユーザーの todo は data から見えないので、存在しない場合と同じく NOT_FOUND になる。
      if (updated.value === 0) {
        throw new ORPCError("NOT_FOUND");
      }
      return { id: input.id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const removed = await context.data.delete(todo, eq(todo.id, input.id));
      if (!removed.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      if (removed.value === 0) {
        throw new ORPCError("NOT_FOUND");
      }
      return { id: input.id };
    }),
};
