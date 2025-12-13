import { DateTime } from 'luxon';

export type LeaderboardEntry = {
  xuid: string;
  playlistAssetId: string;
  gameVariantAssetId: string;
  gamertag: string;
  matchId: string;
  matchDate: number;
  csr: number;
  esr: number;
};

export function entryIsValidNoUserInfo(
  entry: Omit<LeaderboardEntry, 'xuid' | 'gamertag'> | null
): entry is Omit<LeaderboardEntry, 'xuid' | 'gamertag'> {
  return (
    entry != null &&
    entry.csr > -1 &&
    entry.esr !== undefined &&
    entry.matchDate > DateTime.utc().minus({ days: 7 }).toMillis() &&
    entry.matchDate < DateTime.utc().plus({ minutes: 5 }).toMillis()
  );
}

export function entryIsValid(entry: LeaderboardEntry | null) {
  return entryIsValidNoUserInfo(entry) && !!entry.xuid && !!entry.gamertag;
}
