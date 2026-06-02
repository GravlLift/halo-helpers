import { LeaderboardEntryKeys } from './leaderboard-entry';

export function determineDiscoveryInfo(
  entryA: {
    discoverySource: string;
    discoveryVersion: number;
  },
  entryB: {
    discoverySource: string;
    discoveryVersion: number;
  },
  fallback: { discovererId: string; lastVersion: number },
) {
  let discoveryInfo: {
    discoverySource: string;
    discoveryVersion: number;
  };

  if (!entryA.discoverySource && !entryB.discoverySource) {
    discoveryInfo = {
      discoverySource: fallback.discovererId,
      discoveryVersion: fallback.lastVersion + 1,
    };
  } else if (!entryB.discoverySource) {
    discoveryInfo = {
      discoverySource: entryA.discoverySource,
      discoveryVersion: entryA.discoveryVersion,
    };
  } else if (!entryA.discoverySource) {
    discoveryInfo = {
      discoverySource: entryB.discoverySource,
      discoveryVersion: entryB.discoveryVersion,
    };
  } else {
    if (entryA.discoverySource > entryB.discoverySource) {
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
