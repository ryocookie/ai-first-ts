import { expect, test } from "bun:test";
import { memoryDatabase } from "@ai-first-ts/ai-profile/db/testing";

test("starts empty", () => {
  expect(memoryDatabase("create table note (id text)").rows("select * from note")).toHaveLength(0);
});
