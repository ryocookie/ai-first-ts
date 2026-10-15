// Accept `unknown` and narrow it before use.
export function parsePort(input: unknown): number | undefined {
  if (typeof input === "object" && input !== null && "port" in input) {
    return typeof input.port === "number" ? input.port : undefined;
  }
  return undefined;
}
