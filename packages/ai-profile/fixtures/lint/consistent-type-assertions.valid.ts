// Annotate, use `satisfies`, or narrow with a runtime check. `as const` is allowed.
type Theme = "light" | "dark";

export const themes = ["light", "dark"] as const;
export const fallback: Theme = "light";
export const config = { theme: "dark" } satisfies { theme: Theme };

export function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("button") !== null;
}
