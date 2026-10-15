import { describe, expect, test } from "bun:test";

import { summarizeTodos } from "./todo";

describe("summarizeTodos", () => {
  test("todo がなければ全て 0", () => {
    expect(summarizeTodos([])).toStrictEqual({
      total: 0,
      completed: 0,
      remaining: 0,
      percentCompleted: 0,
    });
  });

  test("完了数・残り・完了率（切り捨て）を数える", () => {
    const todos = [{ completed: true }, { completed: false }, { completed: false }];
    expect(summarizeTodos(todos)).toStrictEqual({
      total: 3,
      completed: 1,
      remaining: 2,
      percentCompleted: 33,
    });
  });

  test("全て完了なら 100", () => {
    expect(summarizeTodos([{ completed: true }, { completed: true }]).percentCompleted).toBe(100);
  });
});
