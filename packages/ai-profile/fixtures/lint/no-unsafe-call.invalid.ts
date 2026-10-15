// expect: typescript(no-unsafe-call)
// Calling an `any` value can run anything with any arguments.
export function runHandler(source: object): void {
  Reflect.get(source, "handler")();
}
