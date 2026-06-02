import type { LeaderboardEntry } from './leaderboard-entry';

export interface ILeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> {
  initialized: () => Promise<boolean>;
  addLeaderboardEntries(entries: TEntry[]): Promise<TEntry[]>;
  getAllEntries(): Promise<TEntry[]>;
  getRandomEntry(): Promise<TEntry | undefined>;
  getGamertagIndex(
    xuid: string,
    playlistAssetId: string,
    skillProp: 'csr' | 'esr',
    signal?: AbortSignal,
  ): Promise<number>;
  getSkillBuckets(
    playlistAssetId: string,
    skillProp: 'csr' | 'esr',
  ): Promise<Map<number, number>>;
  getRankedEntries(
    playlistAssetId: string,
    options: {
      offset: number;
      limit: number;
    },
    skillProp: 'csr' | 'esr',
  ): Promise<(TEntry & { rank: number })[]>;
  getPlaylistEntriesCount(playlistAssetId: string): Promise<number>;
  getPlaylistAssetIds(): Promise<string[]>;
  getEntries(xuid: string[]): Promise<
    {
      xuid: string;
      gamertag: string;
    }[]
  >;
}
