// ============================================================
// Glyphdelve - Core Type Definitions
// ============================================================

// --- Tags & Modifiers ---
export type Tag =
  | 'Summon' | 'Nature' | 'Poison' | 'Physical' | 'Spirit'
  | 'AOE' | 'DOT' | 'Heal' | 'Shield' | 'Transform'
  | 'Melee' | 'Ranged' | 'Projectile' | 'Aura' | 'Totem'
  | 'OnHit' | 'OnKill' | 'OnDeath' | 'OnDamageTaken' | 'OnSummon'
  | 'Cooldown' | 'Channel' | 'Passive' | 'Buff' | 'Debuff';

export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Relic';

export type SynergyRating = 'High' | 'Med' | 'Low';

// --- Content Definitions ---
export interface SkillDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  tags: Tag[];
  triggerSentence: string;
  rarity: Rarity;
  baseWeight: number;
  cooldown: number;
  damage?: number;
  damageType?: string;
  range?: number;
  duration?: number;
  summonId?: string;
  maxSummons?: number;
  aoeRadius?: number;
  projectileSpeed?: number;
  projectileCount?: number;
  upgrades?: SkillUpgrade[];
  synergyNote: string;
}

export interface SkillUpgrade {
  id: string;
  name: string;
  icon: string;
  description: string;
  tags: Tag[];
  triggerSentence: string;
  rarity: Rarity;
  baseWeight: number;
  parentSkillId: string;
  modifications: Partial<SkillDef>;
  synergyNote: string;
}

export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  tags: Tag[];
  triggerSentence: string;
  rarity: Rarity;
  baseWeight: number;
  effect: PassiveEffect;
  synergyNote: string;
}

export interface PassiveEffect {
  type: 'stat_mod' | 'trigger' | 'aura' | 'conditional' | 'transform';
  stat?: string;
  value?: number;
  percent?: boolean;
  trigger?: TriggerDef;
  condition?: string;
}

export interface TriggerDef {
  event: Tag;
  chance?: number;
  effect: string;
  value?: number;
  cooldownMs?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  tags: Tag[];
  triggerSentence: string;
  rarity: Rarity;
  baseWeight: number;
  slot: 'weapon' | 'armor' | 'accessory' | 'relic';
  cooldown: number; // 0 = passive only, >0 = active cooldown in seconds
  effects: ItemEffect[];
  synergyNote: string;
}

export interface ItemEffect {
  type: 'stat_mod' | 'trigger' | 'on_equip' | 'aura' | 'special';
  stat?: string;
  value?: number;
  percent?: boolean;
  trigger?: TriggerDef;
  description?: string;
}

export interface ModifierDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  tags: Tag[];
  triggerSentence: string;
  rarity: Rarity;
  baseWeight: number;
  effects: ItemEffect[];
  synergyNote: string;
}

// --- Enemy Definitions ---
export type EnemyArchetype = 'melee_chaser' | 'ranged_spitter' | 'tank' | 'blinker' | 'hazard_generator';

export interface EnemyDef {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  hp: number;
  damage: number;
  speed: number;
  attackCooldown: number;
  attackRange: number;
  tags: Tag[];
  abilities?: EnemyAbility[];
  description: string;
  floorScaling: { hpMult: number; damageMult: number };
}

export interface EnemyAbility {
  id: string;
  name: string;
  cooldown: number;
  range: number;
  damage?: number;
  telegraphMs: number;
  aoeRadius?: number;
  effect?: string;
}

export interface EliteModifierDef {
  id: string;
  name: string;
  description: string;
  hpMult: number;
  damageMult: number;
  speedMult: number;
  abilities?: EnemyAbility[];
  tags: Tag[];
}

export interface BossDef extends EnemyDef {
  phases: BossPhase[];
}

export interface BossPhase {
  hpThreshold: number;
  abilities: EnemyAbility[];
  modifiers?: string[];
}

// --- Meld Definitions ---
export type MeldType = 'skill_skill' | 'passive_passive' | 'item_item';

export interface MeldRecipe {
  id: string;
  type: MeldType;
  input1Tags: Tag[];
  input2Tags: Tag[];
  outputId: string;
  outputType: 'skill' | 'passive' | 'item';
  emergentTrait: string;
  inheritedTraits: string[];
  cost: number;
}

// --- Runtime Entities ---
export interface Vec2 {
  x: number;
  y: number;
}

export interface Entity {
  id: string;
  type: 'player' | 'enemy' | 'summon' | 'projectile' | 'hazard';
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  faction: 'player' | 'enemy';
  tags: Tag[];
  alive: boolean;
  invulnMs: number;
  flashMs: number;
  deathAnimMs: number;
  animState: 'idle' | 'move' | 'attack' | 'hit' | 'death';
  rotation: number;
}

export interface PlayerEntity extends Entity {
  type: 'player';
  xp: number;
  level: number;
  xpToNext: number;
  essence: number;
  skills: ActiveSkill[];
  passives: ActivePassive[];
  items: ActiveItem[];
  maxSkillSlots: number;
  armor: number;
  damageScalar: number;
  attackSpeed: number;
  resource: number;
  maxResource: number;
  buildTags: Map<Tag, number>;
  inventory: InventoryItem[];
}

export interface ActiveSkill {
  def: SkillDef;
  cooldownRemaining: number;
  level: number;
  upgraded: boolean;
}

