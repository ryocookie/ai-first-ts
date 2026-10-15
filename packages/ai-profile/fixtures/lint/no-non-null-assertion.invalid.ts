// expect: typescript(no-non-null-assertion)
// `!` asserts the value exists without handling the case where it does not.
export function first(items: string[]): string {
  return items.find((item) => item.length > 0)!;
}
