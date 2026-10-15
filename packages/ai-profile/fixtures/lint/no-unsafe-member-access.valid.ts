// Narrow the `unknown` value before reading properties.
import { z } from "zod";

const Config = z.object({ port: z.number() });

export function logPort(text: string): void {
  const parsed = Config.safeParse(JSON.parse(text));
  if (parsed.success) {
    console.log(parsed.data.port);
  }
}
