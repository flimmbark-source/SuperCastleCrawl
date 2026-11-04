// ============================================================
// Glyphdelve - Combat Resolution
//
// Pure and deterministic: given the same state and RNG, the same result.
// No DOM, no timers, no renderer. Visuals are emitted as data for the
// renderer to consume later.
// ============================================================

import type { Tag } from '../types';
import { HARD_CAPS } from '../types';
import type { Grid, Tile } from './grid';
import { tileDist, tilesInRadius, canTarget, tileKey, neighbors8 } from './grid';
import type {
  Actor, Beats, HazardZone, StatusBag, StatusId, VisualEffect,
} from './model';
import {
  applyStatus, hasStatus, statusStacks, clearStatus, STATUSES,
} from './model';
import type { SeededRNG } from '../engine/SeededRNG';

// --- Context -------------------------------------------------

export interface LogLine {
  beat: number;
  text: string;
  kind: 'damage' | 'heal' | 'kill' | 'trigger' | 'status' | 'system' | 'loot';
  important?: boolean;
}

/**
 * Everything combat resolution is allowed to touch. Keeping this explicit is
 * what makes the whole layer testable without a browser.
 */
export interface CombatContext {
  grid: Grid;
  actors: Actor[];
  hazards: HazardZone[];
  effects: VisualEffect[];
  log: LogLine[];
  rng: SeededRNG;
  clock: Beats;
  /** The player's owned content, consulted by hooks. */
  owned: OwnedContent;
  /** Trigger-chain guards, reset per originating event. */
  chain: ChainGuard;
  nextId: () => string;
  /** Accumulates kills so the engine can award XP after resolution. */
  killedThisResolution: Actor[];
  /**
   * Delve Pressure. Rises the longer a room goes without a kill and adds flat
   * damage to every enemy attack. It exists so that stalling has a price:
   * without it, a same-speed enemy can be kited indefinitely and the room
   * simply never resolves.
   */
  pressure: number;
}

export interface OwnedContent {
  passiveIds: Set<string>;
  itemIds: Set<string>;
  skillIds: Set<string>;
  /** Mutable player-scoped scratch, replacing the old `(player as any)._foo`. */
  flags: Record<string, number | boolean | string>;
}

export interface ChainGuard {
  depth: number;
  counts: Map<string, number>;
  spawned: number;
}

export function newChainGuard(): ChainGuard {
  return { depth: 0, counts: new Map(), spawned: 0 };
}

function canFire(ctx: CombatContext, id: string): boolean {
  if (ctx.chain.depth >= HARD_CAPS.maxTriggerChainDepth) return false;
  if ((ctx.chain.counts.get(id) ?? 0) >= HARD_CAPS.maxSameTriggerRepeats) return false;
  return true;
}

function recordFire(ctx: CombatContext, id: string): void {
  ctx.chain.depth++;
  ctx.chain.counts.set(id, (ctx.chain.counts.get(id) ?? 0) + 1);
}

export function logLine(
  ctx: CombatContext, kind: LogLine['kind'], text: string, important = false,
): void {
  ctx.log.push({ beat: ctx.clock, text, kind, important });
  if (ctx.log.length > 240) ctx.log.shift();
}

export function fx(ctx: CombatContext, e: Omit<VisualEffect, 'id' | 'ageMs'>): void {
  ctx.effects.push({ ...e, id: ctx.nextId(), ageMs: 0 });
}

export function findActor(ctx: CombatContext, id: string): Actor | undefined {
  return ctx.actors.find(a => a.id === id);
}

export function livingEnemies(ctx: CombatContext): Actor[] {
  return ctx.actors.filter(a => a.alive && a.faction === 'enemy');
}

export function livingAllies(ctx: CombatContext): Actor[] {
  return ctx.actors.filter(a => a.alive && a.faction === 'player');
}

export function actorAt(ctx: CombatContext, t: Tile): Actor | undefined {
  return ctx.actors.find(a => a.alive && a.tile.x === t.x && a.tile.y === t.y);
}

export function occupiedTiles(ctx: CombatContext, except?: string): Set<string> {
  const s = new Set<string>();
  ctx.actors.forEach(a => {
    if (!a.alive || a.id === except) return;
    s.add(tileKey(a.tile));
  });
  return s;
}

// --- Triggers ------------------------------------------------

