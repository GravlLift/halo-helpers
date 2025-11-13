import type { LeaderboardEntry } from './leaderboard-entry';

export interface ILeaderboardProvider {
  initialized: () => Promise<boolean>;
  addLeaderboardEntries(
    entries: LeaderboardEntry[]
  ): Promise<LeaderboardEntry[]>;
  getAllEntries(): Promise<LeaderboardEntry[]>;
  getRandomEntry(): Promise<LeaderboardEntry | undefined>;
  getGamertagIndex(
    xuid: string,
    playlistAssetId: string,
    skillProp: 'csr' | 'esr',
    signal?: AbortSignal
  ): Promise<number>;
  getSkillBuckets(
    playlistAssetId: string,
    skillProp: 'csr' | 'esr'
  ): Promise<Map<number, number>>;
  getRankedEntries(
    playlistAssetId: string,
    options: {
      offset: number;
      limit: number;
    },
    skillProp: 'csr' | 'esr'
  ): Promise<(LeaderboardEntry & { rank: number })[]>;
  getPlaylistEntriesCount(playlistAssetId: string): Promise<number>;
  getPlaylistAssetIds(): Promise<string[]>;
  containsXuid(xuid: string): Promise<boolean>;
  getEntries(xuid: string[]): Promise<
    {
      xuid: string;
      gamertag: string;
    }[]
  >;
}
