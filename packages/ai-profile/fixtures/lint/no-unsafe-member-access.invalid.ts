// expect: typescript(no-unsafe-member-access)
// Reading a property of an `any` value is never checked.
export function logPort(text: string): void {
  console.log(JSON.parse(text).port);
}