export type TriggerEvent =
  | { type: 'OnHit'; attacker: Actor; target: Actor; damage: number; tags: Tag[] }
  | { type: 'OnDamageTaken'; target: Actor; attacker: Actor; damage: number; tags: Tag[] }
  | { type: 'OnKill'; attacker: Actor; target: Actor }
  | { type: 'OnDeath'; target: Actor; killer: Actor | null }
  | { type: 'OnAreaDamage'; attacker: Actor; targets: Actor[]; damage: number; tags: Tag[] }
  | { type: 'OnDebuffApplied'; attacker: Actor; target: Actor; status: StatusId }
  | { type: 'OnMove'; actor: Actor; from: Tile; to: Tile }
  | { type: 'OnAttack'; actor: Actor; tags: Tag[] }
  | { type: 'OnTransform'; actor: Actor; intoBear: boolean }
  | { type: 'OnSummon'; actor: Actor; summonId: string }
  | { type: 'OnActorTurn'; actor: Actor };

export type TriggerType = TriggerEvent['type'];

export interface ContentHook {
  /** Content id this implements. Must match a declared skill/passive/item id. */
  id: string;
  /** Where the content comes from, so we can check ownership correctly. */
  source: 'passive' | 'item' | 'skill';
  on: TriggerType[];
  handle: (ev: TriggerEvent, ctx: CombatContext) => void;
}

const HOOKS: ContentHook[] = [];
const HOOKS_BY_EVENT = new Map<TriggerType, ContentHook[]>();

export function registerHook(h: ContentHook): void {
  HOOKS.push(h);
  h.on.forEach(t => {
    if (!HOOKS_BY_EVENT.has(t)) HOOKS_BY_EVENT.set(t, []);
    HOOKS_BY_EVENT.get(t)!.push(h);
  });
}

export function registerHooks(hs: ContentHook[]): void {
  hs.forEach(registerHook);
}

/** Exposed so a test can assert no declared content is left unimplemented. */
export function registeredHookIds(): Set<string> {
  return new Set(HOOKS.map(h => h.id));
}

function owns(ctx: CombatContext, h: ContentHook): boolean {
  if (h.source === 'passive') return ctx.owned.passiveIds.has(h.id);
  if (h.source === 'item') return ctx.owned.itemIds.has(h.id);
  return ctx.owned.skillIds.has(h.id);
}

export function emit(ctx: CombatContext, ev: TriggerEvent): void {
  const hooks = HOOKS_BY_EVENT.get(ev.type);
  if (!hooks) return;
  for (const h of hooks) {
    if (!owns(ctx, h)) continue;
    const key = `${h.id}:${ev.type}`;
    if (!canFire(ctx, key)) continue;
    recordFire(ctx, key);
    h.handle(ev, ctx);
    ctx.chain.depth--;
  }
}

// --- Status application ---------------------------------------

export function inflictStatus(
  ctx: CombatContext,
  source: Actor,
  target: Actor,
  id: StatusId,
  stacks: number,
  beats: Beats,
): void {
  if (!target.alive) return;
  const before = statusStacks(target.statuses, id);
  applyStatus(target.statuses, id, stacks, beats);
  const after = statusStacks(target.statuses, id);
  if (after === before && before > 0) return;

  fx(ctx, {
    kind: 'text', tile: target.tile, colour: STATUSES[id].colour,
    text: STATUSES[id].icon, lifeMs: 600,
  });
  logLine(ctx, 'status', `${target.name} gains ${STATUSES[id].name}${stacks > 1 ? ` x${stacks}` : ''}`);

  if (STATUSES[id].harmful && source.faction === 'player') {
    emit(ctx, { type: 'OnDebuffApplied', attacker: source, target, status: id });
  }
}

// --- Damage ---------------------------------------------------

export interface DamageSpec {
  attacker: Actor;
  target: Actor;
  amount: number;
  type: 'physical' | 'nature' | 'poison' | 'spirit';
  tags: Tag[];
  /** Melee damage can be reflected and can trigger melee-only content. */
  melee?: boolean;
  /** Suppress trigger emission; used by reflected/DoT damage to avoid loops. */
  silentTriggers?: boolean;
}

export interface DamageOutcome {
  dealt: number;
  killed: boolean;
}

