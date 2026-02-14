import type {
  RunState, PlayerEntity, Tag, LevelUpOffer, SkillDef, PassiveDef,
  Rarity, SynergyRating
} from '../types';
import { xpForLevel } from '../types';
import { SeededRNG } from '../engine/SeededRNG';
import { registry } from '../engine/DataRegistry';
import { updateBuildTags, addCombatLog } from '../engine/RunState';

// --- XP Awards ---
export const XP_REWARDS = {
  normal: 6,
  elite: 28,
  boss: 90,
  roomClear: 18,
} as const;

export function awardXP(state: RunState, amount: number): boolean {
  const player = state.player;
  player.xp += amount;

  if (player.xp >= player.xpToNext) {
    player.level++;
    player.xp -= player.xpToNext;
    player.xpToNext = xpForLevel(player.level + 1);

    addCombatLog(state, {
      type: 'levelup',
      source: 'player',
      value: player.level,
      details: `Player reached level ${player.level}`,
    });

    return true; // Level up occurred
  }
  return false;
}

// --- Offer Generator ---
export function generateLevelUpOffers(
  state: RunState,
  rng: SeededRNG
): LevelUpOffer[] {
  const player = state.player;
  const allSkills = registry.getAllSkills();
  const allPassives = registry.getAllPassives();

  // Determine what the player already has
  const ownedSkillIds = new Set(player.skills.map(s => s.def.id));
  const ownedPassiveIds = new Set(player.passives.map(p => p.def.id));

  // Available pools
  const availableSkills = allSkills.filter(s => !ownedSkillIds.has(s.id));
  const skillSlotsFull = player.skills.length >= player.maxSkillSlots;

  // Upgrades for owned skills
  const availableUpgrades: { skill: SkillDef; upgrade: NonNullable<SkillDef['upgrades']>[0] }[] = [];
  player.skills.forEach(s => {
    if (s.def.upgrades && !s.upgraded) {
      s.def.upgrades.forEach(u => {
        availableUpgrades.push({ skill: s.def, upgrade: u });
      });
    }
  });

  const availablePassives = allPassives.filter(p => !ownedPassiveIds.has(p.id));

  // Build weighted pools
  const skillPool = buildSkillPool(availableSkills, availableUpgrades, skillSlotsFull, player, state, rng);
  const passivePool = buildPassivePool(availablePassives, player, state, rng);

  // Compose 5 offers with guardrails
  const offers: LevelUpOffer[] = [];
  const usedIds = new Set<string>();

  // Guardrail: at least 2 skill/skill-upgrade offers
  let skillOfferCount = 0;
  const targetSkillOffers = Math.min(2, skillPool.length);
  while (skillOfferCount < targetSkillOffers && skillPool.length > 0) {
    const pick = weightedPickAndRemove(skillPool, rng);
    if (pick && !usedIds.has(pick.id)) {
      offers.push(pick);
      usedIds.add(pick.id);
      skillOfferCount++;
    } else break;
  }

  // Guardrail: at least 2 passive offers
  let passiveOfferCount = 0;
  const targetPassiveOffers = Math.min(2, passivePool.length);
  while (passiveOfferCount < targetPassiveOffers && passivePool.length > 0) {
    const pick = weightedPickAndRemove(passivePool, rng);
    if (pick && !usedIds.has(pick.id)) {
      offers.push(pick);
      usedIds.add(pick.id);
      passiveOfferCount++;
    } else break;
  }

  // 5th slot: flex from combined remaining pool
  const flexPool = [...skillPool, ...passivePool].filter(o => !usedIds.has(o.id));
  if (offers.length < 5 && flexPool.length > 0) {
    const pick = weightedPickAndRemove(flexPool, rng);
    if (pick) {
      offers.push(pick);
      usedIds.add(pick.id);
    }
  }

  // Fill any remaining slots if needed
  const allRemaining = [...skillPool, ...passivePool].filter(o => !usedIds.has(o.id));
  while (offers.length < 5 && allRemaining.length > 0) {
    const pick = weightedPickAndRemove(allRemaining, rng);
    if (pick && !usedIds.has(pick.id)) {
      offers.push(pick);
      usedIds.add(pick.id);
    } else break;
  }

  // Anti-frustration: if 2 consecutive levels without High synergy, force one
  if (state.levelsWithoutHighSynergy >= 2) {
    const hasHigh = offers.some(o => o.synergy === 'High');
    if (!hasHigh) {
      // Find highest-synergy option from pools and replace lowest-weight offer
      const allPools = [...registry.getAllSkills(), ...registry.getAllPassives()]
        .filter(d => !usedIds.has(d.id) && !ownedSkillIds.has(d.id) && !ownedPassiveIds.has(d.id));
      const highSynOpt = allPools
        .map(d => {
          const syn = calculateSynergy(d.tags, player);
          return { def: d, syn };
        })
        .filter(x => x.syn === 'High')
        .sort((a, b) => b.def.baseWeight - a.def.baseWeight)[0];

      if (highSynOpt && offers.length > 0) {
        // Replace lowest weight offer
        const lowestIdx = offers.reduce((minIdx, o, idx, arr) =>
          o.finalWeight < arr[minIdx].finalWeight ? idx : minIdx, 0);
        const isSkill = 'cooldown' in highSynOpt.def;
        offers[lowestIdx] = createOffer(
          highSynOpt.def as any,
          isSkill ? 'skill' : 'passive',
          player,
          state
        );
      }
    }
  }

  // Track synergy state
  const hasHighSynergy = offers.some(o => o.synergy === 'High');
  if (hasHighSynergy) {
    state.levelsWithoutHighSynergy = 0;
  } else {
    state.levelsWithoutHighSynergy++;
  }

  return offers.slice(0, 5);
}

