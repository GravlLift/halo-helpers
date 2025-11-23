import {
  abortSignalAll,
  Cache,
  Fetchers,
  HasableCache,
  LayerCache,
  MemoryCache,
  NoCache,
  NullableFetcher,
} from '@gravllift/utilities';

import { IPolicy } from 'cockatiel';
import {
  AssetKind,
  AssetKindTypeMap,
  AssetVersionLink,
  GameVariantCategory,
  HaloInfiniteClient,
  MapAsset,
  MapModePairAsset,
  MatchSkill,
  MatchStats,
  PlayerMatchHistory,
  Playlist,
  PlaylistAsset,
  RequestError,
  ResultContainer,
  UgcGameVariantAsset,
  UserInfo,
  XboxClient,
} from 'halo-infinite-api';
import { CombinedUserCache } from './combined-user-cache';
import { MatchPageCache } from './match-page-cache';
import {
  bufferTime,
  filter,
  firstValueFrom,
  map,
  mergeMap,
  share,
  Subject,
} from 'rxjs';
import { getGamerpicUrl } from '../gamerpic-url';
import { unwrapXuid, compareXuids } from '../xuids';

class GamertagMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Expected gamertag ${expected} but got ${actual}`);
  }
}

export class HaloCaches {
  fullUsersCache: Cache<UserInfo, string>;
  xuidCache: Cache<{ xuid: string; gamertag: string }, string> &
    HasableCache<string>;
  usersCache: Cache<{ xuid: string; gamertag: string }, string>;
  matchStatsCache: Cache<MatchStats<GameVariantCategory>, string>;
  matchSkillsCache: Cache<
    ResultContainer<MatchSkill<1 | 0>>,
    {
      matchId: string;
      playerId: string;
    }
  >;
  playlistCache: Cache<Playlist, string>;
  matchPageCache: Cache<
    PlayerMatchHistory[],
    { start: number; xuid: string; pageSize: number }
  >;
  mapCache: Cache<
    MapAsset | AssetVersionLink,
    Omit<AssetVersionLink, 'AssetKind'>
  >;
  gameVariantCache: Cache<
    AssetVersionLink | UgcGameVariantAsset,
    Omit<AssetVersionLink, 'AssetKind'>
  >;
  playlistVersionCache: Cache<
    AssetVersionLink | PlaylistAsset,
    Omit<AssetVersionLink, 'AssetKind'>
  >;
  mapModePairCache: Cache<
    AssetVersionLink | MapModePairAsset,
    Omit<AssetVersionLink, 'AssetKind'>
  >;

  constructor(
    haloInfiniteClient: HaloInfiniteClient,
    xboxClient: XboxClient,
    requestPolicy: IPolicy,
    additionalXuidFetcher?: NullableFetcher<
      { xuid: string; gamertag: string },
      string
    >
  ) {
    this.fullUsersCache = new LayerCache({
      maxEntries: 1000,
      rollingExpiration: true,
      keyTransformer: (gamertag: string) => gamertag?.toLowerCase(),
      fetchers: [
        {
          fetchOneFn: async (gamertag: string, signal?: AbortSignal) => {
            const result = await requestPolicy.execute(
              (ctx) =>
                haloInfiniteClient
                  .getUser(gamertag, { signal: ctx.signal })
                  .then((res) => {
                    if (res.gamertag.toLowerCase() !== gamertag.toLowerCase()) {
                      // Halo has returned the wrong gt. Cool, let's hack around that.
                      throw new GamertagMismatchError(gamertag, res.gamertag);
                    }
                    return res;
                  })
                  .catch(async (err) => {
                    if (
                      (err instanceof RequestError &&
                        (err.response.status === 429 ||
                          err.response.status === 500)) ||
                      err instanceof GamertagMismatchError
                    ) {
                      try {
                        const searchResults = await xboxClient.searchUsers(
                          gamertag,
                          5,
                          { signal }
                        );
                        const searchResult = searchResults.find(
                          (r) =>
                            r.gamertag.toLowerCase() === gamertag.toLowerCase()
                        );
                        if (!searchResult) {
                          throw new Error(`Failed to find user ${gamertag}`);
                        }
                        const baseUrl = new URL(searchResult.displayPicRaw);
                        return {
                          ...searchResult,
                          gamerpic: {
                            small: getGamerpicUrl(baseUrl, 64),
                            medium: getGamerpicUrl(baseUrl, 208),
                            large: getGamerpicUrl(baseUrl, 424),
                            xlarge: baseUrl.toString(),
                          },
                        };
                      } catch (searchErr) {
                        throw new AggregateError(
                          [err, searchErr],
                          `Failed to get user ${gamertag} from both Halo and Xbox APIs`
                        );
                      }
                    }
                    throw err;
                  }),
              signal
            );

            this.xuidCache.set(result.xuid, result);
            return result;
          },
        },
      ],
    });

    const haloInfiniteFetch = (
      requests: { xuid: string; signal: AbortSignal }[]
    ) =>
      haloInfiniteClient.getUsers(requests.map(({ xuid }) => xuid).distinct(), {
        signal: abortSignalAll(requests.map(({ signal }) => signal)),
      });
    const xboxLiveFetch = (requests: { xuid: string; signal: AbortSignal }[]) =>
      xboxClient
        .getProfiles(
          requests.map(({ xuid }) => xuid).distinct(),
          ['Gamertag', 'GameDisplayPicRaw'],
          { signal: abortSignalAll(requests.map(({ signal }) => signal)) }
        )
        .then(({ profileUsers }) =>
          profileUsers.map((profile) => ({
            xuid: profile.id,
            gamertag:
              profile.settings.find((v) => v.id === 'Gamertag')?.value ?? '',
          }))
        );
    const xuidInput = new Subject<{ xuid: string; signal: AbortSignal }>();
    // xbox cooldown tracking: if xbox returns 429 it goes into cooldown until
    // the Retry-After header (or fallback) expires. We prefer xboxLiveFetch by
    // default unless it's in cooldown, in which case we fall back to
    // haloInfiniteFetch.
    let xboxCooldownUntil = 0; // ms since epoch

    const xuidBuffer = xuidInput.pipe(
      bufferTime(500, undefined, 32),
      filter((requests) => requests.length > 0),
      mergeMap((requests) =>
        requestPolicy.execute(async () => {
          const useXbox = Date.now() >= xboxCooldownUntil;
          const chosenFetcher = useXbox ? xboxLiveFetch : haloInfiniteFetch;
          try {
            return await chosenFetcher(requests);
          } catch (err) {
            if (err instanceof RequestError) {
              // If we attempted xboxLiveFetch and it returned 429, put xbox into
              // cooldown until Retry-After expires.
              if (
                chosenFetcher === xboxLiveFetch &&
                err.response.status === 429
              ) {
                let retryAfter = 5; // seconds fallback
                const raw =
                  err.response.headers.get('retry-after') ??
                  err.response.headers.get('Retry-After');
                if (raw != null) {
                  const parsed = parseInt(String(raw), 10);
                  if (!Number.isNaN(parsed) && parsed > 0) {
                    retryAfter = parsed;
                  }
                }

                const dateHeader = err.response.headers.get('date');
                const requestDate = dateHeader
                  ? new Date(dateHeader).getTime()
                  : Date.now();
                xboxCooldownUntil = requestDate + retryAfter * 1000;
              }
            }

            throw err;
          }
        })
      ),
      share()
    );

    const fetchers = [] as Array<
      NullableFetcher<{ xuid: string; gamertag: string }, string>
    >;
    if (additionalXuidFetcher) {
      fetchers.push(additionalXuidFetcher);
    }
    this.xuidCache = new LayerCache({
      keyTransformer: (xuid: string) => unwrapXuid(xuid),
      fetchers: [
        ...fetchers,
        {
          fetchOneFn: (xuid: string, signal?: AbortSignal) => {
            const resultPromise = firstValueFrom(
              xuidBuffer.pipe(
                map((result) => result.find((u) => compareXuids(u.xuid, xuid))),
                filter(
                  (result): result is { xuid: string; gamertag: string } =>
                    result != null
                )
              )
            );
            xuidInput.next({
              xuid,
              signal: signal ?? new AbortController().signal,
            });
            return resultPromise;
          },
        },
      ] as Fetchers<
        { xuid: string; gamertag: string },
        string,
        [],
        { xuid: string; gamertag: string }
      >,
    });
    this.usersCache = new CombinedUserCache(
      this.fullUsersCache,
      this.xuidCache
    );

    this.matchStatsCache = new NoCache({
      fetchOneFn: (matchId: string, signal?: AbortSignal) =>
        requestPolicy.execute(
          (ctx) =>
            haloInfiniteClient.getMatchStats(matchId, { signal: ctx.signal }),
          signal
        ),
    });
    this.matchSkillsCache = new MemoryCache<
      ResultContainer<MatchSkill<0 | 1>>,
      { matchId: string; playerId: string },
      string,
      [],
      { matchId: string; skills: ResultContainer<MatchSkill<0 | 1>>[] }
    >({
      maxEntries: 8000,
      rollingExpiration: true,
      async fetchManyFn(
        keys: { matchId: string; playerId: string }[],
        signal: AbortSignal
      ) {
        const matchGroups = keys.groupBy((k) => k.matchId);
        const results: {
          matchId: string;
          skills: ResultContainer<MatchSkill<0 | 1>>[];
        }[] = await Promise.all(
          Array.from(matchGroups.entries())
            .filter(([, group]) => group.length > 0)
            .map(async ([matchId, group]) => {
              return {
                matchId,
                skills: await requestPolicy.execute(
                  (ctx) =>
                    haloInfiniteClient.getMatchSkill(
                      matchId,
                      group.map((p) => p.playerId),
                      { signal: ctx.signal }
                    ),
                  signal
                ),
              };
            })
        );
        return results;
      },
      resultSelector: (
        results: Array<{
          matchId: string;
          skills: ResultContainer<MatchSkill<0 | 1>>[];
        }>,
        key: { matchId: string; playerId: string }
      ): ResultContainer<MatchSkill<0 | 1>> => {
        const result = results.find((r) => r.matchId === key.matchId);
        if (!result) {
          throw new Error(`Failed to find match ${key.matchId}`);
        }
        const skill = result.skills.find((s) => s.Id === key.playerId);
        if (!skill) {
          throw new Error(
            `Failed to find skill ${key.matchId}.${key.playerId}`
          );
        }
        return skill;
      },
      keyTransformer: (key: { matchId: string; playerId: string }) =>
        `${key.matchId}.${key.playerId}`,
    });
    this.playlistCache = new NoCache({
      fetchOneFn: (playlistId: string, signal?: AbortSignal) =>
        requestPolicy.execute(
          (ctx) =>
            haloInfiniteClient.getPlaylist(playlistId, {
              signal: ctx.signal,
              headers: {
                Accept: 'application/json, text/plain, */*',
                Origin: 'https://www.halowaypoint.com',
              },
            }),
          signal
        ),
    });

    [
      this.mapCache,
      this.gameVariantCache,
      this.playlistVersionCache,
      this.mapModePairCache,
    ] = (
      [
        { name: 'map', assetKind: AssetKind.Map },
        { name: 'game variant', assetKind: AssetKind.UgcGameVariant },
        { name: 'playlist', assetKind: AssetKind.Playlist },
        { name: 'map mode pair', assetKind: AssetKind.MapModePair },
      ] as const
    ).map(
      <const T extends keyof AssetKindTypeMap>({
        assetKind,
      }: {
        name: string;
        assetKind: T;
      }) =>
        new MemoryCache({
          keyTransformer: (key: Omit<AssetVersionLink, 'AssetKind'>) =>
            `${key.AssetId}.${key.VersionId}`,
          fetchOneFn: (
            key: Omit<AssetVersionLink, 'AssetKind'>,
            signal?: AbortSignal
          ) =>
            requestPolicy.execute(
              (ctx) =>
                haloInfiniteClient
                  .getSpecificAssetVersion(
                    assetKind,
                    key.AssetId,
                    key.VersionId,
                    { signal: ctx.signal }
                  )
                  .catch(() => {
                    const fallback: AssetVersionLink = {
                      AssetId: key.AssetId,
                      VersionId: key.VersionId,
                      AssetKind: assetKind,
                    };
                    return fallback;
                  }),
              signal
            ),
        })
    ) as [
      MemoryCache<
        AssetKindTypeMap[typeof AssetKind.Map] | AssetVersionLink,
        Omit<AssetVersionLink, 'AssetKind'>
      >,
      MemoryCache<
        AssetKindTypeMap[typeof AssetKind.UgcGameVariant] | AssetVersionLink,
        Omit<AssetVersionLink, 'AssetKind'>
      >,
      MemoryCache<
        AssetKindTypeMap[typeof AssetKind.Playlist] | AssetVersionLink,
        Omit<AssetVersionLink, 'AssetKind'>
      >,
      MemoryCache<
        AssetKindTypeMap[typeof AssetKind.MapModePair] | AssetVersionLink,
        Omit<AssetVersionLink, 'AssetKind'>
      >
    ];

    this.matchPageCache = new MatchPageCache(haloInfiniteClient, requestPolicy);
  }
}
