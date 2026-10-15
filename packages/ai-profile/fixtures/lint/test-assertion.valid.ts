import { expect, test } from "bun:test";

test("adds", () => {
  expect(1 + 1).toBe(2);
});

test("checks each branch", async () => {
  expect.assertions(1);
  const value = await Promise.resolve(2);
  if (value > 1) {
    expect(value).toBe(2);
  }
});
