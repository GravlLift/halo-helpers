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

export function entryIsValid(entry: LeaderboardEntry | null) {
  return (
    entry &&
    entry.csr > -1 &&
    entry.esr !== undefined &&
    entry.matchDate > DateTime.utc().minus({ days: 7 }).toMillis() &&
    entry.matchDate < DateTime.utc().plus({ minutes: 5 }).toMillis() &&
    entry.xuid &&
    entry.gamertag
  );
}