export interface ActivePassive {
  def: PassiveDef;
  active: boolean;
}

export interface ActiveItem {
  def: ItemDef;
  modifiers: ModifierDef[];
  melded: boolean;
  cooldownRemaining: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  effect: 'heal' | 'resource' | 'cleanse';
  value: number;
  charges: number;
}

export interface EnemyEntity extends Entity {
  type: 'enemy';
  def: EnemyDef;
  eliteModifier?: EliteModifierDef;
  abilityCooldowns: Map<string, number>;
  targetId?: string;
  behaviorState: string;
  poisonStacks: number;
  currentPhase?: number;
}

export interface SummonEntity extends Entity {
  type: 'summon';
  ownerId: string;
  summonDefId: string;
  duration: number;
  maxDuration: number;
  damage: number;
  attackCooldown: number;
  attackCooldownRemaining: number;
  attackRange: number;
}

export interface ProjectileEntity extends Entity {
  type: 'projectile';
  ownerId: string;
  damage: number;
  piercing: boolean;
  lifetime: number;
  maxLifetime: number;
  hitEntities: Set<string>;
  aoeOnImpact?: number;
}

export interface HazardEntity extends Entity {
  type: 'hazard';
  ownerId: string;
  damage: number;
  tickRate: number;
  tickTimer: number;
  duration: number;
  maxDuration: number;
}

// --- Map / Node ---
export type NodeType = 'combat' | 'elite' | 'shrine' | 'recovery' | 'event' | 'boss';

export interface MapNode {
  id: string;
  floor: number;
  index: number;
  type: NodeType;
  completed: boolean;
  connections: string[];
  enemies?: string[];
  rewards?: string[];
}

export interface FloorMap {
  floor: number;
  nodes: MapNode[];
}

// --- Run State ---
export interface EncounterLootEntry {
  id: string;
  name: string;
  rarity: Rarity;
  description: string;
  effectSummary: string;
}

export interface RunState {
  seed: number;
  floor: number;
  currentNodeIndex: number;
  maps: FloorMap[];
  player: PlayerEntity;
  entities: Entity[];
  combatActive: boolean;
  paused: boolean;
  gameSpeed: number;
  runComplete: boolean;
  runWon: boolean;
  runTime: number;
  killCount: number;
  normalKillsSinceItem: number;
  levelsWithoutHighSynergy: number;
  combatLog: CombatLogEntry[];
  offeredHistory: LevelUpSnapshot[];
  tagDistribution: Map<Tag, number>;
  triggerChainDepths: number[];
  meldHistory: MeldLogEntry[];
  deathCauseTaxonomy: Map<string, number>;
  encounterLoot: EncounterLootEntry[];
}

export interface CombatLogEntry {
  timestamp: number;
  type: 'damage' | 'heal' | 'kill' | 'trigger' | 'summon' | 'drop' | 'levelup' | 'meld';
  source: string;
  target?: string;
  value?: number;
  details: string;
}

export interface LevelUpSnapshot {
  level: number;
  offered: LevelUpOffer[];
  chosen: string;
}

export interface LevelUpOffer {
  id: string;
  type: 'skill' | 'passive' | 'skill_upgrade';
  name: string;
  icon: string;
  tags: Tag[];
  description: string;
  triggerSentence: string;
  rarity: Rarity;
  synergy: SynergyRating;
  finalWeight: number;
  synergyNote: string;
}

export interface MeldLogEntry {
  input1: string;
  input2: string;
  output: string;
  type: MeldType;
  cost: number;
}

// --- Accessibility ---
export interface AccessibilitySettings {
  keyBindings: Record<string, string>;
  gameSpeed: 0.75 | 1.0 | 1.25;
  fontScale: 100 | 125 | 150;
  colorblindMode: boolean;
  reducedMotion: boolean;
  screenShake: boolean;
  tooltipMode: 'plain' | 'detailed';
}

// --- Game Caps ---
export const HARD_CAPS = {
  maxActiveSummons: 8,
  minCooldown: 0.4,
  maxMoveSpeedMult: 1.2,   // +120% = 2.2x base
  maxAttackSpeedMult: 1.0,  // +100% = 2.0x base
  maxPoisonStacks: 12,
  maxAuraRadiusMult: 0.8,   // +80%
  maxDamageReduction: 0.7,  // 70%
  maxTriggerChainDepth: 4,
  maxSameTriggerRepeats: 2,
  maxSpawnedFromEvent: 6,
} as const;

// --- XP Table ---
export const XP_TABLE: Record<number, number> = {
  2: 60,
  3: 140,
  4: 240,
  5: 360,
  6: 500,
  7: 660,
  8: 840,
};

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (XP_TABLE[level]) return XP_TABLE[level];
  // Formula: previous + 20*level + 60
  const prev = xpForLevel(level - 1);
  return prev + 20 * level + 60;
}

// --- Drop Rates ---
export const DROP_RATES = {
  normal: { item: 0.12, essence: 0.22, consumable: 0.06, nothing: 0.60 },
  elite: { item: 0.65, essence: 1.0, consumable: 0.20 },
  boss: { item: 1.0, rareRelic: 0.35, essence: 1.0 },
  pityThreshold: 10,
  pityItemChance: 0.35,
} as const;

// --- Meld Costs ---
export const MELD_COSTS = {
  skill_skill: 45,
  passive_passive: 55,
  item_item: 35,
  reroll: 20,
} as const;
