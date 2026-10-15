// expect: ai-profile(test-focus)
// also: typescript(no-unsafe-call)
// .only silently drops every other test from the run; .skip / xit drop this one. CI stays green while nothing is checked.
// (bun-test.d.ts does not declare these, so they are also type errors and untyped calls.)
import { describe, expect, test, xit } from "bun:test";

describe.only("price", () => {
  test("rounds to cents", () => {
    expect(Math.round(1.25 * 100)).toBe(125);
  });
  test.skip("is never negative", () => {
    expect(Math.max(0, -1)).toBe(0);
  });
});

xit("is an integer", () => {
  expect(Number.isInteger(125)).toBeTrue();
});
