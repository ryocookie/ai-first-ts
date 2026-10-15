// expect: typescript(no-unsafe-argument)
// Passing `any` to a typed parameter skips the parameter's type check.
function double(value: number): number {
  return value * 2;
}

export function doubleInput(text: string): number {
  return double(JSON.parse(text));
}
