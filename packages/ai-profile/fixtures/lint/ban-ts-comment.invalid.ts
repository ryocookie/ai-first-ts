// expect: typescript(ban-ts-comment)
// Suppressing a type error hides the bug instead of fixing it.
// @ts-ignore
export const count: number = "1";
// @ts-expect-error
export const total: number = "2";
