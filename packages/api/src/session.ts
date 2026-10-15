import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";
import type { Session } from "@ai-first-ts/auth";

export type Unauthorized = { readonly code: "UNAUTHORIZED" };

/** ログイン済みのセッションだけを通す。未ログインは Result の失敗として返す。 */
export function requireSession(session: Session | null): Result<Session, Unauthorized> {
  if (session === null) {
    return err({ code: "UNAUTHORIZED" });
  }
  return ok(session);
}
