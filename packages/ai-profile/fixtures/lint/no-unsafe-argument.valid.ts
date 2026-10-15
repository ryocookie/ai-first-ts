// Validate first, then pass the typed value.
import { z } from "zod";

function double(value: number): number {
  return value * 2;
}

export function doublePort(source: object): number | undefined {
  const parsed = z.number().safeParse(Reflect.get(source, "port"));
  return parsed.success ? double(parsed.data) : undefined;
}
