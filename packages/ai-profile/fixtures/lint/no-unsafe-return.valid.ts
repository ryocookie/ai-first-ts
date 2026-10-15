// Return the value only after validating it.
import { z } from "zod";

export function readPort(source: object): number | undefined {
  const parsed = z.number().safeParse(Reflect.get(source, "port"));
  return parsed.success ? parsed.data : undefined;
}
