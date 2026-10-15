import { createAuth } from "@ai-first-ts/auth";
import { createDb } from "@ai-first-ts/db";

import { ENV, desktopOrigins } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