export function dealDamage(ctx: CombatContext, spec: DamageSpec): DamageOutcome {
  const { attacker, target } = spec;
  if (!target.alive || !attacker) return { dealt: 0, killed: false };

  let dmg = spec.amount;

  // Delve Pressure makes every enemy blow land harder the longer you stall.
  if (attacker.faction === 'enemy' && !spec.silentTriggers) dmg += ctx.pressure;

  // --- Mitigation ---
  if (hasStatus(attacker.statuses, 'weaken')) dmg *= 0.8;

  if (attacker.faction === 'player') {
    dmg *= playerDamageMultiplier(ctx, spec);
  }

  // Brittle: consumed by the next hit.
  if (hasStatus(target.statuses, 'brittle')) {
    dmg *= 1.5;
    clearStatus(target.statuses, 'brittle');
    logLine(ctx, 'trigger', `Brittle shattered on ${target.name} (+50%)`);
  }
  if (hasStatus(target.statuses, 'exposed')) dmg *= 1.25;

  if (spec.type === 'physical' && target.armor > 0) {
    const reduction = Math.min(target.armor * 0.5, dmg * HARD_CAPS.maxDamageReduction);
    dmg = Math.max(1, dmg - reduction);
  }

  let final = Math.max(0, Math.round(dmg));

  // Shields absorb before HP.
  const shield = Number(target.flags.shieldHp ?? 0);
  if (shield > 0 && final > 0) {
    const absorbed = Math.min(shield, final);
    target.flags.shieldHp = shield - absorbed;
    final -= absorbed;
    if (absorbed > 0) {
      logLine(ctx, 'trigger', `Shield absorbed ${absorbed}`);
      fx(ctx, { kind: 'text', tile: target.tile, colour: '#64b5f6', text: `${absorbed}`, lifeMs: 700 });
    }
  }

  target.hp -= final;
  target.flashMs = 160;

  if (final > 0) {
    fx(ctx, {
      kind: 'text', tile: target.tile,
      colour: target.faction === 'enemy' ? '#ffd54f' : '#ef5350',
      text: `${final}`, lifeMs: 820,
    });
    if (attacker.id === target.id) {
      // Damage-over-time ticks are self-inflicted; phrase them as such rather
      // than "Skeleton Chaser hit Skeleton Chaser".
      const src = spec.type === 'poison' ? 'Poison' : spec.tags.includes('DOT') ? 'Bleed' : 'Backlash';
      logLine(ctx, 'damage', `${target.name} takes ${final} from ${src}`);
    } else {
      logLine(ctx, 'damage', `${attacker.name} hit ${target.name} for ${final}`);
    }
  }

  if (!spec.silentTriggers && final > 0) {
    emit(ctx, { type: 'OnDamageTaken', target, attacker, damage: final, tags: spec.tags });
    emit(ctx, { type: 'OnHit', attacker, target, damage: final, tags: spec.tags });
  }

  let killed = false;
  if (target.hp <= 0) {
    killed = true;
    killActor(ctx, target, attacker);
  }

  return { dealt: final, killed };
}

export function killActor(ctx: CombatContext, target: Actor, killer: Actor | null): void {
  if (!target.alive) return;
  target.hp = 0;
  target.alive = false;
  target.deathAnimMs = 420;
  target.intent = null;
  ctx.killedThisResolution.push(target);

  fx(ctx, { kind: 'burst', tile: target.tile, colour: '#ff7043', lifeMs: 520, radius: 1 });
  logLine(ctx, 'kill', `${target.name} is destroyed`, true);

  if (killer) emit(ctx, { type: 'OnKill', attacker: killer, target });
  emit(ctx, { type: 'OnDeath', target, killer });
}

