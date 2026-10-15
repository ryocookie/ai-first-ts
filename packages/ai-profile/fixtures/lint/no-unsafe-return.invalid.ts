// expect: typescript(no-unsafe-return)
// Returning `any` leaks an unchecked value through a typed signature.
export function readPort(text: string): number {
  return JSON.parse(text);
}
