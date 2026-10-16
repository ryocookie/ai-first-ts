import type { UserScopedDb } from "@ai-first-ts/ai-profile/db";
import { tag, todoTag } from "@ai-first-ts/db/schema/tag";
import { todo } from "@ai-first-ts/db/schema/todo";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DEFAULT_TAG_COLOR, normalizeTagName, validateColor } from "../domain/tag";
import { protectedProcedure } from "../index";

const link = z.object({ todoId: z.string().min(1), tagId: z.string().min(1) });

// リンクの両端が本人の todo・tag であることを確かめ、todo_tag に書ける OwnedId にする。
// 他のユーザーの todo・tag は存在しない場合と同じく NOT_FOUND（他人の id の存在を漏らさない）。
async function ownedLink(data: UserScopedDb, input: z.infer<typeof link>) {
  const todoId = await data.own(todo, input.todoId);
  const tagId = await data.own(tag, input.tagId);
  if (!todoId.ok || !tagId.ok) {
    const failed = todoId.ok ? tagId : todoId;
    const code =
      !failed.ok && failed.error.type === "NotOwned" ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR";
    throw new ORPCError(code);
  }
  return { todoId: todoId.value, tagId: tagId.value };
}

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

  attach: protectedProcedure.input(link).handler(async ({ context, input }) => {
    const { todoId, tagId } = await ownedLink(context.data, input);
    const links = await context.data.select(
      todoTag,
      and(eq(todoTag.todoId, todoId), eq(todoTag.tagId, tagId)),
    );
    if (!links.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    // 付け直しは何もしない（冪等）。
    if (links.value.length === 0) {
      const added = await context.data.insert(todoTag, {
        userId: context.data.userId,
        todoId,
        tagId,
      });
      if (!added.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
    }
    return input;
  }),

  detach: protectedProcedure.input(link).handler(async ({ context, input }) => {
    const { todoId, tagId } = await ownedLink(context.data, input);
    const removed = await context.data.delete(
      todoTag,
      and(eq(todoTag.todoId, todoId), eq(todoTag.tagId, tagId)),
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
