import { MemoryCache } from '@gravllift/utilities';
import { PlayerMatchHistory } from 'halo-infinite-api';
import { DateTime } from 'luxon';
import { Observer } from 'rxjs';
import { fetchFullyLoadedMatch } from './fully-loaded-match';
import { HaloCaches } from './halo-caches/halo-caches';
import { PlayerMatchHistoryStatsSkill } from './player-match-history-stats-skill';
import { compareXuids } from './xuids';

const maxSimultaneousRequests = 8;

export async function* getPlayerMatches(
  gamertags: string[],
  options: {
    limit: number;
    skip?: number;
    pageSize?: number;
    fastFilter?: (m: PlayerMatchHistory) => unknown;
    filter?: (m: PlayerMatchHistoryStatsSkill) => unknown;
    countCutoff?: number;
    signal?: AbortSignal;
    loadUserData: boolean;
    dateRange?: {
      start?: DateTime;
      end?: DateTime;
    };
  },
  haloCaches: HaloCaches,
  logger$?: Observer<string>
) {
  if (gamertags.length === 0) return;

  logger$?.next(`Initializing query...`);

  const signal = options.signal;

  const abortListener = () => {
    logger$?.next(`Query cancelled.`);
    logger$?.complete();
    signal?.removeEventListener('abort', abortListener);
  };
  signal?.addEventListener('abort', abortListener);

  const pageSize = options.pageSize ?? 25;
  options.limit = Math.max(1, options.limit);
  // If there are no filters, we can compute the starting page simply from the incoming
  // skip. Otherwise, we need to reload every page from 0 until we find enough matches
  // to reach the skip count.
  // Tracks all matches seen by this function, regardless of if they fit the filters
  let allMatchesIterator =
    options.filter || options.fastFilter ? 0 : (options?.skip ?? 0);
  // Tracks the number of matches yielded by this function (actual results)
  let matchesYielded = 0;
  // Tracks the number of matches that fit the filters but were skipped. If
  // we have no filters, we can skip right to the correct page
  let matchesSkipped =
    options.filter || options.fastFilter ? 0 : (options?.skip ?? 0);
  // Matches that may or may not fit the filter criteria pending full loading
  const playerMatchPromises: Promise<PlayerMatchHistoryStatsSkill>[] = [];

  const fullyLoadedMatchCache = new MemoryCache({
    fetchOneFn: (
      {
        match,
      }: {
        match: PlayerMatchHistory;
      },
      signal
    ) =>
      fetchFullyLoadedMatch(
        match,
        users,
        signal,
        haloCaches,
        options.loadUserData
      ),
    keyTransformer: ({ match }) => match.MatchId,
  });

  logger$?.next(`Fetching user data for ${gamertags}...`);
  const users = await Promise.all(
    Array.from(haloCaches.usersCache.get(gamertags, signal).entries()).map(
      ([, v]) => v
    )
  );

  let pageRequestCount = Math.max(Math.ceil(options.limit / pageSize), 1);
  let earliestMatchMillis: number = DateTime.now().toMillis();
  pageQueryLoop: while (matchesYielded < options.limit) {
    const initialPromiseCount = playerMatchPromises.length;
    while (playerMatchPromises.length > 0) {
      if (signal?.aborted) {
        signal.removeEventListener('abort', abortListener);
        return;
      }
      logger$?.next(
        `Fetched matches as far back as ${DateTime.fromMillis(
          earliestMatchMillis
        ).toISODate()}. Evaluating filters for fetched match ${
          allMatchesIterator -
          pageSize +
          (initialPromiseCount - playerMatchPromises.length)
        } of ${allMatchesIterator - pageSize + initialPromiseCount}...`
      );
      const matchPromise = playerMatchPromises[0];
      const match = await matchPromise;
      if (
        users.every((u) =>
          match.Players.some((p) => compareXuids(p.xuid, u.xuid))
        )
      ) {
        if (!options.filter || (await options.filter(match))) {
          if (options.skip && matchesSkipped < options.skip) {
            // This match fits all the filters, but we are not yielding it
            // because it falls prior to the skip count
            matchesSkipped++;
          } else {
            yield match;
            matchesYielded++;
            if (matchesYielded >= options.limit) {
              // We have yielded enough matches, we can end our query
              break pageQueryLoop;
            }
          }
        }
      }

      // Remove the match from the array
      playerMatchPromises.splice(playerMatchPromises.indexOf(matchPromise), 1);
    }

    const pageRequestCountCapped = Math.min(
      pageRequestCount,
      maxSimultaneousRequests
    );

    if (signal?.aborted) {
      signal.removeEventListener('abort', abortListener);
      return;
    }
    logger$?.next(
      `Fetching ${users[0].gamertag} match chunks ${
        allMatchesIterator / pageSize + 1
      } - ${allMatchesIterator / pageSize + 1 + pageRequestCountCapped}...`
    );
    const matches = (
      await Promise.all(
        new Array(pageRequestCountCapped)
          .fill(0)
          .map((_, i) => allMatchesIterator + i * pageSize)
          .filter(
            (countStart) =>
              !options.countCutoff || countStart < options.countCutoff
          )
          .map((countStart) =>
            haloCaches.matchPageCache.get(
              { xuid: users[0].xuid, pageSize, start: countStart },
              signal
            )
          )
      )
    ).flat();

    if (signal?.aborted) {
      signal.removeEventListener('abort', abortListener);
      return;
    }

    if (matches.length === 0) {
      break;
    }

    earliestMatchMillis = Math.min(
      ...matches.map((m) => DateTime.fromISO(m.MatchInfo.EndTime).toMillis())
    );

    logger$?.next(
      `Fetched matches as far back as ${DateTime.fromMillis(
        earliestMatchMillis
      ).toISODate()}.`
    );

    if (
      !options.dateRange?.end ||
      earliestMatchMillis <= options.dateRange.end.toMillis()
    ) {
      // These matches are within the date range, so they need to be filtered

      // Fast filters can be applied before loading other match details, allowing
      // us to skip loading of those matches entirely
      for (const match of matches.filter(options.fastFilter ?? (() => true))) {
        const matchStart = DateTime.fromISO(match.MatchInfo.StartTime);
        if (
          (options.dateRange?.start == null ||
            matchStart.toMillis() >= options.dateRange.start.toMillis()) &&
          (options.dateRange?.end == null ||
            matchStart.toMillis() <= options.dateRange.end.toMillis())
        ) {
          playerMatchPromises.push(
            fullyLoadedMatchCache.get({ match }, signal)
          );
        }
      }

      if (
        options.dateRange?.start &&
        earliestMatchMillis < options.dateRange.start.toMillis()
      ) {
        break;
      }
    }

    // Update matchiterator so next page starts where these ones ended
    allMatchesIterator += matches.length;
    if (options.countCutoff && allMatchesIterator > options.countCutoff) {
      break;
    }
    // Double the search space until we overshoot our target
    pageRequestCount *= 2;
  }

  // Empty out any remaining matches
  while (playerMatchPromises.length > 0 && matchesYielded < options.limit) {
    if (signal?.aborted) {
      signal.removeEventListener('abort', abortListener);
      return;
    }

    const [resolvedPromise] = await Promise.race(
      playerMatchPromises.map((p) => p.then(() => [p]))
    );
    const match = await resolvedPromise;
    if (!options.filter || options.filter(match)) {
      yield match;
      matchesYielded++;
    }
    playerMatchPromises.splice(playerMatchPromises.indexOf(resolvedPromise), 1);
  }

  // Ignore any outstanding promises

  logger$?.next(`Query complete.`);
  logger$?.complete();
  signal?.removeEventListener('abort', abortListener);
  await Promise.allSettled(playerMatchPromises);
}
