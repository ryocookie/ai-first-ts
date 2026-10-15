// Await the promise, or mark fire-and-forget explicitly with `void`.
async function save(): Promise<void> {}

export async function onSubmit(): Promise<void> {
  await save();
}

export function onClick(): void {
  void save();
}
