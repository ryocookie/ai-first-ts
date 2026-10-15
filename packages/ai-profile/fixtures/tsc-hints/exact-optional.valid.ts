type Profile = { nickname?: string };

export const toProfile = (nickname: string | undefined): Profile =>
  nickname === undefined ? {} : { nickname };
