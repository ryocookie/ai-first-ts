// Return the value only after validating it.
import { z } from "zod";

export function readPort(text: string): number | undefined {
  const parsed = z.number().safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : undefined;
}