function buildSkillPool(
  availableSkills: SkillDef[],
  availableUpgrades: { skill: SkillDef; upgrade: NonNullable<SkillDef['upgrades']>[0] }[],
  skillSlotsFull: boolean,
  player: PlayerEntity,
  state: RunState,
  rng: SeededRNG
): LevelUpOffer[] {
  const offers: LevelUpOffer[] = [];

  if (skillSlotsFull) {
    // Convert to upgrades/transforms only
    availableUpgrades.forEach(({ skill, upgrade }) => {
      offers.push({
        id: upgrade.id,
        type: 'skill_upgrade',
        name: upgrade.name,
        icon: upgrade.icon,
        tags: upgrade.tags,
        description: upgrade.description,
        triggerSentence: upgrade.triggerSentence,
        rarity: upgrade.rarity,
        synergy: calculateSynergy(upgrade.tags, player),
        finalWeight: calculateWeight(upgrade.baseWeight, upgrade.tags, upgrade.rarity, player, state),
        synergyNote: upgrade.synergyNote,
      });
    });
  } else {
    availableSkills.forEach(s => {
      offers.push(createOffer(s, 'skill', player, state));
    });
    availableUpgrades.forEach(({ skill, upgrade }) => {
      offers.push({
        id: upgrade.id,
        type: 'skill_upgrade',
        name: upgrade.name,
        icon: upgrade.icon,
        tags: upgrade.tags,
        description: upgrade.description,
        triggerSentence: upgrade.triggerSentence,
        rarity: upgrade.rarity,
        synergy: calculateSynergy(upgrade.tags, player),
        finalWeight: calculateWeight(upgrade.baseWeight, upgrade.tags, upgrade.rarity, player, state),
        synergyNote: upgrade.synergyNote,
      });
    });
  }

  return offers;
}

function buildPassivePool(
  availablePassives: PassiveDef[],
  player: PlayerEntity,
  state: RunState,
  rng: SeededRNG
): LevelUpOffer[] {
  return availablePassives.map(p => createOffer(p, 'passive', player, state));
}

