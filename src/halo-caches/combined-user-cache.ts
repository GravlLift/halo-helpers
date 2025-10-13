import { Cache } from '@gravllift/utilities';

export class CombinedUserCache
  implements Cache<{ xuid: string; gamertag: string }, string, []>
{
  constructor(
    private fullUsersCache: Cache<{ xuid: string; gamertag: string }, string>,
    private xuidCache: Cache<{ xuid: string; gamertag: string }, string>
  ) {}

  get(
    key: string,
    signal?: AbortSignal
  ): Promise<{ xuid: string; gamertag: string }>;
  get(
    keys: string[],
    signal?: AbortSignal
  ): Map<string, Promise<{ xuid: string; gamertag: string }>>;
  get(
    keyOrKeys: string | string[],
    signal?: AbortSignal
  ):
    | Promise<{ xuid: string; gamertag: string }>
    | Map<string, Promise<{ xuid: string; gamertag: string }>> {
    if (Array.isArray(keyOrKeys)) {
      const xuids: string[] = [];
      const gamertags: string[] = [];
      keyOrKeys.forEach((x) => {
        if (/^xuid\(\d+\)$/i.test(x)) {
          xuids.push(x);
        } else {
          gamertags.push(x);
        }
      });
      return new Map([
        ...this.xuidCache.get(xuids, signal),
        ...this.fullUsersCache.get(gamertags, signal),
      ]);
    } else {
      if (/^xuid\(\d+\)$/i.test(keyOrKeys)) {
        return this.xuidCache.get(keyOrKeys, signal);
      } else {
        return this.fullUsersCache.get(keyOrKeys, signal);
      }
    }
  }
  set(_key: string, value: { xuid: string; gamertag: string }): void {
    this.fullUsersCache.set(value.gamertag, value);
    this.xuidCache.set(value.xuid, value);
  }
  delete(key: string): void {
    this.fullUsersCache.delete(key);
    this.xuidCache.delete(key);
  }
}
