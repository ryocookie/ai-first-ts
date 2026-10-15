// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
// import.meta.env is untrusted input, so validate it before exposing it as typed config.
import { z } from "zod";

import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
  VITE_SERVER_URL: z.url().parse(import.meta.env["VITE_SERVER_URL"]),
} satisfies Pick<PublicCoercedEnvSchema, "VITE_SERVER_URL">;
