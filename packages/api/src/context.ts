import type { UserScopedDb } from "@ai-first-ts/ai-profile/db";
import type { Session } from "@ai-first-ts/auth";

// ハンドラには生の DB を渡さない。データはログイン中のユーザーに限定した data からだけ読み書きする。
export type Context = {
  session: Session | null;
  data: UserScopedDb | null;
};
