// expect: ai-profile(no-throw)
// throw hides the failure from the signature; callers cannot see they must handle it.
export function parsePort(input: string): number {
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${input}`);
  }
  return port;
}
