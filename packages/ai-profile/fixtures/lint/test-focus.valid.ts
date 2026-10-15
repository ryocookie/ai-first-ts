import { describe, expect, test } from "bun:test";

describe("price", () => {
  test("rounds to cents", () => {
    expect(Math.round(1.25 * 100)).toBe(125);
  });
  test.each([1, 2])("doubles %d", (n) => {
    expect(n * 2).toBe(n + n);
  });
});
