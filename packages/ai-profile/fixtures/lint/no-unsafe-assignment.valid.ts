// Validate the parsed value with Zod; the result type comes from the schema.
import { z } from "zod";

const Config = z.object({ port: z.number() });

export function readConfig(text: string): z.ZodSafeParseResult<z.infer<typeof Config>> {
  const parsed: unknown = JSON.parse(text);
  return Config.safeParse(parsed);
}
