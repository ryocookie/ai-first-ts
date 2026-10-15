// expect: TS7030 (noImplicitReturns)
// The `false` path falls off the end and silently returns undefined.
export function label(isAdmin: boolean) {
  if (isAdmin) {
    return "admin";
  }
}
