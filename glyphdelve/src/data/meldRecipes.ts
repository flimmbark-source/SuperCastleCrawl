import type { MeldRecipe } from '../types';

export const meldRecipes: MeldRecipe[] = [
  // Skill + Skill melds
  {
    id: 'meld_briar_vines',
    type: 'skill_skill',
    input1Tags: ['Summon', 'Nature'],
    input2Tags: ['Nature', 'AOE', 'DOT'],
    outputId: 'meld_skill_entangling_pack',
    outputType: 'skill',
    emergentTrait: 'Summons spawn rooted in vine patches that slow enemies',
    inheritedTraits: ['Summon wolf behavior', 'AOE vine damage zone'],
    cost: 45,
  },
  {
    id: 'meld_spore_swarm',
    type: 'skill_skill',
    input1Tags: ['Poison', 'Projectile'],
    input2Tags: ['Spirit', 'AOE', 'Summon'],
    outputId: 'meld_skill_toxic_swarm',
    outputType: 'skill',
    emergentTrait: 'Orbiting spirits apply poison stacks to nearby enemies',
    inheritedTraits: ['Poison application', 'Orbiting spirit pattern'],
    cost: 45,
  },
  // Passive + Passive melds (keystones)
  {
    id: 'meld_pack_alpha',
    type: 'passive_passive',
    input1Tags: ['Summon', 'Physical'],
    input2Tags: ['Summon', 'Buff'],
    outputId: 'meld_passive_primal_hierarchy',
    outputType: 'passive',
    emergentTrait: 'Strongest summon becomes Alpha with +40% stats; others gain +15% if Alpha is alive',
    inheritedTraits: ['Pack damage bonus', 'Single-summon stat boost'],
    cost: 55,
  },
  {
    id: 'meld_spore_thorns',
    type: 'passive_passive',
    input1Tags: ['Poison', 'OnDamageTaken'],
    input2Tags: ['Physical', 'OnDamageTaken'],
    outputId: 'meld_passive_reactive_bloom',
    outputType: 'passive',
    emergentTrait: 'Taking damage creates both poison cloud AND thorn burst simultaneously',
    inheritedTraits: ['Poison cloud on damage', 'Thorn reflect on damage'],
    cost: 55,
  },
  // Item + Item melds
  {
    id: 'meld_moon_totem',
    type: 'item_item',
    input1Tags: ['Summon', 'Spirit'],
    input2Tags: ['Totem', 'Nature'],
    outputId: 'meld_item_moonlit_totem',
    outputType: 'item',
    emergentTrait: 'Totems periodically summon spirit wolves',
    inheritedTraits: ['Summon damage bonus', 'Totem duration bonus'],
    cost: 35,
  },
  {
    id: 'meld_venom_bramble',
    type: 'item_item',
    input1Tags: ['Poison', 'DOT'],
    input2Tags: ['Physical', 'OnDamageTaken'],
    outputId: 'meld_item_blighted_thorns',
    outputType: 'item',
    emergentTrait: 'Thorn reflect damage also applies max poison stacks',
    inheritedTraits: ['Poison on hit', 'Thorn reflect'],
    cost: 35,
  },
];

// Generated meld output definitions
export const meldedSkills = [
  {
    id: 'meld_skill_entangling_pack',
    name: 'Entangling Pack',
    icon: '\u{1F43A}', // wolf
    description: 'Summon vine-wrapped wolves that create thorn zones wherever they attack.',
    tags: ['Summon', 'Nature', 'AOE', 'DOT', 'Melee'] as const,
    triggerSentence: 'When cast, summon wolves that leave vine patches on attack, slowing and damaging enemies.',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    cooldown: 10,
    damage: 10,
    range: 0,
    duration: 20,
    summonId: 'vine_wolf',
    maxSummons: 2,
    synergyNote: 'Combines Summon + AOE control. Strong with Nature and DOT passives.',
  },
  {
    id: 'meld_skill_toxic_swarm',
    name: 'Toxic Swarm',
    icon: '\u{1F9EA}', // test tube (toxic)
    description: 'Release a swarm of poison spirits that orbit and apply stacks to nearby enemies.',
    tags: ['Poison', 'Spirit', 'AOE', 'Summon', 'DOT'] as const,
    triggerSentence: 'When cast, summon poison spirits that orbit, applying 2 poison stacks per second.',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    cooldown: 12,
    damage: 4,
    range: 0,
    duration: 10,
    aoeRadius: 72,
    synergyNote: 'Combines Poison + Summon tags. Excellent with Toxic Proliferation.',
  },
];

export const meldedPassives = [
  {
    id: 'meld_passive_primal_hierarchy',
    name: 'Primal Hierarchy',
    icon: '\u{1F451}', // crown
    description: 'Your strongest summon becomes the Alpha. Other summons gain power from its presence.',
    tags: ['Summon', 'Physical', 'Buff'] as const,
    triggerSentence: 'Strongest summon gains +40% all stats. Others gain +15% damage while Alpha lives.',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    effect: { type: 'conditional' as const, condition: 'summon_count >= 1', stat: 'summon_hierarchy', value: 0.40 },
    synergyNote: 'Keystone: bridges Swarm and Elite archetypes with dynamic scaling.',
  },
  {
    id: 'meld_passive_reactive_bloom',
    name: 'Reactive Bloom',
    icon: '\u{1F4A5}', // explosion
    description: 'When damaged, simultaneously release poison spores and thorn burst.',
    tags: ['Poison', 'Physical', 'OnDamageTaken', 'AOE'] as const,
    triggerSentence: 'When hit, emit poison cloud + thorn burst (combined 2s cooldown).',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    effect: { type: 'trigger' as const, trigger: { event: 'OnDamageTaken' as const, effect: 'bloom_burst', value: 12, cooldownMs: 2000 } },
    synergyNote: 'Keystone: strong reactive defense. Great with melee-range playstyle.',
  },
];

export const meldedItems = [
  {
    id: 'meld_item_moonlit_totem',
    name: 'Moonlit Totem Staff',
    icon: '\u{1F319}', // crescent moon
    description: 'Totems are empowered by moonlight, periodically summoning spirit wolves.',
    tags: ['Totem', 'Summon', 'Spirit', 'Nature'] as const,
    triggerSentence: 'Totems summon a spirit wolf every 8s. Summon damage +15%. Totem duration +30%.',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    slot: 'weapon' as const,
    cooldown: 0,
    effects: [
      { type: 'stat_mod' as const, stat: 'summon_damage', value: 0.15, percent: true },
      { type: 'stat_mod' as const, stat: 'totem_duration', value: 0.30, percent: true },
    ],
    synergyNote: 'Bridges Totem and Summon playstyles. High synergy with both.',
  },
  {
    id: 'meld_item_blighted_thorns',
    name: 'Blighted Thorn Armor',
    icon: '\u{1F335}', // cactus
    description: 'Armor covered in toxic thorns. Reflect damage and poison attackers.',
    tags: ['Poison', 'Physical', 'OnDamageTaken', 'DOT'] as const,
    triggerSentence: 'When hit, deal 8 physical + apply 3 poison stacks to attacker (3s cooldown).',
    rarity: 'Rare' as const,
    baseWeight: 0.35,
    slot: 'armor' as const,
    cooldown: 3,
    effects: [
      { type: 'trigger' as const, trigger: { event: 'OnDamageTaken' as const, effect: 'poison_reflect', value: 8, cooldownMs: 3000 } },
    ],
    synergyNote: 'Combines defensive reflection with poison offense. Tank-DOT hybrid.',
  },
];
