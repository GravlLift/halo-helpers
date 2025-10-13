import { MatchSkill } from 'halo-infinite-api';

type SingleDimensionTierCounterfactual = {
  Bronze: number;
  Silver: number;
  Gold: number;
  Platinum: number;
  Diamond: number;
  Onyx: number;
};

export function computeSkill(
  value: number,
  counterFactuals: SingleDimensionTierCounterfactual,
  higherIsBetter: boolean
) {
  if (Object.keys(counterFactuals).length === 0) {
    return undefined;
  }

  let divisionValues: {
    lower: number;
    upper: number;
  };
  let divisionMMRs: {
    lower: number;
    upper: number;
  };
  if (
    (higherIsBetter && value < counterFactuals.Silver) ||
    (!higherIsBetter && value >= counterFactuals.Silver)
  ) {
    divisionValues = {
      lower: counterFactuals.Bronze,
      upper: counterFactuals.Silver,
    };
    divisionMMRs = {
      lower: 0,
      upper: 300,
    };
  } else if (
    (higherIsBetter && value < counterFactuals.Gold) ||
    (!higherIsBetter && value >= counterFactuals.Gold)
  ) {
    divisionValues = {
      lower: counterFactuals.Silver,
      upper: counterFactuals.Gold,
    };
    divisionMMRs = {
      lower: 300,
      upper: 600,
    };
  } else if (
    (higherIsBetter && value < counterFactuals.Platinum) ||
    (!higherIsBetter && value >= counterFactuals.Platinum)
  ) {
    divisionValues = {
      lower: counterFactuals.Gold,
      upper: counterFactuals.Platinum,
    };
    divisionMMRs = {
      lower: 600,
      upper: 900,
    };
  } else if (
    (higherIsBetter && value < counterFactuals.Diamond) ||
    (!higherIsBetter && value >= counterFactuals.Diamond)
  ) {
    divisionValues = {
      lower: counterFactuals.Platinum,
      upper: counterFactuals.Diamond,
    };
    divisionMMRs = {
      lower: 900,
      upper: 1200,
    };
  } else {
    divisionValues = {
      lower: counterFactuals.Diamond,
      upper: counterFactuals.Onyx,
    };
    divisionMMRs = {
      lower: 1200,
      upper: 1500,
    };
  }

  return (
    ((value - divisionValues.lower) /
      (divisionValues.upper - divisionValues.lower)) *
      (divisionMMRs.upper - divisionMMRs.lower) +
    divisionMMRs.lower
  );
}

export function isValidCounterfactual(
  counterFactuals: MatchSkill<1 | 0>['Counterfactuals'],
  stat: 'Kills' | 'Deaths'
): counterFactuals is MatchSkill<0>['Counterfactuals'] {
  if (
    !counterFactuals ||
    Object.values(counterFactuals.TierCounterfactuals).some(
      (v) => v[stat] === 'NaN'
    )
  ) {
    return false;
  }

  if (
    typeof counterFactuals.SelfCounterfactuals[stat] === 'number' &&
    counterFactuals.SelfCounterfactuals[stat] < 0
  ) {
    return false;
  }
  return true;
}

export function isValidStatPerformance(
  statPerformances: MatchSkill<1 | 0>['StatPerformances']
): statPerformances is Exclude<typeof statPerformances, {}> {
  return 'Kills' in statPerformances && 'Deaths' in statPerformances;
}

export function skillRank(
  skill:
    | Pick<MatchSkill<1 | 0>, 'StatPerformances' | 'Counterfactuals'>
    | undefined,
  stat: 'Kills' | 'Deaths',
  expectedOrCount: 'Expected' | 'Count'
) {
  if (skill == null) {
    return undefined;
  }

  if (!isValidCounterfactual(skill.Counterfactuals, stat)) {
    return undefined;
  }
  const tierCounterfactuals: MatchSkill['Counterfactuals']['TierCounterfactuals'] =
    skill.Counterfactuals.TierCounterfactuals;

  let value: number;
  if (
    isValidStatPerformance(skill.StatPerformances) &&
    typeof skill.StatPerformances[stat][expectedOrCount] === 'number'
  ) {
    value = skill.StatPerformances[stat][expectedOrCount] as number;
  } else if (
    typeof skill.Counterfactuals.SelfCounterfactuals[stat] === 'number'
  ) {
    value = skill.Counterfactuals.SelfCounterfactuals[stat] as number;
  } else {
    return undefined;
  }
  return computeSkill(
    value,
    Object.fromEntries(
      Object.entries(tierCounterfactuals).map(([k, counterfactual]) => {
        const s = counterfactual[stat];
        return [k, typeof s === 'number' ? s : 0];
      })
    ) as SingleDimensionTierCounterfactual,
    stat === 'Kills'
  );
}

export function skillRankCombined(
  skill: MatchSkill<1 | 0> | undefined,
  expectedOrCount: 'Expected'
) {
  const values = [];

  const killSkillRank = skillRank(skill, 'Kills', expectedOrCount);
  if (killSkillRank != null && !Number.isNaN(killSkillRank)) {
    values.push(killSkillRank);
  }

  const deathSkillRank = skillRank(skill, 'Deaths', expectedOrCount);
  if (deathSkillRank != null && !Number.isNaN(deathSkillRank)) {
    values.push(deathSkillRank);
  }

  return values.length > 0 ? values.average() : undefined;
}

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
