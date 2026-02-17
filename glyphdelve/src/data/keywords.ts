// ============================================================
// Glyphdelve - Keyword & Status Definitions
// ============================================================

export interface KeywordDefinition {
  keyword: string;
  definition: string;
  example?: string;
  icon?: string;
}

export interface StatusDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  mechanics: string;
}

// --- Action Keywords ---
export const ACTION_KEYWORDS: KeywordDefinition[] = [
  {
    keyword: 'Move',
    definition: 'Change position on the grid. Base: straight line, 0.28s GCD',
    example: 'WASD keys to move 1 tile'
  },
  {
    keyword: 'Attack',
    definition: 'Basic attack action. Varies by form and class',
    example: 'Space key for basic attack'
  },
  {
    keyword: 'AoE',
    definition: 'Area of Effect damage or effect. Hits multiple targets in radius',
    example: 'Roar deals damage in 80 radius around you'
  },
  {
    keyword: 'Dash',
    definition: 'Move + effect combined. Instant repositioning with impact',
    example: 'Wild Charge moves and damages'
  },
  {
    keyword: 'Channel',
    definition: 'Timed buff or effect. Duration tracked, no interruption',
    example: 'Fungal Link channels for 6s'
  },
  {
    keyword: 'Transform',
    definition: 'Change form or state. Alters Move, Attack, and stats',
    example: 'Bear Form changes movement and attack'
  },
];

// --- Modifier Keywords ---
export const MODIFIER_KEYWORDS: KeywordDefinition[] = [
  {
    keyword: 'Leap',
    definition: 'Increased GCD (+60%). Arc movement trajectory. AoE damage on landing',
    example: 'Leaping Greaves: Move becomes Leap'
  },
  {
    keyword: 'Winding',
    definition: 'Movement follows curved path. 20% longer travel time. Dodge projectiles in path',
    example: 'Winding Paws: Move becomes Winding'
  },
  {
    keyword: 'Trample',
    definition: 'Deal damage to units moved through. Occurs during movement',
    example: 'Bear Form: Trample 6 damage'
  },
  {
    keyword: 'Splash',
    definition: 'Primary target + small AoE around impact point',
    example: 'Bark Missile: Splash 32 radius on expire'
  },
  {
    keyword: 'Pierce',
    definition: 'Projectile continues through targets after hitting',
    example: 'Momentum Strike grants Pierce 1'
  },
  {
    keyword: 'Echo',
    definition: 'Trigger twice with reduced effect (typically 60% on second)',
    example: 'Repeating Echo: Next ability triggers twice'
  },
  {
    keyword: 'Repeat',
    definition: 'Ability triggers additional times. Stacks multiply total casts',
    example: 'Echo Seed: 15% chance to refund cooldown'
  },
  {
    keyword: 'Roar',
    definition: 'AoE damage + status application. Centered on caster or destination',
    example: 'Roaring Sprint: Roar at end of Move'
  },
];

// --- Trigger Keywords ---
export const TRIGGER_KEYWORDS: KeywordDefinition[] = [
  {
    keyword: 'On Move',
    definition: 'Triggers when Move action is taken or completes',
    example: 'Roaring Sprint: On Move completion'
  },
  {
    keyword: 'On Attack',
    definition: 'Triggers when Attack action is taken',
    example: 'Momentum Strike: After Move, next Attack boosted'
  },
  {
    keyword: 'On Transform',
    definition: 'Triggers when changing forms (both directions)',
    example: 'Feral Adaptation: On Transform, gain invuln'
  },
  {
    keyword: 'On Debuff Applied',
    definition: 'Triggers when applying any debuff to enemy (Bleed, Slow, Poison, etc.)',
    example: 'Debilitating Presence: On Debuff Applied, also apply Slow'
  },
  {
    keyword: 'On Area Damage',
    definition: 'Triggers when dealing AoE damage (any source)',
    example: 'Bleeding Wounds: On Area Damage, apply Bleed'
  },
  {
    keyword: 'On Hit',
    definition: 'Triggers when damage is successfully dealt',
    example: 'Brittle Fury: On Hit with melee, apply Brittle'
  },
  {
    keyword: 'On Kill',
    definition: 'Triggers when enemy dies from your damage',
    example: 'Death Blossom: On Kill, summons explode'
  },
  {
    keyword: 'On Damage Taken',
    definition: 'Triggers when you take damage (post-mitigation)',
    example: 'Thorn Mantle: On Damage Taken, emit AoE pulse'
  },
];

