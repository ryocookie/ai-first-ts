// expect: typescript(no-unsafe-assignment)
// Reflect.get returns `any`, so the annotation is an unchecked promise about the shape.
type Config = { port: number };

export function readConfig(source: object): Config {
  const config: Config = Reflect.get(source, "config");
  return config;
}
