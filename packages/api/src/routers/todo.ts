import { todo } from "@ai-first-ts/db/schema/todo";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { tag, todoTag } from "@ai-first-ts/db/schema/tag";

import { attachTags, filterByTag, isOverdue } from "../domain/tag";
import { summarizeTodos } from "../domain/todo";
import { protectedProcedure } from "../index";

// データは context.data（ログイン中のユーザーに限定したアクセサ）からだけ読み書きする。
// where に書くのは絞り込み条件だけで、所有者の条件（userId = ログイン中のユーザー）は data が必ず付ける。
export const todoRouter = {
  list: protectedProcedure
    .input(z.object({ tagId: z.string().optional() }).optional())
    .handler(async ({ context, input }) => {
      const todos = await context.data.select(todo);
      const tags = await context.data.select(tag);
      const links = await context.data.select(todoTag);
      if (!todos.ok || !tags.ok || !links.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      const withTags = attachTags(todos.value, links.value, tags.value).map((t) => ({
        ...t,
        overdue: isOverdue(t, new Date()),
      }));
      return input?.tagId ? filterByTag(withTags, input.tagId) : withTags;
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
        dueAt: z.coerce.date().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const id = crypto.randomUUID();
      const added = await context.data.insert(todo, {
        id,
        userId: context.data.userId,
        title: input.title,
        dueAt: input.dueAt ?? null,
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
