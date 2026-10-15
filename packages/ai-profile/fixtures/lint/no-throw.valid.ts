// Return the failure as a Result; the caller must check `ok` before using the value.
import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";

export type InvalidPort = { readonly type: "InvalidPort"; readonly input: string };

export function parsePort(input: string): Result<number, InvalidPort> {
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err({ type: "InvalidPort", input });
  }
  return ok(port);
}
