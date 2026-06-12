import { MatchInfo, Playlist } from 'halo-infinite-api';
import { getRedisInstance } from './redis-instance';
import { DateTime } from 'luxon';

export async function setPlaylistAsset(
  playlistAssetId: string,
  playlist: Playlist
) {
  const redis = getRedisInstance();

  await redis?.set(`playlist:${playlistAssetId}`, playlist, { nx: true });
}

export async function setMatchInfo(matchId: string, matchInfo: MatchInfo) {
  if (matchInfo.Playlist === null) {
    return;
  }

  // Match is considered expired 7 days after it ends
  const ttl = DateTime.fromISO(matchInfo.EndTime)
    .plus({ days: 7 })
    .diffNow()
    .as('seconds');
  if (ttl <= 0) {
    return;
  }

  const redis = getRedisInstance();

  if (!redis) {
    return;
  }

  const playlist: Playlist | null | undefined = await redis.get(
    `playlist:${matchInfo.Playlist.AssetId}`
  );
  if (!playlist || !playlist.HasCsr) {
    return;
  }

  await redis.set(
    `match:${matchId}`,
    {
      PlaylistAssetId: matchInfo.Playlist.AssetId,
      GameVariantAssetId: matchInfo.UgcGameVariant.AssetId,
      MatchDate: matchInfo.EndTime,
    },
    {
      nx: true,
      ex: Math.ceil(ttl),
    }
  );
}

export async function getMatchInfo(matchId: string): Promise<
  | {
      PlaylistAssetId: string;
      GameVariantAssetId: string;
      MatchDate: string;
    }
  | null
  | undefined
> {
  const redis = getRedisInstance();
  const matchInfo:
    | {
        PlaylistAssetId: string;
        GameVariantAssetId: string;
        MatchDate: string;
      }
    | null
    | undefined = await redis?.get(`match:${matchId}`);
  return matchInfo;
}
