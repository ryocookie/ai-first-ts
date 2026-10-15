// expect: typescript(no-unsafe-assignment)
// JSON.parse returns `any`, so the annotation is an unchecked promise about the shape.
type Config = { port: number };

export function readConfig(text: string): Config {
  const config: Config = JSON.parse(text);
  return config;
}
