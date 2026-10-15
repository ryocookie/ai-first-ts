// expect: ai-profile(test-only)
// testing.ts can create a data accessor for any userId; production code must not reach it.
import { memoryDatabase } from "@ai-first-ts/ai-profile/db/testing";

export const db = memoryDatabase("create table note (id text)");