function createOffer(
  def: SkillDef | PassiveDef,
  type: 'skill' | 'passive',
  player: PlayerEntity,
  state: RunState
): LevelUpOffer {
  return {
    id: def.id,
    type,
    name: def.name,
    icon: def.icon,
    tags: def.tags,
    description: def.description,
    triggerSentence: def.triggerSentence,
    rarity: def.rarity,
    synergy: calculateSynergy(def.tags, player),
    finalWeight: calculateWeight(def.baseWeight, def.tags, def.rarity, player, state),
    synergyNote: def.synergyNote,
  };
}

function calculateSynergy(tags: Tag[], player: PlayerEntity): SynergyRating {
  let sharedCount = 0;
  tags.forEach(t => {
    if (player.buildTags.has(t)) {
      sharedCount += player.buildTags.get(t)!;
    }
  });

  if (player.buildTags.size === 0) {
    // Level 1: everything is Medium
    return 'Med';
  }

  const ratio = sharedCount / Math.max(1, tags.length);
  if (ratio >= 2) return 'High';
  if (ratio >= 0.5) return 'Med';
  return 'Low';
}

function calculateWeight(
  baseWeight: number,
  tags: Tag[],
  rarity: Rarity,
  player: PlayerEntity,
  state: RunState
): number {
  // TagSynergy: 0.8 - 1.6
  let synergy = 0.8;
  tags.forEach(t => {
    if (player.buildTags.has(t)) {
      synergy += 0.2 * Math.min(player.buildTags.get(t)!, 4);
    }
  });
  synergy = Math.min(1.6, synergy);

  // Pity: +0.15 per level without high synergy, max +0.6
  const pity = 1.0 + Math.min(0.6, state.levelsWithoutHighSynergy * 0.15);

  // Novelty: 1.0-1.2 for underrepresented tags
  let novelty = 1.0;
  const representedTags = new Set(player.buildTags.keys());
  const newTags = tags.filter(t => !representedTags.has(t));
  if (newTags.length > 0) {
    novelty = 1.0 + Math.min(0.2, newTags.length * 0.05);
  }

  // RarityAdj
  const rarityAdj = rarity === 'Common' ? 1.0 : rarity === 'Uncommon' ? 0.65 : 0.35;

  return baseWeight * synergy * pity * novelty * rarityAdj;
}

function weightedPickAndRemove(pool: LevelUpOffer[], rng: SeededRNG): LevelUpOffer | null {
  if (pool.length === 0) return null;
  const weights = pool.map(o => o.finalWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      return pool.splice(i, 1)[0];
    }
  }
  return pool.splice(pool.length - 1, 1)[0];
}

// --- Apply chosen offer ---
export function applyLevelUpChoice(state: RunState, offerId: string) {
  const player = state.player;

  // Check skills
  const skillDef = registry.getSkill(offerId);
  if (skillDef) {
    if (player.skills.length < player.maxSkillSlots) {
      player.skills.push({
        def: skillDef,
        cooldownRemaining: 0,
        level: 1,
        upgraded: false,
      });
    }
    updateBuildTags(player);
    return;
  }

  // Check passives
  const passiveDef = registry.getPassive(offerId);
  if (passiveDef) {
    player.passives.push({
      def: passiveDef,
      active: true,
    });
    updateBuildTags(player);
    return;
  }

  // Check skill upgrades
  for (const skill of player.skills) {
    if (skill.def.upgrades) {
      const upgrade = skill.def.upgrades.find(u => u.id === offerId);
      if (upgrade) {
        // Apply upgrade modifications
        if (upgrade.modifications.damage !== undefined) {
          skill.def = { ...skill.def, damage: upgrade.modifications.damage };
        }
        if (upgrade.modifications.maxSummons !== undefined) {
          skill.def = { ...skill.def, maxSummons: upgrade.modifications.maxSummons };
        }
        if (upgrade.modifications.cooldown !== undefined) {
          skill.def = { ...skill.def, cooldown: upgrade.modifications.cooldown };
        }
        skill.upgraded = true;
        skill.def = { ...skill.def, name: upgrade.name, tags: upgrade.tags };
        updateBuildTags(player);
        return;
      }
    }
  }
}
