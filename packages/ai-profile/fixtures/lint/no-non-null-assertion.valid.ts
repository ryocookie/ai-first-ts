// Handle the missing case explicitly.
export function first(items: string[]): string | undefined {
  const found = items.find((item) => item.length > 0);
  if (found === undefined) {
    return undefined;
  }
  return found;
}
