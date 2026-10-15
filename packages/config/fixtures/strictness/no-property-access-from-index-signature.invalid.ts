// expect: TS4111 (noPropertyAccessFromIndexSignature)
// Dot access hides that the key comes from an index signature and may be missing.
const headers: Record<string, string> = {};

export const auth = headers.authorization;
