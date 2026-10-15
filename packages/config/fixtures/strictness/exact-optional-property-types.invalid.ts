// expect: TS2375 (exactOptionalPropertyTypes)
// An optional property means "may be absent", not "may be undefined".
type Profile = { nickname?: string };

export const profile: Profile = { nickname: undefined };
