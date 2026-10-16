import { tag, todoTag } from "@ai-first-ts/db/schema/tag";
import { todo } from "@ai-first-ts/db/schema/todo";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DEFAULT_TAG_COLOR, normalizeTagName, validateColor } from "../domain/tag";
import { protectedProcedure } from "../index";

const link = z.object({ todoId: z.string().min(1), tagId: z.string().min(1) });

export const tagRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const tags = await context.data.select(tag);
    if (!tags.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    return tags.value.map(({ id, name, color }) => ({ id, name, color }));
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().max(200), color: z.string().max(20).optional() }))
    .handler(async ({ context, input }) => {
      const name = normalizeTagName(input.name);
      if (!name.ok) {
        throw new ORPCError("BAD_REQUEST", { message: name.error.message });
      }
      const color = validateColor(input.color ?? DEFAULT_TAG_COLOR);
      if (!color.ok) {
        throw new ORPCError("BAD_REQUEST", { message: color.error.message });
      }
      const existing = await context.data.select(tag, eq(tag.name, name.value));
      if (!existing.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      if (existing.value.length > 0) {
        throw new ORPCError("CONFLICT", { message: "A tag with this name already exists." });
      }
      const id = crypto.randomUUID();
      const added = await context.data.insert(tag, {
        id,
        userId: context.data.userId,
        name: name.value,
        color: color.value,
      });
      if (!added.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { id };
    }),

  // タグを消すと、そのタグのリンクも消える（todo_tag.tag_id の外部キーが cascade）。
  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const removed = await context.data.delete(tag, eq(tag.id, input.id));
      if (!removed.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      if (removed.value === 0) {
        throw new ORPCError("NOT_FOUND");
      }
      return { id: input.id };
    }),

  // todo_tag の行は data が userId を付けるが、参照先の todo と tag の所有者までは確かめない。
  // 他のユーザーの todo・tag の id を渡されても結び付けないよう、両方が見えることを先に確かめる。
  attach: protectedProcedure.input(link).handler(async ({ context, input }) => {
    const todos = await context.data.select(todo, eq(todo.id, input.todoId));
    const tags = await context.data.select(tag, eq(tag.id, input.tagId));
    const links = await context.data.select(
      todoTag,
      and(eq(todoTag.todoId, input.todoId), eq(todoTag.tagId, input.tagId)),
    );
    if (!todos.ok || !tags.ok || !links.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    // 他のユーザーの todo・tag は data から見えないので、存在しない場合と同じく NOT_FOUND になる。
    if (todos.value.length === 0 || tags.value.length === 0) {
      throw new ORPCError("NOT_FOUND");
    }
    // 付け直しは何もしない（冪等）。
    if (links.value.length === 0) {
      const added = await context.data.insert(todoTag, {
        userId: context.data.userId,
        todoId: input.todoId,
        tagId: input.tagId,
      });
      if (!added.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
    }
    return input;
  }),

  detach: protectedProcedure.input(link).handler(async ({ context, input }) => {
    const removed = await context.data.delete(
      todoTag,
      and(eq(todoTag.todoId, input.todoId), eq(todoTag.tagId, input.tagId)),
    );
    if (!removed.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    if (removed.value === 0) {
      throw new ORPCError("NOT_FOUND");
    }
    return input;
  }),
};
