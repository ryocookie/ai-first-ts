// expect: typescript(no-unsafe-return)
// Returning `any` leaks an unchecked value through a typed signature.
export function readPort(source: object): number {
  return Reflect.get(source, "port");
}