/** Player-only damage scaling: build buffs, item bonuses, tag affinities. */
function playerDamageMultiplier(ctx: CombatContext, spec: DamageSpec): number {
  let m = Number(ctx.owned.flags.damageScalar ?? 1);

  // Feral Momentum: stacking damage buff from recent kills.
  const momentum = Number(ctx.owned.flags.feralMomentumStacks ?? 0);
  if (momentum > 0) m *= 1 + 0.08 * momentum;

  // Momentum Strike: empowers the next attack after a Move.
  if (ctx.owned.flags.momentumStrikeArmed && spec.tags.includes('Attack')) {
    m *= 1.4;
  }

  // Nature's Fury.
  if (ctx.owned.passiveIds.has('natures_fury') && spec.tags.includes('Nature')) m *= 1.15;

  // Summon-specific bonuses.
  if (spec.attacker.kind === 'summon') {
    if (ctx.owned.itemIds.has('hive_mind_crown')) m *= 1.1;
    if (ctx.owned.itemIds.has('packlord_coronet') && spec.target.flags.packlordMark) m *= 1.3;

    const summonCount = ctx.actors.filter(a => a.alive && a.kind === 'summon').length;
    if (ctx.owned.passiveIds.has('pack_tactics') && summonCount >= 2) m *= 1.2;
    if (ctx.owned.passiveIds.has('alpha_bond') && summonCount === 1) m *= 1.6;
  }

  // Moonbone Charm: brief boost after an elite dies.
  const moonbone = Number(ctx.owned.flags.moonboneBoost ?? 0);
  if (moonbone > 0) m *= 1 + moonbone;

  return m;
}

// --- Area damage ----------------------------------------------

export interface AreaSpec {
  attacker: Actor;
  centre: Tile;
  radius: number;
  amount: number;
  type: DamageSpec['type'];
  tags: Tag[];
  /** Only hit this faction. */
  hits: 'enemy' | 'player';
  /** Require line of fire from the centre (walls block blasts). */
  requireLos?: boolean;
  colour?: string;
  label?: string;
}

export function dealAreaDamage(ctx: CombatContext, spec: AreaSpec): Actor[] {
  const tiles = tilesInRadius(ctx.grid, spec.centre, spec.radius);
  const hitSet = new Set(tiles.map(tileKey));
  const victims = ctx.actors.filter(a =>
    a.alive && a.faction === spec.hits && hitSet.has(tileKey(a.tile)),
  );

  fx(ctx, {
    kind: 'ring', tile: spec.centre, colour: spec.colour ?? '#8bc34a',
    lifeMs: 460, radius: spec.radius,
  });

  const actuallyHit: Actor[] = [];
  for (const v of victims) {
    if (spec.requireLos && !canTarget(ctx.grid, spec.centre, v.tile)) continue;
    const r = dealDamage(ctx, {
      attacker: spec.attacker, target: v, amount: spec.amount,
      type: spec.type, tags: spec.tags,
    });
    if (r.dealt >= 0) actuallyHit.push(v);
  }

  if (actuallyHit.length > 0 && spec.attacker.faction === 'player') {
    emit(ctx, {
      type: 'OnAreaDamage', attacker: spec.attacker,
      targets: actuallyHit, damage: spec.amount, tags: spec.tags,
    });
  }
  return actuallyHit;
}

// --- Shove ----------------------------------------------------
// Knockback is a first-class verb: it repositions, it can kill outright by
// chasm, and it interacts with walls. This is the main emergent interaction
// the terrain system exists to enable.

export function shove(
  ctx: CombatContext, source: Actor, target: Actor, dir: Tile, distance: number,
): void {
  if (!target.alive || (dir.x === 0 && dir.y === 0)) return;
  let moved = 0;

  for (let i = 0; i < distance; i++) {
    const next = { x: target.tile.x + dir.x, y: target.tile.y + dir.y };

    if (ctx.grid.isLethal(next.x, next.y)) {
      target.tile = next;
      fx(ctx, { kind: 'shove', from: target.tile, to: next, colour: '#7e57c2', lifeMs: 420 });
      logLine(ctx, 'kill', `${target.name} is shoved into the chasm!`, true);
      killActor(ctx, target, source);
      return;
    }

    if (!ctx.grid.isPassable(next.x, next.y)) {
      // Slammed into a wall: the blocked momentum becomes damage.
      if (moved === 0 || true) {
        const impact = 3 + moved * 2;
        fx(ctx, { kind: 'burst', tile: target.tile, colour: '#b0bec5', lifeMs: 380, radius: 0 });
        logLine(ctx, 'trigger', `${target.name} slams into ${ctx.grid.info(next.x, next.y).name}`);
        dealDamage(ctx, {
          attacker: source, target, amount: impact,
          type: 'physical', tags: ['Physical'], silentTriggers: true,
        });
      }
      return;
    }

    const blocker = actorAt(ctx, next);
    if (blocker && blocker.id !== target.id) {
      // Collides with another actor: both take a little damage, neither moves on.
      dealDamage(ctx, {
        attacker: source, target, amount: 2,
        type: 'physical', tags: ['Physical'], silentTriggers: true,
      });
      dealDamage(ctx, {
        attacker: source, target: blocker, amount: 2,
        type: 'physical', tags: ['Physical'], silentTriggers: true,
      });
      return;
    }

    const from = { ...target.tile };
    target.tile = next;
    moved++;
    fx(ctx, { kind: 'shove', from, to: next, colour: '#90a4ae', lifeMs: 220 });
  }
}

