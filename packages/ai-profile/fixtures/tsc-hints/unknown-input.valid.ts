export const readId = (input: unknown): string | undefined =>
  typeof input === "object" && input !== null && "id" in input && typeof input.id === "string"
    ? input.id
    : undefined;
