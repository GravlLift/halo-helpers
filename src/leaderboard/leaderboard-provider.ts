import { Observable } from 'rxjs';
import { SkillProp } from '../skill-prop';
import type { LeaderboardEntry } from './leaderboard-entry';

interface BaseLeaderboardProvider {
  initialized: () => Promise<boolean>;
}

export interface ReadOnlyLeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> extends BaseLeaderboardProvider {
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
      page: number;
    },
    skillProp: SkillProp
  ): Promise<(TEntry & { rank: number })[]>;
  getPlaylistEntriesCount(playlistAssetId: string): Promise<number>;
  getPlaylistAssetIds(): Promise<string[]>;
}

export interface ObservableLeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> extends ReadOnlyLeaderboardProvider<TEntry> {
  newEntries$: Observable<TEntry[]>;
}

export interface IWriteLeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> extends BaseLeaderboardProvider {
  addLeaderboardEntries(entries: TEntry[]): Promise<TEntry[]>;
}

export type ReadWriteLeaderboardProvider<
  TEntry extends LeaderboardEntry = LeaderboardEntry,
> = ReadOnlyLeaderboardProvider<TEntry> & IWriteLeaderboardProvider<TEntry>;
