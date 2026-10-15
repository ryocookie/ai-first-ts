export function label(isAdmin: boolean): string {
  if (isAdmin) {
    return "admin";
  }
  return "member";
}
