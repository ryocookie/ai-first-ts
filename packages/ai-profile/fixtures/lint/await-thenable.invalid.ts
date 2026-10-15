// expect: typescript(await-thenable)
// Awaiting a non-promise suggests a wrong assumption about the API.
function load(): number {
  return 1;
}

export async function run(): Promise<number> {
  return await load();
}
