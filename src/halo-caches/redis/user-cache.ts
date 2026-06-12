import { UserInfo } from 'halo-infinite-api';
import { wrapXuid, compareXuids } from '@gravllift/halo-helpers';
import { DateTime } from 'luxon';
import { getRedisInstance } from './redis-instance';

export function getByXuid(
  xuids: string[]
): Map<string, Promise<UserInfo | null>> {
  const redis = getRedisInstance();
  if (!redis) {
    return new Map(xuids.map((xuid) => [xuid, Promise.resolve(null)]));
  }

  const mGetPromise = redis.mget<(UserInfo | null | undefined)[]>(
    xuids.map((xuid) => wrapXuid(xuid))
  );
  return new Map(
    xuids.map((xuid) => [
      xuid,
      mGetPromise.then(
        (users) =>
          users.find((user) => user && compareXuids(user.xuid, xuid)) ?? null
      ),
    ])
  );
}

export function getByGamertag(
  gamertags: string[]
): Map<string, Promise<UserInfo | null>> {
  const redis = getRedisInstance();
  if (!redis) {
    return new Map(
      gamertags.map((gamertag) => [gamertag, Promise.resolve(null)])
    );
  }

  return new Map(
    gamertags.map((gamertag) => {
      const key = /gt\([^)]+\)/.test(gamertag)
        ? gamertag.toLowerCase()
        : `gt(${gamertag.toLowerCase()})`;
      return [gamertag, redis.get(key)];
    })
  );
}

export async function addUserInfo(user: UserInfo): Promise<void> {
  const redis = getRedisInstance();
  if (!redis) {
    return;
  }

  const expireAt = DateTime.now().plus({
    days: +(process.env['USER_CACHE_EXPIRATION_DAYS'] || 7),
  });
  await Promise.all([
    redis.set(wrapXuid(user.xuid), user, {
      exat: Math.round(expireAt.toSeconds()),
    }),
    redis.set(`gt(${user.gamertag.toLowerCase()})`, user, {
      exat: Math.round(expireAt.toSeconds()),
    }),
  ]);
}
