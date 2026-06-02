import { LeaderboardEntry } from '@gravllift/halo-helpers';

export type KnowledgeMapLeaderboardEntry = LeaderboardEntry & {
  discoverySource: string;
  discoveryVersion: number;
};
