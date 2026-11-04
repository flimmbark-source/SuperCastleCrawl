// ============================================================
// Glyphdelve - Tactical Model
//
// The Beat economy. Every action costs Beats; Beats are exactly what the
// enemies get to spend. This is the game's central currency and replaces
// the old wall-clock cooldown system entirely.
// ============================================================

import type { Tag } from '../types';
import type { Tile } from './grid';

/**
 * One Beat is the atomic unit of time. Every cost and every enemy speed is an
 * integer number of Beats, so the player can always do the arithmetic in their
 * head: "this costs 4 Beats, the imp acts every 2, so it gets two turns."
 */
export type Beats = number;

export const ACTION_COSTS = {
  wait: 1,
  move: 2,
  attackCaster: 2,
  attackBear: 3,
  transform: 2,
} as const;

/**
 * Beat cost of a skill, derived from its authored cooldown.
 *
 * The range is deliberately narrow (2-5). In a game where spending Beats is
 * literally handing the enemies turns, an 8-Beat action is almost never the
 * right buy against a 2-Beat attack — measured: a bot given skills at the old
 * wider costs performed *worse* than one that ignored them entirely. Cooldown,
 * not Beat cost, is what keeps strong skills in check.
 */
export function defaultBeatCost(legacyCooldownSeconds: number): Beats {
  if (legacyCooldownSeconds <= 0) return 2;
  return Math.max(2, Math.min(5, Math.round(legacyCooldownSeconds * 0.35) + 2));
}

// --- Intent --------------------------------------------------
// Enemies declare what they will do BEFORE they do it, and the player sees it.
// Attacks are committed: once declared, the tiles are locked in and the enemy
// will strike them even if the target walks away. That commitment is what makes
// dodging a real decision rather than a dice roll.

export type Intent =
  | { kind: 'move'; path: Tile[]; to: Tile; label: string }
  | { kind: 'attack'; tiles: Tile[]; damage: number; label: string; melee: boolean; effect?: string }
  | { kind: 'summon'; tiles: Tile[]; label: string; summonId: string }
  | { kind: 'hazard'; tiles: Tile[]; damage: number; label: string }
  | { kind: 'wait'; label: string };

export function intentTargetTiles(intent: Intent | null): Tile[] {
  if (!intent) return [];
  switch (intent.kind) {
    case 'attack': return intent.tiles;
    case 'hazard': return intent.tiles;
    case 'summon': return intent.tiles;
    case 'move': return [intent.to];
    default: return [];
  }
}

/** Does this intent actually threaten damage? Drives the red telegraph colour. */
export function intentIsDangerous(intent: Intent | null): boolean {
  return intent?.kind === 'attack' || intent?.kind === 'hazard';
}

// --- Statuses ------------------------------------------------
// Durations are in Beats, not seconds, so they decay on the same clock as
// everything else and are fully deterministic.

export type StatusId =
  | 'bleed' | 'slow' | 'stun' | 'brittle' | 'exposed' | 'poison' | 'root' | 'weaken';

export interface StatusState {
  stacks: number;
  /** Remaining Beats. -1 means "until consumed". */
  beats: number;
}

export type StatusBag = Partial<Record<StatusId, StatusState>>;

export interface StatusInfo {
  id: StatusId;
  name: string;
  icon: string;
  colour: string;
  /** Shown on the status pip tooltip. Written as a rule, not as flavour. */
  rule: string;
  stacking: boolean;
  harmful: boolean;
}

export const STATUSES: Record<StatusId, StatusInfo> = {
  bleed: {
    id: 'bleed', name: 'Bleed', icon: '🩸', colour: '#e05c6e', stacking: true, harmful: true,
    rule: 'Loses 1 HP per stack each time it acts, then loses a stack.',
  },
  poison: {
    id: 'poison', name: 'Poison', icon: '☣', colour: '#8bc34a', stacking: true, harmful: true,
    rule: 'Loses 1 HP per stack each time it acts. Does not decay on its own.',
  },
  slow: {
    id: 'slow', name: 'Slow', icon: '🐌', colour: '#64b5f6', stacking: true, harmful: true,
    rule: 'Each stack adds +1 Beat to everything it does.',
  },
  stun: {
    id: 'stun', name: 'Stun', icon: '💫', colour: '#ffd54f', stacking: false, harmful: true,
    rule: 'Skips its next action entirely.',
  },
  root: {
    id: 'root', name: 'Root', icon: '🌱', colour: '#4caf50', stacking: false, harmful: true,
    rule: 'Cannot move, but can still attack.',
  },
  brittle: {
    id: 'brittle', name: 'Brittle', icon: '✸', colour: '#ff8a65', stacking: false, harmful: true,
    rule: 'The next hit against it deals +50% damage, then Brittle is consumed.',
  },
  exposed: {
    id: 'exposed', name: 'Exposed', icon: '◎', colour: '#ba68c8', stacking: false, harmful: true,
    rule: 'Takes +25% damage from every source while it lasts.',
  },
  weaken: {
    id: 'weaken', name: 'Weaken', icon: '▽', colour: '#90a4ae', stacking: false, harmful: true,
    rule: 'Deals 20% less damage while it lasts.',
  },
};

