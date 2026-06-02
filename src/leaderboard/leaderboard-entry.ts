import { DateTime } from 'luxon';

export enum LeaderboardEntryKeys {
  Xuid = 'xuid',
  PlaylistAssetId = 'playlistAssetId',
  GameVariantAssetId = 'gameVariantAssetId',
  Gamertag = 'gamertag',
  MatchId = 'matchId',
  MatchDate = 'matchDate',
  Csr = 'csr',
  Esr = 'esr',
}

export type LeaderboardEntry = {
  [LeaderboardEntryKeys.Xuid]: string;
  [LeaderboardEntryKeys.PlaylistAssetId]: string;
  [LeaderboardEntryKeys.GameVariantAssetId]: string;
  [LeaderboardEntryKeys.Gamertag]: string;
  [LeaderboardEntryKeys.MatchId]: string;
  [LeaderboardEntryKeys.MatchDate]: number;
  [LeaderboardEntryKeys.Csr]: number;
  [LeaderboardEntryKeys.Esr]: number;
};

export function entryIsValidNoUserInfo(
  entry: Omit<
    LeaderboardEntry,
    LeaderboardEntryKeys.Xuid | LeaderboardEntryKeys.Gamertag
  > | null,
): entry is Omit<
  LeaderboardEntry,
  LeaderboardEntryKeys.Xuid | LeaderboardEntryKeys.Gamertag
> {
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
