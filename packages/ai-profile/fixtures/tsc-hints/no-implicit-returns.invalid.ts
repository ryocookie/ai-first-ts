// expect: TS7030
export function label(isAdmin: boolean) {
  if (isAdmin) {
    return "admin";
  }
}
