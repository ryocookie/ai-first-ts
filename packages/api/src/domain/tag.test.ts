import { describe, expect, test } from "bun:test";

import { attachTags, filterByTag, isOverdue, normalizeTagName, validateColor } from "./tag";

describe("normalizeTagName", () => {
  test("trims and lowercases", () => {
    expect(normalizeTagName("  Work ")).toEqual({ ok: true, value: "work" });
  });
  test("rejects empty names", () => {
    expect(normalizeTagName("   ")).toMatchObject({ ok: false, error: { type: "InvalidTag" } });
  });
});

describe("validateColor", () => {
  test("accepts #rrggbb", () => {
    expect(validateColor("#a1B2c3")).toEqual({ ok: true, value: "#a1B2c3" });
  });
  test("rejects anything else", () => {
    expect(validateColor("red")).toMatchObject({ ok: false });
    expect(validateColor("#fff")).toMatchObject({ ok: false });
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  test("past due and not completed", () => {
    expect(isOverdue({ id: "a", completed: false, dueAt: new Date("2026-10-15") }, now)).toBe(true);
  });
  test("completed, future or no due date is not overdue", () => {
    expect(isOverdue({ id: "a", completed: true, dueAt: new Date("2026-10-15") }, now)).toBe(false);
    expect(isOverdue({ id: "a", completed: false, dueAt: new Date("2026-10-17") }, now)).toBe(
      false,
    );
    expect(isOverdue({ id: "a", completed: false, dueAt: null }, now)).toBe(false);
  });
});

describe("attachTags / filterByTag", () => {
  const work = { id: "t1", name: "work", color: "#000000" };
  const home = { id: "t2", name: "home", color: "#ffffff" };
  const tags = [work, home];
  const links = [
    { todoId: "a", tagId: "t1" },
    { todoId: "b", tagId: "t2" },
    { todoId: "b", tagId: "missing" },
  ];
  test("attaches known tags and drops unknown ones", () => {
    const result = attachTags([{ id: "a" }, { id: "b" }, { id: "c" }], links, tags);
    expect(result).toEqual([
      { id: "a", tags: [work] },
      { id: "b", tags: [home] },
      { id: "c", tags: [] },
    ]);
    expect(filterByTag(result, "t2").map((t) => t.id)).toEqual(["b"]);
  });
});
