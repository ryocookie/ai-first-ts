// expect: ai-profile(test-assertion)
// A test without expect passes no matter what the code does; it only proves the code did not crash.
import { expect, test } from "bun:test";

const checks = () => {
  expect(1 + 1).toBe(2);
};

test("adds", () => {
  void (1 + 1);
});

test("delegates", checks);
