// expect: typescript(no-explicit-any)
// `any` turns off type checking for everything the value touches.
export function parsePort(input: any): number {
  return input.port;
}