// --- Status Effects ---
export const STATUS_DEFINITIONS: StatusDefinition[] = [
  {
    id: 'bleed',
    name: 'Bleed',
    icon: '🩸',
    description: 'Damage over time that self-decays',
    mechanics: 'At the start of your turn, take damage equal to Bleed stacks, then reduce Bleed by 1. Max 15 stacks'
  },
  {
    id: 'slow',
    name: 'Slow',
    icon: '❄️',
    description: 'Movement penalty',
    mechanics: 'Move actions take +50% longer per stack (increased global cooldown). Max 3 stacks. Duration-based (4s per stack)'
  },
  {
    id: 'stun',
    name: 'Stun',
    icon: '💫',
    description: 'Action denial',
    mechanics: 'Cannot take actions. Cleared at start of your next turn. Cannot stack'
  },
  {
    id: 'brittle',
    name: 'Brittle',
    icon: '🔹',
    description: 'Burst vulnerability window',
    mechanics: 'Next damage taken is increased by 50%. Removed after taking damage or after 3s. Does not stack'
  },
  {
    id: 'exposed',
    name: 'Exposed',
    icon: '🎯',
    description: 'Sustained vulnerability',
    mechanics: 'Take +25% damage from all sources. Duration 4s, refreshes on reapplication'
  },
  {
    id: 'poison',
    name: 'Poison',
    icon: '☠️',
    description: 'Damage over time (existing system)',
    mechanics: 'Take 2 damage per stack per second. Max 12 stacks. No natural decay'
  },
  {
    id: 'root',
    name: 'Root',
    icon: '🌿',
    description: 'Movement prevention',
    mechanics: 'Cannot use Move actions. Duration-based. Does not prevent other actions'
  },
  {
    id: 'weaken',
    name: 'Weaken',
    icon: '💔',
    description: 'Damage reduction',
    mechanics: 'Deal 20% less damage. Duration-based'
  },
];

// --- Helper Functions ---
export function getKeywordDefinition(keyword: string): KeywordDefinition | undefined {
  const normalized = keyword.toLowerCase();
  return [
    ...ACTION_KEYWORDS,
    ...MODIFIER_KEYWORDS,
    ...TRIGGER_KEYWORDS
  ].find(k => k.keyword.toLowerCase() === normalized);
}

export function getStatusDefinition(statusId: string): StatusDefinition | undefined {
  return STATUS_DEFINITIONS.find(s => s.id === statusId);
}

export function getStatusIcon(statusId: string): string {
  const status = getStatusDefinition(statusId);
  return status?.icon || '?';
}

export const KEYWORD_MAP: Record<string, string> = {
  // Actions
  'move': 'Move',
  'attack': 'Attack',
  'aoe': 'AoE',
  'dash': 'Dash',
  'channel': 'Channel',
  'transform': 'Transform',
  // Modifiers
  'leap': 'Leap',
  'winding': 'Winding',
  'trample': 'Trample',
  'splash': 'Splash',
  'pierce': 'Pierce',
  'echo': 'Echo',
  'repeat': 'Repeat',
  'roar': 'Roar',
  // Triggers
  'on move': 'On Move',
  'on attack': 'On Attack',
  'on transform': 'On Transform',
  'on debuff applied': 'On Debuff Applied',
  'on area damage': 'On Area Damage',
  'on hit': 'On Hit',
  'on kill': 'On Kill',
  'on damage taken': 'On Damage Taken',
};
