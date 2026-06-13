import { SkillProp } from '../skill-prop';
import type { LeaderboardEntry } from './leaderboard-entry';

export interface ILeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> {
  initialized: () => Promise<boolean>;
  addLeaderboardEntries(entries: TEntry[]): Promise<TEntry[]>;
  getGamertagIndex(
    xuid: string,
    playlistAssetId: string,
    skillProp: SkillProp,
    signal?: AbortSignal
  ): Promise<number>;
  getSkillBuckets(
    playlistAssetId: string,
    skillProp: SkillProp
  ): Promise<Map<number, number>>;
  getRankedEntries(
    playlistAssetId: string,
    options: {
      offset: number;
      limit: number;
    },
    skillProp: SkillProp
  ): Promise<(TEntry & { rank: number })[]>;
  getPlaylistEntriesCount(playlistAssetId: string): Promise<number>;
  getPlaylistAssetIds(): Promise<string[]>;
}
