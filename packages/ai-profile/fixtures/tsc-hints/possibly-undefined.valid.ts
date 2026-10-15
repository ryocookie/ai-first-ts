export const firstLength = (items: string[]): number => {
  const first = items[0];
  if (first === undefined) return 0;
  return first.length;
};
