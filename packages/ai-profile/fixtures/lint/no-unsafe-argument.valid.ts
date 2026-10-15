// Validate first, then pass the typed value.
import { z } from "zod";

function double(value: number): number {
  return value * 2;
}

export function doubleInput(text: string): number | undefined {
  const parsed = z.number().safeParse(JSON.parse(text));
  return parsed.success ? double(parsed.data) : undefined;
}
