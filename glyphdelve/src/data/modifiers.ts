import type { ModifierDef } from '../types';

export const druidModifiers: ModifierDef[] = [
  {
    id: 'mod_thorned',
    name: 'Thorned',
    icon: '\u{1F335}', // cactus
    description: 'Adds thorn damage reflection to an item.',
    tags: ['Physical', 'OnDamageTaken'],
    triggerSentence: 'When hit, reflect 4 physical damage to the attacker.',
    rarity: 'Common',
    baseWeight: 1.0,
    effects: [{ type: 'trigger', trigger: { event: 'OnDamageTaken', effect: 'reflect', value: 4 } }],
    synergyNote: 'Stacks with Thorned Hide passive.',
  },
  {
    id: 'mod_venomous',
    name: 'Venomous',
    icon: '\u{1F40D}', // snake
    description: 'Adds poison application to attacks.',
    tags: ['Poison', 'OnHit', 'DOT'],
    triggerSentence: 'On hit, apply 1 poison stack to the target.',
    rarity: 'Common',
    baseWeight: 1.0,
    effects: [{ type: 'trigger', trigger: { event: 'OnHit', effect: 'apply_poison', value: 1 } }],
    synergyNote: 'Enables poison synergies on any weapon.',
  },
  {
    id: 'mod_nourishing',
    name: 'Nourishing',
    icon: '\u{2764}\u{FE0F}', // red heart
    description: 'Adds life gain on hit.',
    tags: ['Heal', 'OnHit', 'Nature'],
    triggerSentence: 'On hit, heal for 2 HP.',
    rarity: 'Common',
    baseWeight: 1.0,
    effects: [{ type: 'trigger', trigger: { event: 'OnHit', effect: 'heal', value: 2 } }],
    synergyNote: 'Sustain modifier. Good on fast-attacking builds.',
  },
  {
    id: 'mod_swarming',
    name: 'Swarming',
    icon: '\u{1F41D}', // honeybee
    description: 'Summon skills create an additional weaker summon.',
    tags: ['Summon', 'OnSummon'],
    triggerSentence: 'When you summon, 30% chance to create an additional summon at 50% stats.',
    rarity: 'Uncommon',
    baseWeight: 0.65,
    effects: [{ type: 'trigger', trigger: { event: 'OnSummon', effect: 'extra_summon', value: 0.30 } }],
    synergyNote: 'Core swarm modifier. Powerful with Pack Tactics.',
  },
  {
    id: 'mod_rooted',
    name: 'Rooted',
    icon: '\u{1F332}', // evergreen tree
    description: 'Standing still briefly grants armor bonus.',
    tags: ['Nature', 'Shield', 'Buff'],
    triggerSentence: 'After standing still for 1.5s, gain +5 armor until you move.',
    rarity: 'Common',
    baseWeight: 1.0,
    effects: [{ type: 'stat_mod', stat: 'stationary_armor', value: 5 }],
    synergyNote: 'Good for casters who stand and channel.',
  },
  {
    id: 'mod_feral',
    name: 'Feral',
    icon: '\u{1F43B}', // bear
    description: 'Increases attack speed but reduces armor.',
    tags: ['Physical', 'Transform', 'Buff'],
    triggerSentence: 'Gain +20% attack speed. Lose 3 armor.',
    rarity: 'Uncommon',
    baseWeight: 0.65,
    effects: [
      { type: 'stat_mod', stat: 'attack_speed', value: 0.20, percent: true },
      { type: 'stat_mod', stat: 'armor', value: -3 },
    ],
    synergyNote: 'Glass cannon modifier. Synergizes with Transform builds.',
  },
  {
    id: 'mod_sprouting',
    name: 'Sprouting',
    icon: '\u{1F33B}', // sunflower
    description: 'On kill, leave a small healing zone.',
    tags: ['Nature', 'Heal', 'OnKill'],
    triggerSentence: 'On kill, create a healing sprout that restores 8 HP over 3s to allies.',
    rarity: 'Uncommon',
    baseWeight: 0.65,
    effects: [{ type: 'trigger', trigger: { event: 'OnKill', effect: 'spawn_heal_zone', value: 8 } }],
    synergyNote: 'Sustain through aggression. Good for Swarm builds.',
  },
  {
    id: 'mod_spirit_touched',
    name: 'Spirit-Touched',
    icon: '\u{1F47B}', // ghost
    description: 'Skills occasionally trigger a spirit echo.',
    tags: ['Spirit', 'Cooldown', 'Ranged'],
    triggerSentence: 'Skills have 10% chance to fire a spirit bolt at nearest enemy for 8 damage.',
    rarity: 'Rare',
    baseWeight: 0.35,
    effects: [{ type: 'trigger', trigger: { event: 'OnHit', effect: 'spirit_bolt', value: 8, cooldownMs: 2000 } }],
    synergyNote: 'Free extra damage. Works with all builds.',
  },
  {
    id: 'mod_adaptive',
    name: 'Adaptive',
    icon: '\u{1F300}', // cyclone
    description: 'Item gains bonus stats matching your most common build tag.',
    tags: ['Nature', 'Buff'],
    triggerSentence: 'Gain +8% to your dominant damage type (determined by most common build tag).',
    rarity: 'Rare',
    baseWeight: 0.35,
    effects: [{ type: 'stat_mod', stat: 'adaptive_damage', value: 0.08, percent: true }],
    synergyNote: 'Universally good. Scales with focused builds.',
  },
  {
    id: 'mod_rejuvenating',
    name: 'Rejuvenating',
    icon: '\u{1F343}', // leaf fluttering
    description: 'Gain HP regen based on number of Nature-tagged passives.',
    tags: ['Nature', 'Heal', 'Passive'],
    triggerSentence: 'Gain +1 HP/3s for each Nature-tagged passive you have.',
    rarity: 'Uncommon',
    baseWeight: 0.65,
    effects: [{ type: 'stat_mod', stat: 'nature_passive_regen', value: 1 }],
    synergyNote: 'Scaling sustain. Better the more Nature passives you stack.',
  },
];
