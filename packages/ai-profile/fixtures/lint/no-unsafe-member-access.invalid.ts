// expect: typescript(no-unsafe-member-access)
// Reading a property of an `any` value is never checked.
export function logPort(source: object): void {
  console.log(Reflect.get(source, "config").port);
}
