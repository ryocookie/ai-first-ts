// expect: typescript(consistent-type-assertions)
// Assertions claim a type without checking it at runtime.
type User = { id: string };

export const user = structuredClone({}) as User;
export const element = <HTMLElement>document.body.firstChild;
