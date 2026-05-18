import {
  compareXuids,
  entryIsValid,
  HiveMindLeaderboardProvider,
  wrapXuid,
} from '@gravllift/halo-helpers';
import {
  MatchInfo,
  MatchSkill,
  MatchStats,
  PlayerMatchHistory,
  ResultContainer,
} from 'halo-infinite-api';
import { BehaviorSubject, Observer, Subscribable } from 'rxjs';
import type { HaloCaches } from './halo-caches/halo-caches';
import { queueLeaderboardEntryForProcessing } from './leaderboard-entry-queue';
import {
  PlayerMatchHistoryStatsSkill,
  ProgressiveMatch,
} from './player-match-history-stats-skill';

export async function fetchFullyLoadedMatch(
  leaderboard: HiveMindLeaderboardProvider | undefined,
  match: { MatchId: string; MatchInfo: MatchInfo },
  users: { xuid: string }[],
  signal: AbortSignal,
  haloCaches: HaloCaches,
  loadUserData: boolean,
  _logger$?: Observer<string>,
): Promise<PlayerMatchHistoryStatsSkill> {
  const matchStatsPromise = haloCaches.matchStatsCache.get(match.MatchId); // This is causing abort errors for some reason

  const [
    stats,
    skills,
    MapVariant,
    UgcGameVariant,
    playlist,
    playlistVersion,
    userInfoMap,
  ] = await Promise.all([
    matchStatsPromise,
    matchStatsPromise.then((matchStats) => {
      const playersToFetch = matchStats.Players.filter((p) =>
        /^xuid\(\d+\)$/.test(p.PlayerId),
      ).map((p) => ({
        matchId: match.MatchId,
        playerId: p.PlayerId,
      }));
      return Promise.all(
        Array.from(haloCaches.matchSkillsCache.get(playersToFetch, signal)).map(
          ([{ playerId }, p]) =>
            p.catch(() => ({
              Id: playerId,
              ResultCode: 1,
              Result: null,
            })),
        ),
      );
    }),
    haloCaches.mapCache.get(match.MatchInfo.MapVariant, signal),
    haloCaches.gameVariantCache.get(match.MatchInfo.UgcGameVariant, signal),
    match.MatchInfo.Playlist?.AssetId
      ? haloCaches.playlistCache
          .get(match.MatchInfo.Playlist.AssetId, signal)
          .catch(() => null)
      : null,
    match.MatchInfo.Playlist
      ? haloCaches.playlistVersionCache.get(match.MatchInfo.Playlist, signal)
      : null,
    loadUserData
      ? matchStatsPromise.then((s) =>
          haloCaches.usersCache.get(
            s.Players.filter((p) => /^xuid\(\d+\)$/.test(p.PlayerId)).map((p) =>
              wrapXuid(p.PlayerId),
            ),
            signal,
          ),
        )
      : new Map<
          string,
          Promise<{
            xuid: string;
            gamertag: string;
          }>
        >(),
  ]);

  if (match.MatchInfo.Playlist?.AssetId && leaderboard) {
    const playlistAssetId = match.MatchInfo.Playlist.AssetId;
    entryIsValid;
    queueLeaderboardEntryForProcessing(
      haloCaches,
      leaderboard,
      skills
        .filter(
          (s): s is ResultContainer<MatchSkill> =>
            s.Result != null && s.ResultCode === 0,
        )
        .map((s) => ({
          matchInfo: {
            endTime: match.MatchInfo.EndTime,
            playlistAssetId,
            gameVariantAssetId: match.MatchInfo.UgcGameVariant?.AssetId ?? '',
            matchId: match.MatchId,
          },
          matchSkill: s.Result,
          xuid: s.Id,
        })),
    );
  }

  const Players = await Promise.all(
    stats.Players.map(async (p) => {
      const userInfo = (await userInfoMap.get(p.PlayerId)) ?? {
        xuid: p.PlayerId,
        gamertag: '',
      };
      const playerSkill = skills?.find(
        (s) => s.ResultCode === 0 && s.Result != null && s.Id === p.PlayerId,
      )?.Result;
      if (playerSkill) {
        return { ...p, Skill: playerSkill, ...userInfo };
      } else {
        return { ...p, ...userInfo };
      }
    }),
  );

  return {
    ...match,
    MatchInfo: {
      ...match.MatchInfo,
      MapVariant,
      UgcGameVariant,
      Playlist:
        playlist && playlistVersion
          ? {
              ...playlist,
              ...playlistVersion,
            }
          : match.MatchInfo.Playlist,
    },
    Players: await Promise.all(
      (users.length
        ? stats.Players.filter((p) =>
            users.some((u) => compareXuids(u.xuid, p.PlayerId)),
          )
        : stats.Players
      ).map(
        async (player) =>
          (await userInfoMap.get(player.PlayerId)) ?? {
            xuid: player.PlayerId,
            gamertag: '',
          },
      ),
    ),
    MatchStats: {
      ...stats,
      Players,
      Teams: stats.Teams.map((t) => ({
        ...t,
        Players: Players.filter((p) => p.LastTeamId === t.TeamId),
      })),
    },
  } satisfies PlayerMatchHistoryStatsSkill;
}

