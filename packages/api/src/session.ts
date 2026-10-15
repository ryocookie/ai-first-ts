import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";
import type { UserScopedDb } from "@ai-first-ts/ai-profile/db";
import type { Session } from "@ai-first-ts/auth";

import type { Context } from "./context";

export type Unauthorized = { readonly code: "UNAUTHORIZED" };

export type Authenticated = { readonly session: Session; readonly data: UserScopedDb };

/** ログイン済みのセッションと、そのユーザーに限定したデータアクセサだけを通す。未ログインは Result の失敗として返す。 */
export function requireSession(context: Context): Result<Authenticated, Unauthorized> {
  if (context.session === null || context.data === null) {
    return err({ code: "UNAUTHORIZED" });
  }
  return ok({ session: context.session, data: context.data });
}
