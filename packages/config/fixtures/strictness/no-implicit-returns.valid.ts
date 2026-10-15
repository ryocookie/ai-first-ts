// Every code path returns explicitly.
export function label(isAdmin: boolean): string {
  if (isAdmin) {
    return "admin";
  }
  return "member";
}
