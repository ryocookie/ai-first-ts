// expect: TS18048
export const firstLength = (items: string[]): number => {
  const first = items[0];
  return first.length;
};