export const STATUS_CAPS: Record<StatusId, number> = {
  bleed: 15, poison: 12, slow: 3, stun: 1, root: 1, brittle: 1, exposed: 1, weaken: 1,
};

export function getStatus(bag: StatusBag, id: StatusId): StatusState | undefined {
  return bag[id];
}

export function statusStacks(bag: StatusBag, id: StatusId): number {
  return bag[id]?.stacks ?? 0;
}

export function hasStatus(bag: StatusBag, id: StatusId): boolean {
  return (bag[id]?.stacks ?? 0) > 0;
}

export function applyStatus(bag: StatusBag, id: StatusId, stacks: number, beats: number): void {
  const cap = STATUS_CAPS[id];
  const cur = bag[id];
  if (!cur) {
    bag[id] = { stacks: Math.min(stacks, cap), beats };
    return;
  }
  cur.stacks = Math.min(cur.stacks + stacks, cap);
  // Refresh rather than stack duration, so re-application never runs away.
  cur.beats = Math.max(cur.beats, beats);
}

export function clearStatus(bag: StatusBag, id: StatusId): void {
  delete bag[id];
}

/**
 * Advance timed statuses by `beats`. Returns the ids that expired.
 * Stack-decay statuses (bleed) are handled when an actor acts, not here.
 */
export function tickStatusDurations(bag: StatusBag, beats: Beats): StatusId[] {
  const expired: StatusId[] = [];
  (Object.keys(bag) as StatusId[]).forEach(id => {
    const s = bag[id];
    if (!s) return;
    if (s.beats < 0) return; // until-consumed
    s.beats -= beats;
    if (s.beats <= 0) {
      delete bag[id];
      expired.push(id);
    }
  });
  return expired;
}

// --- Actors --------------------------------------------------

export type ActorKind = 'player' | 'enemy' | 'summon';

export interface Actor {
  id: string;
  kind: ActorKind;
  faction: 'player' | 'enemy';
  /** Tile coordinates. Actors are always on integers. */
  tile: Tile;
  hp: number;
  maxHp: number;
  armor: number;
  alive: boolean;
  tags: Tag[];

  /** Beat timestamp of this actor's next action. */
  nextActAt: Beats;
  /** Beats between this actor's actions. Lower is faster. */
  actSpeed: Beats;
  intent: Intent | null;

  statuses: StatusBag;
  facing: Tile;

  /** Definition id for enemies/summons; used for rendering and data lookup. */
  defId?: string;
  name: string;

  /** Transient render state, never read by game logic. */
  flashMs: number;
  deathAnimMs: number;
  /** Where the actor is drawn from, for movement tweening. */
  renderTile?: Tile;
  renderT?: number;

  /** Per-actor scratch space for content effects. Typed, unlike the old `as any`. */
  flags: Record<string, number | boolean | string>;
}

export interface HazardZone {
  id: string;
  tile: Tile;
  damage: number;
  /** Remaining Beats. */
  beats: Beats;
  faction: 'player' | 'enemy';
  tags: Tag[];
  name: string;
  colour: string;
}

/** A purely visual effect; game logic never reads these. */
export interface VisualEffect {
  id: string;
  kind: 'tracer' | 'burst' | 'slash' | 'text' | 'ring' | 'shove';
  from?: Tile;
  to?: Tile;
  tile?: Tile;
  colour: string;
  text?: string;
  ageMs: number;
  lifeMs: number;
  radius?: number;
}

// --- Player action descriptors -------------------------------
// What the player can do this turn, with its Beat cost, surfaced to the UI so
// the cost is visible BEFORE committing. This is the heart of the interface.

export type PlayerActionKind = 'move' | 'attack' | 'skill' | 'wait' | 'transform';

export interface PlayerActionOption {
  kind: PlayerActionKind;
  id: string;
  label: string;
  cost: Beats;
  /** Why this cannot be taken right now, if it cannot. */
  disabledReason?: string;
  /** Beats of cooldown remaining, for skills. */
  cooldownBeats?: number;
  /** Tiles this action would affect, for hover preview. */
  previewTiles?: Tile[];
  description?: string;
  tags?: Tag[];
}
