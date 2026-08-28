import type { KnowledgeMapLeaderboardEntry } from './entry';
import type { ReadWriteLeaderboardProvider } from './leaderboard-provider';

export type KnowledgeMapLeaderboardProvider =
  ReadWriteLeaderboardProvider<KnowledgeMapLeaderboardEntry> & {
    getCurrentKnowledge: () => Promise<Map<string, number>>;
    getDeltaEntries(
      knowledges: Record<string, number>
    ): Promise<KnowledgeMapLeaderboardEntry[]>;
    getDiscovererId: () => Promise<string>;
    getAllEntries(): Promise<KnowledgeMapLeaderboardEntry[]>;
    getRandomEntry(): Promise<KnowledgeMapLeaderboardEntry | undefined>;
    getEntries(xuid: string[]): Promise<
      {
        xuid: string;
        gamertag: string;
      }[]
    >;
  };
