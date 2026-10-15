// Narrow the `unknown` value before reading properties.
import { z } from "zod";

const Config = z.object({ port: z.number() });

export function logPort(source: object): void {
  const parsed = Config.safeParse(Reflect.get(source, "config"));
  if (parsed.success) {
    console.log(parsed.data.port);
  }
}
