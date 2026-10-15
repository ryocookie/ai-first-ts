// Receive the value as `unknown` and validate it with Zod; the result type comes from the schema.
import { z } from "zod";

const Config = z.object({ port: z.number() });

export function readConfig(source: object): z.ZodSafeParseResult<z.infer<typeof Config>> {
  const raw: unknown = Reflect.get(source, "config");
  return Config.safeParse(raw);
}