// --- Per-turn upkeep ------------------------------------------

/**
 * Runs when an actor's own turn comes up: damage-over-time ticks and the
 * stack decay that makes Bleed a race against the actor's own speed.
 */
export function runActorUpkeep(ctx: CombatContext, actor: Actor): void {
  if (!actor.alive) return;

  const bleed = statusStacks(actor.statuses, 'bleed');
  if (bleed > 0) {
    dealDamage(ctx, {
      attacker: actor, target: actor, amount: bleed,
      type: 'physical', tags: ['DOT'], silentTriggers: true,
    });
    const s = actor.statuses.bleed;
    if (s) {
      s.stacks -= 1;
      if (s.stacks <= 0) clearStatus(actor.statuses, 'bleed');
    }
  }

  if (!actor.alive) return;

  const poison = statusStacks(actor.statuses, 'poison');
  if (poison > 0) {
    dealDamage(ctx, {
      attacker: actor, target: actor, amount: poison,
      type: 'poison', tags: ['DOT', 'Poison'], silentTriggers: true,
    });
  }

  if (actor.alive) emit(ctx, { type: 'OnActorTurn', actor });
}

/** Hazards burn down on the shared clock and damage whoever stands in them. */
export function tickHazards(ctx: CombatContext, beats: Beats): void {
  for (const h of ctx.hazards) {
    const victims = ctx.actors.filter(a =>
      a.alive && a.faction !== h.faction &&
      a.tile.x === h.tile.x && a.tile.y === h.tile.y,
    );
    for (const v of victims) {
      const attacker = ctx.actors.find(a => a.id === 'player') ?? v;
      dealDamage(ctx, {
        attacker: h.faction === 'player' ? attacker : v,
        target: v, amount: h.damage, type: 'poison',
        tags: h.tags, silentTriggers: true,
      });
    }
    h.beats -= beats;
  }
  ctx.hazards = ctx.hazards.filter(h => h.beats > 0);
}

export function spawnHazard(
  ctx: CombatContext, tile: Tile, damage: number, beats: Beats,
  faction: 'player' | 'enemy', name: string, colour: string, tags: Tag[] = ['DOT'],
): void {
  if (!ctx.grid.isPassable(tile.x, tile.y)) return;
  const existing = ctx.hazards.find(h => h.tile.x === tile.x && h.tile.y === tile.y);
  if (existing) {
    existing.beats = Math.max(existing.beats, beats);
    existing.damage = Math.max(existing.damage, damage);
    return;
  }
  ctx.hazards.push({
    id: ctx.nextId(), tile: { ...tile }, damage, beats, faction, name, colour, tags,
  });
}

// --- Helpers used by hooks and the engine ---------------------

export function enemiesWithin(ctx: CombatContext, centre: Tile, radius: number): Actor[] {
  return livingEnemies(ctx).filter(e => tileDist(e.tile, centre) <= radius);
}

export function alliesWithin(ctx: CombatContext, centre: Tile, radius: number): Actor[] {
  return livingAllies(ctx).filter(e => tileDist(e.tile, centre) <= radius);
}

export function freeNeighbourTile(ctx: CombatContext, around: Tile): Tile | null {
  const occupied = occupiedTiles(ctx);
  for (const n of neighbors8(around)) {
    if (!ctx.grid.isPassable(n.x, n.y)) continue;
    if (occupied.has(tileKey(n))) continue;
    return n;
  }
  return null;
}

export function heal(ctx: CombatContext, target: Actor, amount: number): void {
  if (!target.alive || amount <= 0) return;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const gained = Math.round(target.hp - before);
  if (gained > 0) {
    fx(ctx, { kind: 'text', tile: target.tile, colour: '#66bb6a', text: `+${gained}`, lifeMs: 800 });
    logLine(ctx, 'heal', `${target.name} heals ${gained}`);
  }
}

export { statusStacks, hasStatus };
export type { StatusBag };
