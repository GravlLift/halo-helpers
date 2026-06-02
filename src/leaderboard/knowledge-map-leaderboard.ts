import type { ILeaderboardProvider } from './leaderboard-provider';
import type { KnowledgeMapLeaderboardEntry } from './entry';

export type KnowledgeMapLeaderboardProvider =
  ILeaderboardProvider<KnowledgeMapLeaderboardEntry> & {
    getCurrentKnowledge: () => Promise<Map<string, number>>;
    getDeltaEntries(
      knowledges: Record<string, number>,
    ): Promise<KnowledgeMapLeaderboardEntry[]>;
    getDiscovererId: () => Promise<string>;
  };
