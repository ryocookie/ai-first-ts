import { describe, expect, test } from "bun:test";

import {
  attachTags,
  filterByTag,
  isOverdue,
  normalizeTagName,
  TAG_NAME_MAX,
  utcDate,
  validateColor,
} from "./tag";

describe("normalizeTagName", () => {
  test("前後の空白を除いて小文字にする", () => {
    expect(normalizeTagName("  Work ")).toEqual({ ok: true, value: "work" });
  });
  test("空・長すぎる名前は InvalidTag", () => {
    expect(normalizeTagName("   ")).toMatchObject({ ok: false, error: { type: "InvalidTag" } });
    expect(normalizeTagName("x".repeat(TAG_NAME_MAX))).toMatchObject({ ok: true });
    expect(normalizeTagName("x".repeat(TAG_NAME_MAX + 1))).toMatchObject({
      ok: false,
      error: { type: "InvalidTag" },
    });
  });
});

describe("validateColor", () => {
  test("#rrggbb だけを小文字にして通す", () => {
    expect(validateColor("#A1B2c3")).toEqual({ ok: true, value: "#a1b2c3" });
  });
  test("それ以外（CSS に混ぜられる文字列を含む）は InvalidTag", () => {
    for (const color of ["red", "#fff", "#1122334", "#112233;background:url(x)"]) {
      expect(validateColor(color)).toMatchObject({ ok: false, error: { type: "InvalidTag" } });
    }
  });
});

describe("utcDate / isOverdue", () => {
  test("utcDate は UTC の暦日", () => {
    expect(utcDate(new Date("2026-10-16T23:30:00+09:00"))).toBe("2026-10-16");
    expect(utcDate(new Date("2026-10-16T08:30:00+09:00"))).toBe("2026-10-15");
  });
  test("期限日の当日中は期限切れにしない（翌日から期限切れ）", () => {
    const due = { completed: false, dueOn: "2026-10-16" };
    expect(isOverdue(due, "2026-10-16")).toBe(false);
    expect(isOverdue(due, "2026-10-17")).toBe(true);
  });
  test("完了済み・期限なしは期限切れにしない", () => {
    expect(isOverdue({ completed: true, dueOn: "2000-01-01" }, "2026-10-16")).toBe(false);
    expect(isOverdue({ completed: false, dueOn: null }, "2026-10-16")).toBe(false);
  });
});

describe("attachTags / filterByTag", () => {
  const work = { id: "t1", name: "work", color: "#000000" };
  const home = { id: "t2", name: "home", color: "#ffffff" };
  const links = [
    { todoId: "a", tagId: "t1" },
    { todoId: "b", tagId: "t2" },
    { todoId: "b", tagId: "missing" },
  ];
  test("一覧にあるタグだけを付け、タグで絞り込める", () => {
    const result = attachTags([{ id: "a" }, { id: "b" }, { id: "c" }], links, [work, home]);
    expect(result).toEqual([
      { id: "a", tags: [work] },
      { id: "b", tags: [home] },
      { id: "c", tags: [] },
    ]);
    expect(filterByTag(result, "t2").map((t) => t.id)).toEqual(["b"]);
    expect(filterByTag(result, "missing")).toEqual([]);
  });
});
