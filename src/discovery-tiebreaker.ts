import { LeaderboardEntry, LeaderboardEntryKeys } from './leaderboard-entry';

export function determineDiscoveryInfo(
  entryA: LeaderboardEntry,
  entryB: LeaderboardEntry,
  fallback: { discovererId: string; lastVersion: number }
) {
  let discoveryInfo: {
    [LeaderboardEntryKeys.DiscoverySource]: string;
    [LeaderboardEntryKeys.DiscoveryVersion]: number;
  };

  if (
    !entryA[LeaderboardEntryKeys.DiscoverySource] &&
    !entryB[LeaderboardEntryKeys.DiscoverySource]
  ) {
    discoveryInfo = {
      discoverySource: fallback.discovererId,
      discoveryVersion: fallback.lastVersion + 1,
    };
  } else if (!entryB[LeaderboardEntryKeys.DiscoverySource]) {
    discoveryInfo = {
      discoverySource: entryA.discoverySource,
      discoveryVersion: entryA.discoveryVersion,
    };
  } else if (!entryA[LeaderboardEntryKeys.DiscoverySource]) {
    discoveryInfo = {
      discoverySource: entryB.discoverySource,
      discoveryVersion: entryB.discoveryVersion,
    };
  } else {
    if (
      entryA[LeaderboardEntryKeys.DiscoverySource] >
      entryB[LeaderboardEntryKeys.DiscoverySource]
    ) {
      discoveryInfo = {
        discoverySource: entryA.discoverySource,
        discoveryVersion: entryA.discoveryVersion,
      };
    } else {
      discoveryInfo = {
        discoverySource: entryB.discoverySource,
        discoveryVersion: entryB.discoveryVersion,
      };
    }
  }
  return discoveryInfo;
}
