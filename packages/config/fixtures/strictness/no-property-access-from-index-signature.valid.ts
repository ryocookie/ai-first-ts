// Bracket access makes the "key may be missing" contract visible at the call site.
const headers: Record<string, string> = {};

export const auth: string | undefined = headers["authorization"];
