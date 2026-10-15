import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { requireSession } from "./session";

export const o = os.$context<Context>();

export const publicProcedure = o;

// oRPC の境界: 判定は requireSession（Result）で行い、失敗をここで ORPCError に変換する。
const requireAuth = o.middleware(async ({ context, next }) => {
  const authenticated = requireSession(context);
  if (!authenticated.ok) {
    throw new ORPCError(authenticated.error.code);
  }
  return next({
    context: authenticated.value,
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
