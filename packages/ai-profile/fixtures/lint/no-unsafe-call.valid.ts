// Only call values whose type says they are functions.
const handlers: Record<string, () => void> = {
  greet: () => console.log("hello"),
};

export function runHandler(name: string): void {
  handlers[name]?.();
}
