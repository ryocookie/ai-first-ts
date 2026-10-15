// Omit the key when there is no value, or declare `| undefined` explicitly.
type Profile = { nickname?: string };
type Draft = { nickname?: string | undefined };

export const profile: Profile = {};
export const draft: Draft = { nickname: undefined };
