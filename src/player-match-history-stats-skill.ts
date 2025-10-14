import {
  MapAsset,
  MatchSkill,
  MatchStats,
  PlayerMatchHistory,
  UgcGameVariantAsset,
  UserInfo,
  Playlist,
  PlaylistAsset,
} from 'halo-infinite-api';

export type MatchPlayers = Array<
  MatchStats['Players'][number] & {
    Skill?: MatchSkill<1 | 0>;
  } & Partial<UserInfo>
>;

export interface PlayerMatchHistoryStatsSkill
  extends Omit<
    PlayerMatchHistory,
    'MatchInfo' | 'LastTeamId' | 'Outcome' | 'Rank' | 'PresentAtEndOfMatch'
  > {
  Players: { xuid: string; gamertag: string }[];
  MatchInfo: Omit<
    PlayerMatchHistory['MatchInfo'],
    'MapVariant' | 'UgcGameVariant' | 'Playlist'
  > & {
    MapVariant: PlayerMatchHistory['MatchInfo']['MapVariant'] | MapAsset;
    UgcGameVariant:
      | PlayerMatchHistory['MatchInfo']['UgcGameVariant']
      | UgcGameVariantAsset;
    Playlist:
      | PlayerMatchHistory['MatchInfo']['Playlist']
      | (PlaylistAsset & Playlist)
      | null;
  };
  MatchStats: Omit<MatchStats, 'Players' | 'Teams'> & {
    Players: MatchPlayers;
    Teams: Array<
      MatchStats['Teams'][number] & {
        Players: MatchPlayers;
      }
    >;
  };
}

export interface ProgressiveMatch
  extends Omit<
    PlayerMatchHistory,
    'MatchInfo' | 'LastTeamId' | 'Outcome' | 'Rank' | 'PresentAtEndOfMatch'
  > {
  MatchInfo: Omit<
    PlayerMatchHistory['MatchInfo'],
    'MapVariant' | 'UgcGameVariant' | 'Playlist'
  > & {
    MapVariant: PlayerMatchHistory['MatchInfo']['MapVariant'] | MapAsset;
    UgcGameVariant:
      | PlayerMatchHistory['MatchInfo']['UgcGameVariant']
      | UgcGameVariantAsset;
    Playlist:
      | PlayerMatchHistory['MatchInfo']['Playlist']
      | (NonNullable<PlayerMatchHistory['MatchInfo']['Playlist']> &
          PlaylistAsset)
      | (NonNullable<PlayerMatchHistory['MatchInfo']['Playlist']> & Playlist)
      | (NonNullable<PlayerMatchHistory['MatchInfo']['Playlist']> &
          PlaylistAsset &
          Playlist);
  };
  Players: (
    | MatchStats['Players'][number]
    | (MatchStats['Players'][number] & { gamertag: string })
    | (MatchStats['Players'][number] & MatchPlayers[number])
    | (MatchStats['Players'][number] &
        MatchPlayers[number] & { gamertag: string })
  )[];
  Teams:
    | MatchStats['Teams']
    | Array<
        MatchStats['Teams'][number] & {
          Players: (
            | (MatchStats['Players'][number] & { gamertag: string })
            | (MatchStats['Players'][number] & MatchPlayers[number])
            | (MatchStats['Players'][number] &
                MatchPlayers[number] & { gamertag: string })
          )[];
        }
      >;
}
