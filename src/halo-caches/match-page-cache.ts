import { Cache, MemoryCache, ResolvablePromise } from '@gravllift/utilities';
import { IPolicy } from 'cockatiel';
import {
  HaloInfiniteClient,
  MatchType,
  PlayerMatchHistory,
} from 'halo-infinite-api';

type Key = { start: number; xuid: string; pageSize: number };

export class MatchPageCache implements Cache<PlayerMatchHistory[], Key> {
  private innerMatchPageCache: Cache<
    PlayerMatchHistory[],
    {
      start: number;
      xuid: string;
    },
    []
  >;
  private readonly intervalMs = 500;
  private requestQueue: Promise<unknown> = Promise.resolve();
  constructor(
    haloInfiniteClient: HaloInfiniteClient,
    options: {
      requestPolicy: IPolicy;
      xuidIsCurrentUser: (xuid: string) => Promise<boolean>;
    }
  ) {
    this.innerMatchPageCache = new MemoryCache({
      cacheExpirationMs: 15 * 1000,
      keyTransformer: (key: { start: number; xuid: string }) =>
        `${key.xuid}.${key.start}`,
      fetchOneFn: async (
        key: { start: number; xuid: string },
        signal?: AbortSignal
      ) => {
        const executeRequest = () =>
          options.requestPolicy.execute(
            (ctx) =>
              haloInfiniteClient.getPlayerMatches(
                key.xuid,
                MatchType.All,
                25,
                key.start,
                { signal: ctx.signal }
              ),
            signal
          );

        if (await options.xuidIsCurrentUser(key.xuid)) {
          // No rate limit on self-requests
          return executeRequest();
        }

        const initialQueue = this.requestQueue;
        let requestPromise = new ResolvablePromise<void>();
        const scheduler = async () => {
          await requestPromise;
          await new Promise((resolve) => {
            setTimeout(() => {
              resolve(undefined);
            }, this.intervalMs);
          });
        };
        this.requestQueue = this.requestQueue.then(scheduler, scheduler);
        await initialQueue;
        return executeRequest().finally(() => {
          requestPromise.resolve();
        });
      },
    });
  }

  get(
    key: Key,
    signal?: AbortSignal | undefined
  ): Promise<PlayerMatchHistory[]>;
  get(
    keys: Key[],
    signal?: AbortSignal | undefined
  ): Map<
    { start: number; xuid: string; pageSize: number },
    Promise<PlayerMatchHistory[]>
  >;
  get(
    keyOrKeys: Key | Key[],
    signal?: AbortSignal | undefined
  ): Promise<PlayerMatchHistory[]> | Map<Key, Promise<PlayerMatchHistory[]>> {
    return Array.isArray(keyOrKeys)
      ? new Map(keyOrKeys.map((k) => [k, this.getOne(k, signal)]))
      : this.getOne(keyOrKeys, signal);
  }
  private async getOne(key: Key, signal: AbortSignal | undefined) {
    const startPage = Math.floor(key.start / 25);
    const endPage = Math.ceil((key.start + key.pageSize) / 25);
    const uncutPages = await Promise.all(
      Array.from({ length: endPage - startPage }, (_, i) =>
        this.innerMatchPageCache.get(
          {
            start: (startPage + i) * 25,
            xuid: key.xuid,
          },
          signal
        )
      )
    );
    const slicedPages = uncutPages
      .flat()
      .slice(
        key.start - startPage * 25,
        key.start - startPage * 25 + key.pageSize
      );
    return slicedPages;
  }
  set(): void {
    throw new Error('Method not implemented.');
  }
  delete(): void {
    throw new Error('Method not implemented.');
  }
}