export function fetchMatchProgressive(
  match: MatchStats | PlayerMatchHistory,
  options: {
    signal: AbortSignal;
    haloCaches: HaloCaches;
    loadUserData: boolean;
    leaderboard: HiveMindLeaderboardProvider | undefined;
    _logger$?: Observer<string>;
  },
): Subscribable<ProgressiveMatch> {
  const subject = new BehaviorSubject<ProgressiveMatch>({
    MatchId: match.MatchId,
    MatchInfo: match.MatchInfo,
    Players: 'Players' in match ? match.Players : [],
    Teams: 'Teams' in match ? match.Teams : [],
  });

  const abortListener = () => {
    subject.complete();
    options.signal.removeEventListener('abort', abortListener);
  };
  options.signal.addEventListener('abort', abortListener);

  options.haloCaches.mapCache
    .get(match.MatchInfo.MapVariant, options.signal)
    .then((MapVariant) => {
      subject.next({
        ...subject.value,
        MatchInfo: {
          ...subject.value.MatchInfo,
          MapVariant,
        },
      });
    });

  options.haloCaches.gameVariantCache
    .get(match.MatchInfo.UgcGameVariant, options.signal)
    .then((UgcGameVariant) => {
      subject.next({
        ...subject.value,
        MatchInfo: {
          ...subject.value.MatchInfo,
          UgcGameVariant,
        },
      });
    });

  if (match.MatchInfo.Playlist?.AssetId) {
    options.haloCaches.playlistCache
      .get(match.MatchInfo.Playlist.AssetId, options.signal)
      .then((playlist) => {
        subject.next({
          ...subject.value,
          MatchInfo: {
            ...subject.value.MatchInfo,
            Playlist: {
              ...(subject.value.MatchInfo.Playlist as NonNullable<
                PlayerMatchHistory['MatchInfo']['Playlist']
              >),
              ...playlist,
            },
          },
        });
      });
    options.haloCaches.playlistVersionCache
      .get(match.MatchInfo.Playlist, options.signal)
      .then((playlistVersion) => {
        subject.next({
          ...subject.value,
          MatchInfo: {
            ...subject.value.MatchInfo,
            Playlist: {
              ...(subject.value.MatchInfo.Playlist as NonNullable<
                PlayerMatchHistory['MatchInfo']['Playlist']
              >),
              ...playlistVersion,
            },
          },
        });
      });
  }

  const matchStatsPromise = options.haloCaches.matchStatsCache
    .get(match.MatchId, options.signal)
    .then((matchStats) => {
      subject.next({
        ...subject.value,
        Players: matchStats.Players,
        Teams: matchStats.Teams.map((t) => ({
          ...t,
          Players: matchStats.Players.filter((p) => p.LastTeamId === t.TeamId),
        })),
      });
      return matchStats;
    });

  const playerXuidsPromise = matchStatsPromise.then((matchStats) =>
    matchStats.Players.filter((p) => /^xuid\(\d+\)$/.test(p.PlayerId)).map(
      (p) => wrapXuid(p.PlayerId),
    ),
  );

  playerXuidsPromise.then((playersXuids) => {
    // Skills
    const playerSkillPromises = Array.from(
      options.haloCaches.matchSkillsCache.get(
        playersXuids.map((xuid) => ({
          matchId: match.MatchId,
          playerId: xuid,
        })),
        options.signal,
      ),
    ).map(([{ playerId }, promise]) =>
      promise
        .catch(() => ({
          Id: playerId,
          ResultCode: 1,
          Result: null,
        }))
        .then(async (playerSkill) => {
          if (playerSkill.Result) {
            await matchStatsPromise;
            subject.next({
              ...subject.value,
              Players: subject.value.Players.map((p) =>
                compareXuids(p.PlayerId, playerSkill.Id)
                  ? { ...p, Skill: playerSkill.Result }
                  : p,
              ),
              Teams: subject.value.Teams.map((t) => ({
                ...t,
                Players:
                  'Players' in t
                    ? t.Players.map((p) =>
                        compareXuids(p.PlayerId, playerSkill.Id)
                          ? { ...p, Skill: playerSkill.Result }
                          : p,
                      )
                    : undefined,
              })),
            });
          }

          return playerSkill;
        }),
    );

    Promise.all(playerSkillPromises).then((skills) => {
      if (match.MatchInfo.Playlist?.AssetId && options.leaderboard) {
        const playlistAssetId = match.MatchInfo.Playlist.AssetId;
        queueLeaderboardEntryForProcessing(
          options.haloCaches,
          options.leaderboard,
          skills
            .filter(
              (s): s is ResultContainer<MatchSkill> =>
                s.Result != null && s.ResultCode === 0,
            )
            .map((s) => ({
              matchInfo: {
                endTime: match.MatchInfo.EndTime,
                playlistAssetId,
                gameVariantAssetId:
                  match.MatchInfo.UgcGameVariant?.AssetId ?? '',
                matchId: match.MatchId,
              },
              matchSkill: s.Result,
              xuid: s.Id,
            })),
        );
      }
    });
  });

  if (options.loadUserData) {
    playerXuidsPromise.then((playersXuids) => {
      // Gamertags
      options.haloCaches.usersCache
        .get(playersXuids, options.signal)
        .forEach(async (userPromise) => {
          const user = await userPromise;
          subject.next({
            ...subject.value,
            Players: subject.value.Players.map((p) =>
              compareXuids(p.PlayerId, user.xuid) ? { ...p, ...user } : p,
            ),
          });
        });
    });
  }

  return subject;
}
