import { DateTime } from 'luxon';
import { Subject } from 'rxjs';
import { HaloCaches } from './halo-caches/halo-caches';
import { getPlayerMatches } from './player-matches';
import { wrapXuid } from './xuids';
import { KnowledgeMapLeaderboardProvider } from './leaderboard';

export async function crawlMatches(
  startingXuid: string,
  maxDepth: number,
  {
    signal,
    haloCaches,
  }: {
    haloCaches: HaloCaches;
    signal: AbortSignal;
  },
  visitedMatches?: Set<string>,
  visitedXuids?: Set<string>,
  loggerFn?: (msg: string) => void
) {
  visitedXuids ??= new Set<string>();
  if (visitedXuids.has(startingXuid)) {
    return;
  } else {
    visitedXuids.add(startingXuid);
  }

  visitedMatches ??= new Set<string>();
  const xuidsToCrawl = new Set<string>();
  const logger$ = new Subject<string>();
  const iterator = getPlayerMatches(
    [wrapXuid(startingXuid)],
    {
      limit: 1,
      filter: (m) =>
        m.MatchInfo.Playlist &&
        'PublicName' in m.MatchInfo.Playlist &&
        m.MatchInfo.Playlist.HasCsr,
      signal,
      loadUserData: false,
      dateRange: {
        start: DateTime.now().minus({ days: 7 }),
      },
    },
    haloCaches,
    logger$
  );

  let subscription: { unsubscribe: () => void } | undefined;
  if (loggerFn) {
    subscription = logger$.subscribe(loggerFn);
  } else {
    subscription = undefined;
  }

  try {
    for await (const match of iterator) {
      if (visitedMatches.has(match.MatchId)) {
        continue;
      }
      visitedMatches.add(match.MatchId);

      for (const player of match.MatchStats.Players) {
        if (player.xuid && !visitedXuids.has(player.xuid)) {
          xuidsToCrawl.add(player.xuid);
        }
      }
    }

    if (maxDepth > 0) {
      maxDepth--;
      if (maxDepth === 0) {
        return;
      }
    }

    for (const xuid of xuidsToCrawl) {
      await crawlMatches(
        xuid,
        maxDepth,
        {
          signal,
          haloCaches,
        },
        visitedMatches,
        visitedXuids,
        loggerFn
      );
    }
  } finally {
    subscription?.unsubscribe();
  }
}
