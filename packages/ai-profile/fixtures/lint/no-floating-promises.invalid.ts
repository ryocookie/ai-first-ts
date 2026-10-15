// expect: typescript(no-floating-promises)
// An unhandled promise drops its rejection silently.
async function save(): Promise<void> {}

export function onClick(): void {
  save();
}
