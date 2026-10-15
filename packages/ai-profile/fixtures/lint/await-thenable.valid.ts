// Await only promises; call synchronous functions directly.
function load(): number {
  return 1;
}

async function fetchCount(): Promise<number> {
  return 1;
}

export async function run(): Promise<number> {
  return load() + (await fetchCount());
}
