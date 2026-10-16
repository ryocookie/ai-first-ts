import { tag, todoTag } from "@ai-first-ts/db/schema/tag";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeTagName, validateColor } from "../domain/tag";
import { protectedProcedure } from "../index";

export const tagRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const tags = await context.data.select(tag);
    if (!tags.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }
    return tags.value;
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string(), color: z.string().optional() }))
    .handler(async ({ context, input }) => {
      const name = normalizeTagName(input.name);
      const color = validateColor(input.color ?? "#888888");
      if (!name.ok || !color.ok) {
        throw new ORPCError("BAD_REQUEST");
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

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const removed = await context.data.delete(tag, eq(tag.id, input.id));
      if (!removed.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { id: input.id };
    }),

  attach: protectedProcedure
    .input(z.object({ todoId: z.string(), tagId: z.string() }))
    .handler(async ({ context, input }) => {
      const added = await context.data.insert(todoTag, {
        userId: context.data.userId,
        todoId: input.todoId,
        tagId: input.tagId,
      });
      if (!added.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { ok: true };
    }),

  detach: protectedProcedure
    .input(z.object({ todoId: z.string(), tagId: z.string() }))
    .handler(async ({ context, input }) => {
      const removed = await context.data.delete(
        todoTag,
        and(eq(todoTag.todoId, input.todoId), eq(todoTag.tagId, input.tagId)),
      );
      if (!removed.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { ok: true };
    }),
};
