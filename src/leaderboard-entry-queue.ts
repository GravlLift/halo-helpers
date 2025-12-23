import { HiveMindLeaderboardProvider, wrapXuid } from '@gravllift/halo-helpers';
import { MatchSkill } from 'halo-infinite-api';
import { DateTime } from 'luxon';
import { HaloCaches } from './halo-caches/halo-caches';
import { entryIsValidNoUserInfo, LeaderboardEntry } from './leaderboard-entry';
import { skillRankCombined } from './skill-rank-helpers';

interface LeaderboardCacheEntry {
  leaderboard: HiveMindLeaderboardProvider;
}

interface EntryWithoutUserInfo extends LeaderboardCacheEntry {
  haloCaches: HaloCaches;
  entry: Omit<LeaderboardEntry, 'gamertag'>;
}

interface EntryWithUserInfo extends LeaderboardCacheEntry {
  entry: LeaderboardEntry;
}

function processEntriesWithUserInfo(
  leaderboard: LeaderboardCacheEntry['leaderboard'],
  entries: EntryWithUserInfo[]
) {
  leaderboard.addLeaderboardEntries(entries.map((e) => e.entry));
}

async function processEntriesWithoutUserInfo(entries: EntryWithoutUserInfo[]) {
  const entriesWithUserInfoOrNull = await Promise.all(
    entries.map(
      async ({
        haloCaches,
        entry,
        leaderboard,
      }): Promise<EntryWithUserInfo | null> => {
        try {
          const userInfo = await haloCaches.usersCache.get(
            wrapXuid(entry.xuid)
          );
          return {
            leaderboard,
            entry: {
              ...entry,
              xuid: userInfo.xuid,
              gamertag: userInfo.gamertag,
            },
          };
        } catch (e) {
          console.warn(`Failed to get user info for ${entry.xuid}`);
          return null;
        }
      }
    )
  );

  const entriesWithUserInfo = new Map<
    LeaderboardCacheEntry['leaderboard'],
    EntryWithUserInfo[]
  >();
  for (const entry of entriesWithUserInfoOrNull) {
    if (entry == null) {
      continue;
    }

    const leaderboardEntries = entriesWithUserInfo.get(entry.leaderboard) ?? [];
    leaderboardEntries.push(entry);
    entriesWithUserInfo.set(entry.leaderboard, leaderboardEntries);
  }

  for (const [leaderboard, entries] of entriesWithUserInfo) {
    processEntriesWithUserInfo(leaderboard, entries);
  }
}

export async function queueLeaderboardEntryForProcessing(
  haloCaches: HaloCaches,
  leaderboard: LeaderboardCacheEntry['leaderboard'],
  entries: {
    xuid: string;
    matchSkill: MatchSkill;
    matchInfo: {
      endTime: string;
      playlistAssetId: string;
      gameVariantAssetId: string;
      matchId: string;
    };
  }[]
) {
  const entriesWithoutUserInfo: EntryWithoutUserInfo[] = [];
  const entriesWithUserInfo: EntryWithUserInfo[] = [];

  const leaderboardEntriesPromise = leaderboard
    .getEntries(entries.map((e) => wrapXuid(e.xuid)))
    .catch(() => [] as LeaderboardEntry[]);

  const [discovererId, currentKnowledge] = await Promise.all([
    leaderboard.getDiscovererId(),
    leaderboard.getCurrentKnowledge(),
  ]);
  const lastVersion = currentKnowledge.get(discovererId) ?? 0;

  for (const entry of entries) {
    const esr = skillRankCombined(entry.matchSkill, 'Expected');
    if (esr == null) {
      continue;
    }

    const entryWithoutUserInfo: EntryWithoutUserInfo = {
      entry: {
        xuid: wrapXuid(entry.xuid),
        csr: entry.matchSkill.RankRecap.PostMatchCsr.Value,
        esr,
        matchDate: DateTime.fromISO(entry.matchInfo.endTime).toMillis(),
        playlistAssetId: entry.matchInfo.playlistAssetId,
        gameVariantAssetId: entry.matchInfo.gameVariantAssetId,
        matchId: entry.matchInfo.matchId,
        discoverySource: discovererId,
        discoveryVersion: lastVersion + 1,
      },
      haloCaches,
      leaderboard,
    };
    if (!entryIsValidNoUserInfo(entryWithoutUserInfo.entry)) {
      continue;
    }

    if (haloCaches.xuidCache.has(entry.xuid)) {
      // User info already in cache, won't generate any additional calls to the API
      const userInfo = await haloCaches.xuidCache.get(wrapXuid(entry.xuid));
      entriesWithUserInfo.push({
        ...entryWithoutUserInfo,
        entry: {
          ...entryWithoutUserInfo.entry,
          xuid: userInfo.xuid,
          gamertag: userInfo.gamertag,
        },
      });
      continue;
    }

    const leaderboardEntries = await leaderboardEntriesPromise;
    const leaderboardEntry = leaderboardEntries.find(
      (le) => le.xuid === wrapXuid(entry.xuid)
    );
    if (leaderboardEntry) {
      // Leaderboard has info for this user
      entriesWithUserInfo.push({
        ...entryWithoutUserInfo,
        entry: {
          ...entryWithoutUserInfo.entry,
          xuid: leaderboardEntry.xuid,
          gamertag: leaderboardEntry.gamertag,
        },
      });
      continue;
    }

    // User info not on this machine, will generate additional calls to the API
    entriesWithoutUserInfo.push(entryWithoutUserInfo);
  }

  if (entriesWithoutUserInfo.length) {
    processEntriesWithoutUserInfo(entriesWithoutUserInfo);
  }

  processEntriesWithUserInfo(leaderboard, entriesWithUserInfo);

  const entriesToProcess =
    entriesWithUserInfo.length + entriesWithoutUserInfo.length;
  if (entriesToProcess > 0) {
    console.debug(`Processing ${entriesToProcess} leaderboard entries.`);
  }
}
