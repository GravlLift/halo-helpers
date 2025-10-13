const subTierModulo = (csrValue: number) =>
  Math.max(Math.floor((csrValue % 300) / 50), 0);

export function getTierSubTierForSkill(skillValue: number): {
  Tier: string;
  SubTier: number;
} {
  let Tier: string;
  let SubTier: number;
  if (skillValue < 300) {
    Tier = 'Bronze';
  } else if (skillValue < 600) {
    Tier = 'Silver';
  } else if (skillValue < 900) {
    Tier = 'Gold';
  } else if (skillValue < 1200) {
    Tier = 'Platinum';
  } else if (skillValue < 1500) {
    Tier = 'Diamond';
  } else {
    Tier = 'Onyx';
  }

  if (Tier === 'Onyx') {
    SubTier = 0;
  } else {
    SubTier = subTierModulo(skillValue);
  }

  return { Tier, SubTier };
}

export function divisionImageSrc(playlistCsr: {
  Tier: string;
  SubTier: number;
  MeasurementMatchesRemaining?: number;
  InitialMeasurementMatches?: number;
}) {
  let tier = playlistCsr.Tier.toLowerCase();
  let subTier: number;
  if (tier === 'onyx') {
    subTier = 1;
  } else if (tier === '') {
    tier = 'unranked';
    subTier =
      (playlistCsr.InitialMeasurementMatches ?? 0) -
      (playlistCsr.MeasurementMatchesRemaining ?? 0);
  } else {
    subTier = playlistCsr.SubTier + 1;
  }

  return `https://www.halowaypoint.com/images/halo-infinite/csr/${tier}_${subTier}.png`;
}
