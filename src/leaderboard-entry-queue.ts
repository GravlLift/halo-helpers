import { HaloCaches } from './halo-caches/halo-caches';
import { wrapXuid } from '@gravllift/halo-helpers';
import { MatchSkill } from 'halo-infinite-api';
import { DateTime } from 'luxon';
import { LeaderboardEntry } from './leaderboard-entry';
import { skillRankCombined } from './skill-rank-helpers';

interface Entry {
  leaderboard: {
    containsXuid(xuid: string): Promise<boolean>;
    addLeaderboardEntries: (e: LeaderboardEntry[]) => void;
  };
  esr: number;
  matchSkill: MatchSkill;
  matchInfo: {
    startTime: string;
    playlistAssetId: string;
    gameVariantAssetId: string;
    matchId: string;
  };
}

interface EntryWithoutUserInfo extends Entry {
  haloCaches: HaloCaches;
  xuid: string;
}

interface EntryWithUserInfo extends Entry {
  userInfo: {
    xuid: string;
    gamertag: string;
  };
}

const processingQueue: EntryWithoutUserInfo[] = [];

async function processEntriesWithoutUserInfo(entries: EntryWithoutUserInfo[]) {
  const entriesWithUserInfoOrNull = await Promise.all(
    entries.map(
      async ({ haloCaches, esr, matchSkill, xuid, leaderboard, matchInfo }) => {
        try {
          return {
            userInfo: await haloCaches.usersCache.get(wrapXuid(xuid)),
            esr,
            matchSkill,
            leaderboard,
            matchInfo,
          };
        } catch (e) {
          console.warn(`Failed to get user info for ${xuid}`);
          return null;
        }
      }
    )
  );

  const entriesWithUserInfo = new Map<
    Entry['leaderboard'],
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
    leaderboard.addLeaderboardEntries(
      entries.map(({ userInfo, esr, matchSkill, matchInfo }) => ({
        xuid: userInfo.xuid,
        gamertag: userInfo.gamertag,
        esr,
        csr: matchSkill.RankRecap.PostMatchCsr.Value,
        playlistAssetId: matchInfo.playlistAssetId,
        gameVariantAssetId: matchInfo.gameVariantAssetId,
        matchId: matchInfo.matchId,
        matchDate: DateTime.fromISO(matchInfo.startTime).toMillis(),
      }))
    );
  }
}

export async function queueLeaderboardEntryForProcessing(
  haloCaches: HaloCaches,
  leaderboard: {
    containsXuid(xuid: string): Promise<boolean>;
    addLeaderboardEntries: (e: LeaderboardEntry[]) => void;
  },
  entries: {
    xuid: string;
    matchSkill: MatchSkill;
    matchInfo: {
      startTime: string;
      playlistAssetId: string;
      gameVariantAssetId: string;
      matchId: string;
    };
  }[]
) {
  const entriesReadyForProcessing: EntryWithoutUserInfo[] = [];

  for (const entry of entries) {
    const esr = skillRankCombined(entry.matchSkill, 'Expected');
    if (esr == null) {
      continue;
    }

    const entryWithoutUserInfo = {
      xuid: wrapXuid(entry.xuid),
      haloCaches,
      esr,
      matchSkill: entry.matchSkill,
      leaderboard,
      matchInfo: entry.matchInfo,
    };

    if (
      haloCaches.xuidCache.has(entry.xuid) ||
      (await leaderboard.containsXuid(entry.xuid).catch(() => false))
    ) {
      // User info already on this machine, won't generate any additional calls to the API
      entriesReadyForProcessing.push(entryWithoutUserInfo);
    } else {
      // User info not on this machine, will generate additional calls to the API
      processingQueue.push(entryWithoutUserInfo);
    }
  }

  if (processingQueue.length) {
    console.log('Processing queue length:', processingQueue.length);
  }

  processEntriesWithoutUserInfo(entriesReadyForProcessing);
}

setInterval(async () => {
  if (processingQueue.length === 0) return;

  const entries = processingQueue.splice(0, 8);

  await processEntriesWithoutUserInfo(entries);

  console.log('Processing queue length:', processingQueue.length);
}, 5000);
