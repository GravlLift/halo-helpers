import { HaloCaches } from './halo-caches/halo-caches';
import '@gravllift/utilities';
import { compareXuids, wrapXuid } from '@gravllift/halo-helpers';
import { AssetVersionLink } from 'halo-infinite-api';
import { DateTime } from 'luxon';
import { ILeaderboardProvider } from './leaderboard-provider';
import { getPlayerMatches } from './player-matches';
import { skillRankCombined } from './skill-rank-helpers';

export async function getPlayerEsrA(
  leaderboard:
    | Pick<ILeaderboardProvider, 'addLeaderboardEntries' | 'containsXuid'>
    | undefined,
  playlistVersionLink: Omit<AssetVersionLink, 'AssetKind'>,
  xuid: string,
  asOf: DateTime,
  signal: AbortSignal,
  haloCaches: InstanceType<typeof HaloCaches>
) {
  const playlist = await haloCaches.playlistVersionCache.get(
    playlistVersionLink
  );
  if ('RotationEntries' in playlist) {
    const gameVariantAssetIds = (
      await Promise.all(
        playlist.RotationEntries.map(async (entry) => {
          const mapModePair = await haloCaches.mapModePairCache.get(entry);
          if ('UgcGameVariantLink' in mapModePair) {
            return mapModePair.UgcGameVariantLink.AssetId;
          } else {
            return null;
          }
        })
      )
    )
      .filter((id): id is string => id !== null)
      .distinct();

    const mostRecentGameByVariant = await Promise.all(
      gameVariantAssetIds.map(async (id) => {
        const iterationResult = await getPlayerMatches(
          leaderboard,
          [wrapXuid(xuid)],
          {
            signal,
            limit: 1,
            countCutoff: 200,
            filter: (m) => {
              if (
                m.MatchInfo.Playlist?.AssetId !== playlistVersionLink.AssetId ||
                m.MatchInfo.UgcGameVariant.AssetId !== id ||
                DateTime.fromISO(m.MatchInfo.StartTime).toMillis() >
                  asOf.toMillis()
              ) {
                return false;
              }
              const player = m.MatchStats.Players.find(
                (p) => p.xuid && compareXuids(p.xuid, xuid)
              );
              if (!player?.Skill) {
                return false;
              }
              return skillRankCombined(player.Skill, 'Expected') != null;
            },
            loadUserData: false,
          },
          haloCaches
        ).next();
        if (iterationResult.done) {
          return null;
        } else {
          return iterationResult.value;
        }
      })
    );

    const mostRecentEsrByVariant = mostRecentGameByVariant
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => {
        const player = m.MatchStats.Players.find(
          (p) => p.xuid && compareXuids(p.xuid, xuid)
        );

        if (!player?.Skill) {
          return null;
        }

        return skillRankCombined(player.Skill, 'Expected');
      });

    const truthyValues = mostRecentEsrByVariant.filter((v) => v != null);

    if (truthyValues.length === 0) {
      return null;
    } else {
      return truthyValues.average();
    }
  } else {
    return null;
  }
}
