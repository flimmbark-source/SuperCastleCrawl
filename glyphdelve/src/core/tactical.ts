// ============================================================
// Glyphdelve - Tactical Engine
//
// The room-scale game. Pure and headless: no DOM, no requestAnimationFrame,
// no renderer. Everything it produces for the UI is plain data, which is what
// lets the whole thing be driven by a test or an automated playtest bot.
//
// The Beat is the only clock. The player spends Beats; the enemies spend the
// same Beats. There is no wall-clock anywhere in this file.
// ============================================================

import type { NodeType, PlayerEntity, Tag } from '../types';
import { HARD_CAPS } from '../types';
import { SeededRNG } from '../engine/SeededRNG';
import { registry } from '../engine/DataRegistry';
import type { Tile } from './grid';
import {
  Grid, tileDist, tileKey, canTarget, stepToward, neighbors8,
  tilesInRadius, findPath, DIRECTIONS_8,
} from './grid';
import { generateRoom } from './roomgen';
import type {
  Actor, Beats, HazardZone, Intent, PlayerActionOption, VisualEffect,
} from './model';
import {
  ACTION_COSTS, defaultBeatCost, tickStatusDurations, hasStatus, clearStatus,
} from './model';
import type { CombatContext, LogLine } from './combat';
import {
  newChainGuard, dealDamage, dealAreaDamage, inflictStatus, shove,
  killActor, runActorUpkeep, tickHazards, spawnHazard, logLine, fx,
  occupiedTiles, livingEnemies, actorAt, emit, heal, freeNeighbourTile,
} from './combat';
import { installContentHooks, decayOwnedFlags } from './contentHooks';
import {
  declareIntent, executeIntent, spawnEnemyActor, resetEnemySeq, ARCHETYPE_SPEED,
} from './ai';

installContentHooks();

/**
 * Content whose effect changes what an action IS, rather than reacting to an
 * event. Implemented in this file; listed here so the coverage test can see it.
 */
export const ENGINE_IMPLEMENTED_IDS: ReadonlySet<string> = new Set([
  'wild_stride_boots',   // Move costs 1 less Beat, leaves a thorn trail
  'winding_paws',        // Move ignores Bramble cost and crosses Chasms
  'leaping_greaves',     // Move becomes a 2-tile Leap with landing damage
  'splinter_fang',       // Ranged attack also strikes the flanking tiles
  'condensed_fury',      // Area effects are 1 smaller but strike twice
  'rootgrip_staff',      // Area effects gain +1 radius
  'echo_seed',           // Skills may repeat at reduced power
  'echo_seed_reformed',  // Skills may refund their cooldown; skills cost +1 Beat
]);

// --- Player combat profile ------------------------------------
// Tuned from first principles against floor-1 enemy HP (15-45) so that the
// opening room is winnable by a level-1 player, which it previously was not.

export const FORM = {
  caster: {
    name: 'Caster Form',
    attackLabel: 'Bark Bolt',
    range: 5,
    damage: 11,
    cost: ACTION_COSTS.attackCaster,
    melee: false,
    damageTakenMult: 1.0,
    hpMult: 1.0,
    tags: ['Ranged', 'Nature', 'Attack'] as Tag[],
  },
  bear: {
    name: 'Bear Form',
    attackLabel: 'Claw Sweep',
    range: 1,
    damage: 14,
    cost: ACTION_COSTS.attackBear,
    melee: true,
    damageTakenMult: 0.8,
    hpMult: 1.2,
    tags: ['Melee', 'Physical', 'Attack'] as Tag[],
  },
} as const;

export type FormId = keyof typeof FORM;

// --- Engine state ---------------------------------------------

export type RoomOutcome = 'ongoing' | 'cleared' | 'defeat';

/** Beats a room may go without a kill before Delve Pressure rises a step. */
export const PRESSURE_INTERVAL = 18;
/** Grace at the start of a room, so simply crossing it costs nothing. */
export const PRESSURE_GRACE = 14;
/**
 * Ceiling on Delve Pressure. It exists to make stalling expensive, not to
 * execute the player: left uncapped a stalled room reached +26 bonus damage,
 * which kills outright regardless of how well the fight was being played.
 */
export const PRESSURE_MAX = 8;

export interface RoomStats {
  beatsSpent: number;
  damageTaken: number;
  damageDealt: number;
  kills: number;
}

export interface TacticalSnapshot {
  grid: Grid;
  actors: Actor[];
  hazards: HazardZone[];
  effects: VisualEffect[];
  log: LogLine[];
  clock: Beats;
  outcome: RoomOutcome;
  form: FormId;
  layoutName: string;
  stats: RoomStats;
  pressure: number;
  /** Beats until Pressure rises again, for the HUD countdown. */
  beatsToPressure: number;
}

export interface PerformResult {
  ok: boolean;
  reason?: string;
  beatsSpent: Beats;
  outcome: RoomOutcome;
  /** Enemies killed by this action, for XP/loot award by the caller. */
  killed: Actor[];
}

export interface SkillRuntime {
  id: string;
  name: string;
  cooldownBeats: number;
  cooldownRemaining: number;
  beatCost: number;
  tags: Tag[];
  description: string;
}

export class TacticalEngine {
  ctx: CombatContext;
  player!: Actor;
  outcome: RoomOutcome = 'ongoing';
  form: FormId = 'caster';
  layoutName = '';
  skills: SkillRuntime[] = [];
  stats: RoomStats = { beatsSpent: 0, damageTaken: 0, damageDealt: 0, kills: 0 };

  private rng: SeededRNG;
  private idSeq = 0;
  private meta: PlayerEntity;
  private nodeType: NodeType = 'combat';
  private beatsSinceKill = 0;

  constructor(rng: SeededRNG, meta: PlayerEntity) {
    this.rng = rng;
    this.meta = meta;
    this.ctx = {
      grid: new Grid(1, 1),
      actors: [],
      hazards: [],
      effects: [],
      log: [],
      rng,
      clock: 0,
      owned: { passiveIds: new Set(), itemIds: new Set(), skillIds: new Set(), flags: {} },
      chain: newChainGuard(),
      nextId: () => `fx${++this.idSeq}`,
      killedThisResolution: [],
      pressure: 0,
    };
  }

  // --- Room setup ---------------------------------------------

  startRoom(nodeType: NodeType, floor: number, enemyIds: string[], isElite: boolean): void {
    this.nodeType = nodeType;
    this.outcome = 'ongoing';
    this.stats = { beatsSpent: 0, damageTaken: 0, damageDealt: 0, kills: 0 };
    resetEnemySeq();

    const room = generateRoom(this.rng, nodeType, floor, enemyIds.length);
    this.layoutName = room.layoutName;

    this.ctx.grid = room.grid;
    this.ctx.actors = [];
    this.ctx.hazards = [];
    this.ctx.effects = [];
    this.ctx.log = [];
    this.ctx.clock = 0;
    this.ctx.killedThisResolution = [];
    this.ctx.pressure = 0;
    this.beatsSinceKill = -PRESSURE_GRACE;
    this.syncOwnedFromMeta();
    this.ctx.owned.flags = {
      damageScalar: this.meta.damageScalar,
      playerArmor: this.meta.armor,
      beatsSinceHit: 99,
    };

    this.player = {
      id: 'player',
      kind: 'player',
      faction: 'player',
      tile: { ...room.playerSpawn },
      hp: this.meta.hp,
      maxHp: this.meta.maxHp,
      armor: this.meta.armor,
      alive: true,
      tags: [],
      nextActAt: 0,
      actSpeed: 0,
      intent: null,
      statuses: {},
      facing: { x: 1, y: 0 },
      name: 'You',
      flashMs: 0,
      deathAnimMs: 0,
      flags: {},
    };
    this.ctx.owned.flags.baseMaxHp = this.meta.maxHp;
    this.ctx.actors.push(this.player);

    // Form carries across rooms; re-apply its HP modifier to the fresh actor.
    if (this.form === 'bear') this.applyFormStats('bear', true);

    this.rebuildSkills();

    enemyIds.forEach((id, i) => {
      const tile = room.enemySpawns[i];
      if (!tile) return;
      spawnEnemyActor(this.ctx, id, tile, floor, isElite && i === 0);
    });

    logLine(this.ctx, 'system', `${room.layoutName} — ${enemyIds.length} hostiles`, true);
    this.refreshAllIntents();
  }

  private syncOwnedFromMeta(): void {
    this.ctx.owned.passiveIds = new Set(this.meta.passives.filter(p => p.active).map(p => p.def.id));
    this.ctx.owned.itemIds = new Set(this.meta.items.map(i => i.def.id));
    this.ctx.owned.skillIds = new Set(this.meta.skills.map(s => s.def.id));
  }

  /** Rebuild the per-room skill runtimes from the player's owned skills. */
  rebuildSkills(): void {
    this.syncOwnedFromMeta();
    this.skills = this.meta.skills.map(s => {
      const extra = this.ctx.owned.itemIds.has('echo_seed_reformed') ? 1 : 0;
      return {
        id: s.def.id,
        name: s.def.name,
        cooldownBeats: Math.max(0, Math.round(s.def.cooldown * 1.5)),
        cooldownRemaining: 0,
        beatCost: defaultBeatCost(s.def.cooldown) + extra,
        tags: s.def.tags,
        description: s.def.triggerSentence || s.def.description,
      };
    });
  }

  snapshot(): TacticalSnapshot {
    return {
      grid: this.ctx.grid,
      actors: this.ctx.actors,
      hazards: this.ctx.hazards,
      effects: this.ctx.effects,
      log: this.ctx.log,
      clock: this.ctx.clock,
      outcome: this.outcome,
      form: this.form,
      layoutName: this.layoutName,
      stats: this.stats,
      pressure: this.ctx.pressure,
      beatsToPressure: Math.max(0, Math.round(PRESSURE_INTERVAL - this.beatsSinceKill)),
    };
  }

  // --- Action enumeration -------------------------------------
  // The UI shows these with their Beat cost BEFORE the player commits.
  // Making the price visible is the whole point of the Beat economy.

  moveCost(to: Tile): Beats {
    let cost = ACTION_COSTS.move;
    if (!this.ctx.owned.itemIds.has('winding_paws')) {
      cost += this.ctx.grid.moveCostPenalty(to.x, to.y);
    }
    if (this.ctx.owned.itemIds.has('wild_stride_boots')) cost -= 1;
    if (this.ctx.owned.itemIds.has('leaping_greaves')) cost += 1;
    return this.applyCostModifiers(Math.max(1, cost));
  }

  attackCost(): Beats {
    return this.applyCostModifiers(FORM[this.form].cost);
  }

  skillCost(s: SkillRuntime): Beats {
    let c = s.beatCost;
    const discount = Number(this.ctx.owned.flags.nextSkillBeatDiscount ?? 0);
    if (discount > 0 && !s.tags.includes('Summon')) c -= discount;
    return this.applyCostModifiers(Math.max(1, c));
  }

  /** Slow taxes everything; Primal Instinct discounts it. Applied last. */
  private applyCostModifiers(cost: Beats): Beats {
    let c = cost;
    const slow = this.player ? (this.player.statuses.slow?.stacks ?? 0) : 0;
    c += slow;
    if (Number(this.ctx.owned.flags.hasteActions ?? 0) > 0) c -= 1;
    return Math.max(1, c);
  }

  /** How far can the player move in one action? Leaping Greaves makes it 2. */
  moveRange(): number {
    return this.ctx.owned.itemIds.has('leaping_greaves') ? 2 : 1;
  }

  canMoveTo(to: Tile): { ok: boolean; reason?: string } {
    if (!this.ctx.grid.inBounds(to.x, to.y)) return { ok: false, reason: 'Outside the room' };
    const crossesChasm = this.ctx.owned.itemIds.has('winding_paws') || this.moveRange() > 1;
    if (!this.ctx.grid.isPassable(to.x, to.y)) {
      const lethal = this.ctx.grid.isLethal(to.x, to.y);
      if (!(lethal && crossesChasm)) {
        return { ok: false, reason: this.ctx.grid.info(to.x, to.y).name + ' blocks the way' };
      }
      // Even a leap cannot end inside a chasm.
      return { ok: false, reason: 'You would fall' };
    }
    if (hasStatus(this.player.statuses, 'root')) return { ok: false, reason: 'You are Rooted' };
    const d = tileDist(this.player.tile, to);
    if (d === 0 || d > this.moveRange()) return { ok: false, reason: 'Out of step range' };
    if (actorAt(this.ctx, to)) return { ok: false, reason: 'Occupied' };

    // A single step may not cut a diagonal corner between two blocked tiles.
    if (d === 1) {
      const dx = to.x - this.player.tile.x;
      const dy = to.y - this.player.tile.y;
      if (dx !== 0 && dy !== 0) {
        const a = this.ctx.grid.isPassable(this.player.tile.x + dx, this.player.tile.y);
        const b = this.ctx.grid.isPassable(this.player.tile.x, this.player.tile.y + dy);
        if (!a && !b) return { ok: false, reason: 'No room to squeeze through' };
      }
    }
    return { ok: true };
  }

  /** Tiles the player could step to this turn, each with its Beat price. */
  moveOptions(): { tile: Tile; cost: Beats }[] {
    const out: { tile: Tile; cost: Beats }[] = [];
    const r = this.moveRange();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = { x: this.player.tile.x + dx, y: this.player.tile.y + dy };
        if (this.canMoveTo(t).ok) out.push({ tile: t, cost: this.moveCost(t) });
      }
    }
    return out;
  }

  canAttack(target: Tile): { ok: boolean; reason?: string } {
    const f = FORM[this.form];
    const d = tileDist(this.player.tile, target);
    if (d === 0) return { ok: false, reason: 'Pick a target' };
    if (d > f.range) return { ok: false, reason: `Out of range (${f.range})` };
    if (!f.melee && !canTarget(this.ctx.grid, this.player.tile, target)) {
      return { ok: false, reason: 'No line of fire' };
    }
    return { ok: true };
  }

  /** Enemy tiles the player can hit right now. Drives target highlighting. */
  attackableTiles(): Tile[] {
    return livingEnemies(this.ctx)
      .filter(e => this.canAttack(e.tile).ok)
      .map(e => e.tile);
  }

  /** Which tiles an attack on `target` would actually strike. */
  attackPreview(target: Tile): Tile[] {
    const f = FORM[this.form];
    if (f.melee) {
      const dir = stepToward(this.player.tile, target);
      return this.cleaveTiles(dir);
    }
    if (this.ctx.owned.itemIds.has('splinter_fang')) {
      return [target, ...this.flankTiles(target)];
    }
    return [target];
  }

  private cleaveTiles(dir: Tile): Tile[] {
    const p = this.player.tile;
    const centre = { x: p.x + dir.x, y: p.y + dir.y };
    return [centre, ...this.flankTiles(centre, dir)];
  }

  private flankTiles(centre: Tile, dir?: Tile): Tile[] {
    const d = dir ?? stepToward(this.player.tile, centre);
    // Perpendicular offsets to the strike direction.
    const perp = d.x !== 0 && d.y !== 0
      ? [{ x: d.x, y: 0 }, { x: 0, y: d.y }]
      : [{ x: d.y, y: d.x }, { x: -d.y, y: -d.x }];
    return perp
      .map(o => ({ x: centre.x + o.x, y: centre.y + o.y }))
      .filter(t => this.ctx.grid.inBounds(t.x, t.y));
  }

  /**
   * Why the player cannot attack right now, stated accurately. Distinguishing
   * "out of range" from "behind cover" matters, because the two call for
   * opposite moves: close in, or step sideways for an angle.
   */
  private attackBlockedReason(): string | undefined {
    if (this.attackableTiles().length > 0) return undefined;
    const enemies = livingEnemies(this.ctx);
    if (!enemies.length) return 'Nothing left standing';

    const f = FORM[this.form];
    const nearest = enemies.reduce((best, e) =>
      tileDist(this.player.tile, e.tile) < tileDist(this.player.tile, best.tile) ? e : best,
      enemies[0]);
    const d = tileDist(this.player.tile, nearest.tile);

    if (d > f.range) return `Out of range — ${f.attackLabel} reaches ${f.range}`;
    if (this.ctx.grid.get(nearest.tile.x, nearest.tile.y) === 'bramble') {
      return 'Target is hidden in bramble';
    }
    return 'No clear line of fire';
  }

  availableActions(): PlayerActionOption[] {
    const out: PlayerActionOption[] = [];
    out.push({
      kind: 'wait', id: 'wait', label: 'Focus', cost: this.applyCostModifiers(ACTION_COSTS.wait),
      description: 'Hold position for a single Beat. The cheapest way to let an enemy come to you.',
    });

    const f = FORM[this.form];
    out.push({
      kind: 'attack', id: 'attack', label: f.attackLabel, cost: this.attackCost(),
      description: f.melee
        ? `Sweep the tile in front of you and both tiles beside it for ${f.damage}, shoving survivors back.`
        : `Strike one target up to ${f.range} tiles away for ${f.damage}. Needs a clear line of fire.`,
      tags: [...f.tags],
      disabledReason: this.attackBlockedReason(),
    });

    this.skills.forEach(s => {
      out.push({
        kind: 'skill', id: s.id, label: s.name, cost: this.skillCost(s),
        cooldownBeats: s.cooldownRemaining,
        disabledReason: s.cooldownRemaining > 0 ? `${s.cooldownRemaining} Beats left` : undefined,
        description: s.description,
        tags: s.tags,
      });
    });

    return out;
  }

  // --- Action execution ---------------------------------------

  performMove(to: Tile): PerformResult {
    const check = this.canMoveTo(to);
    if (!check.ok) return this.fail(check.reason!);

    const from = { ...this.player.tile };
    const cost = this.moveCost(to);
    this.beginResolution();

    this.player.facing = stepToward(from, to);
    this.player.tile = { ...to };

    if (this.ctx.owned.itemIds.has('wild_stride_boots')) {
      spawnHazard(this.ctx, from, 3, 4, 'player', 'Thorn Trail', '#8bc34a', ['DOT', 'Physical']);
    }
    if (this.ctx.owned.itemIds.has('leaping_greaves')) {
      fx(this.ctx, { kind: 'burst', tile: to, colour: '#ffb74d', lifeMs: 420, radius: 1 });
      this.areaStrike({
        centre: to, radius: 1, amount: 8, type: 'physical',
        tags: ['AOE', 'OnMove', 'Physical'], colour: '#ffb74d',
      });
    }

    emit(this.ctx, { type: 'OnMove', actor: this.player, from, to });
    return this.endResolution(cost);
  }

  performAttack(target: Tile): PerformResult {
    const check = this.canAttack(target);
    if (!check.ok) return this.fail(check.reason!);

    const f = FORM[this.form];
    const cost = this.attackCost();
    this.beginResolution();
    this.player.facing = stepToward(this.player.tile, target);

    const tiles = this.attackPreview(target);

    if (f.melee) {
      fx(this.ctx, { kind: 'slash', tile: tiles[0], colour: '#ffb74d', lifeMs: 280 });
    } else {
      fx(this.ctx, { kind: 'tracer', from: this.player.tile, to: target, colour: '#aed581', lifeMs: 220 });
    }

    const victims = livingEnemies(this.ctx)
      .filter(e => tiles.some(t => t.x === e.tile.x && t.y === e.tile.y));

    const hit: Actor[] = [];
    for (const v of victims) {
      const r = dealDamage(this.ctx, {
        attacker: this.player, target: v, amount: f.damage,
        type: f.melee ? 'physical' : 'nature', tags: [...f.tags], melee: f.melee,
      });
      if (r.dealt > 0) hit.push(v);
      // Bear sweeps shove survivors, which is how chasms become a weapon.
      if (f.melee && v.alive) {
        shove(this.ctx, this.player, v, stepToward(this.player.tile, v.tile), 1);
      }
    }

    // Momentum Strike is consumed by the attack it empowered.
    if (this.ctx.owned.flags.momentumStrikeArmed) {
      this.ctx.owned.flags.momentumStrikeArmed = false;
      this.ctx.owned.flags.momentumStrikeBeats = 0;
    }

    if (hit.length > 1) {
      emit(this.ctx, {
        type: 'OnAreaDamage', attacker: this.player,
        targets: hit, damage: f.damage, tags: [...f.tags, 'AOE'],
      });
    }
    emit(this.ctx, { type: 'OnAttack', actor: this.player, tags: [...f.tags] });

    return this.endResolution(cost);
  }

  performWait(): PerformResult {
    this.beginResolution();
    logLine(this.ctx, 'system', 'You hold your ground');
    return this.endResolution(this.applyCostModifiers(ACTION_COSTS.wait));
  }

  performSkill(skillId: string, aim?: Tile): PerformResult {
    const s = this.skills.find(x => x.id === skillId);
    if (!s) return this.fail('Unknown skill');
    if (s.cooldownRemaining > 0) return this.fail(`${s.cooldownRemaining} Beats of cooldown left`);

    const cost = this.skillCost(s);
    this.beginResolution();

    const target = aim ?? this.autoAim(s);
    this.executeSkill(s, target, 1);

    // Echo Seed: a chance to repeat the whole effect at reduced power.
    if (this.ctx.owned.itemIds.has('echo_seed') && this.rng.chance(0.15)) {
      logLine(this.ctx, 'trigger', `Echo Seed repeats ${s.name}`, true);
      this.executeSkill(s, target, 0.4);
    }

    s.cooldownRemaining = s.cooldownBeats;

    // Echo Seed (Reformed): a chance to refund the cooldown entirely.
    if (this.ctx.owned.itemIds.has('echo_seed_reformed') && this.rng.chance(0.2)) {
      s.cooldownRemaining = 0;
      logLine(this.ctx, 'trigger', `Echo Seed refunds ${s.name}`, true);
    }

    if (Number(this.ctx.owned.flags.nextSkillBeatDiscount ?? 0) > 0 && !s.tags.includes('Summon')) {
      this.ctx.owned.flags.nextSkillBeatDiscount = 0;
    }

    return this.endResolution(cost);
  }

  private autoAim(s: SkillRuntime): Tile {
    const enemies = livingEnemies(this.ctx);
    if (!enemies.length) return this.player.tile;
    let best = enemies[0];
    let bd = tileDist(this.player.tile, best.tile);
    for (const e of enemies) {
      const d = tileDist(this.player.tile, e.tile);
      if (d < bd) { best = e; bd = d; }
    }
    return best.tile;
  }

  // --- Skill effects ------------------------------------------

  private executeSkill(s: SkillRuntime, target: Tile, power: number): void {
    const def = registry.getSkill(s.id);
    if (!def) return;
    const dmg = (def.damage ?? 0) * power;

    switch (s.id) {
      case 'bear_form_transform':
      case 'bear_form_enhanced':
        this.toggleForm();
        return;

      case 'summon_briar_wolf':
      case 'summon_briar_wolf_alpha': {
        const max = def.maxSummons ?? 1;
        this.summonWolf(def.id, Math.round(dmg) || 8, max);
        return;
      }

      case 'entangling_vines': {
        const hit = this.areaStrike({
          centre: target, radius: 1, amount: dmg, type: 'nature',
          tags: ['AOE', 'Nature', 'Debuff'], colour: '#66bb6a',
        });
        hit.forEach(e => inflictStatus(this.ctx, this.player, e, 'root', 1, 4));
        return;
      }

      case 'spore_bolt': {
        const victim = actorAt(this.ctx, target);
        if (victim && victim.faction === 'enemy') {
          dealDamage(this.ctx, {
            attacker: this.player, target: victim, amount: dmg,
            type: 'poison', tags: ['Ranged', 'Poison', 'Projectile'],
          });
          inflictStatus(this.ctx, this.player, victim, 'poison', 2, -1);
        }
        fx(this.ctx, { kind: 'tracer', from: this.player.tile, to: target, colour: '#9ccc65', lifeMs: 240 });
        return;
      }

      case 'spirit_swarm': {
        // Hits every enemy with a clear line, regardless of distance.
        const victims = livingEnemies(this.ctx)
          .filter(e => canTarget(this.ctx.grid, this.player.tile, e.tile));
        victims.forEach(v => {
          fx(this.ctx, { kind: 'tracer', from: this.player.tile, to: v.tile, colour: '#b39ddb', lifeMs: 300 });
          dealDamage(this.ctx, {
            attacker: this.player, target: v, amount: dmg,
            type: 'spirit', tags: ['Spirit', 'AOE'],
          });
        });
        if (victims.length > 1) {
          emit(this.ctx, {
            type: 'OnAreaDamage', attacker: this.player,
            targets: victims, damage: dmg, tags: ['Spirit', 'AOE'],
          });
        }
        return;
      }

      case 'thornburst': {
        const hit = this.areaStrike({
          centre: this.player.tile, radius: 2, amount: dmg, type: 'physical',
          tags: ['AOE', 'Physical', 'Nature'], colour: '#ff8a65',
        });
        hit.forEach(e =>
          shove(this.ctx, this.player, e, stepToward(this.player.tile, e.tile), 1));
        return;
      }

      case 'totemic_ward': {
        const spot = freeNeighbourTile(this.ctx, this.player.tile) ?? this.player.tile;
        this.summonTotem(spot, Math.round(12 * power));
        return;
      }

      case 'fungal_link': {
        // Links your summons: they all gain a burst of health and speed.
        const summons = this.ctx.actors.filter(a => a.alive && a.kind === 'summon');
        summons.forEach(s2 => {
          heal(this.ctx, s2, Math.round(10 * power));
          s2.actSpeed = Math.max(2, s2.actSpeed - 1);
        });
        this.player.flags.shieldHp = Number(this.player.flags.shieldHp ?? 0) + Math.round(10 * power);
        logLine(this.ctx, 'trigger', `Fungal Link binds ${summons.length} summons`, true);
        return;
      }

      case 'wild_charge': {
        // Dash toward the target, trampling everything on the way.
        const path = findPath(this.ctx.grid, this.player.tile, target, {
          occupied: new Set(), ignoreOccupiedAtGoal: true,
        });
        const steps = (path ?? []).slice(1, 4);
        for (const st of steps) {
          const blocker = actorAt(this.ctx, st);
          if (blocker && blocker.faction === 'enemy') {
            dealDamage(this.ctx, {
              attacker: this.player, target: blocker, amount: dmg,
              type: 'physical', tags: ['Melee', 'Physical', 'Trample'],
            });
            shove(this.ctx, this.player, blocker, stepToward(this.player.tile, st), 1);
            if (!blocker.alive) this.player.tile = { ...st };
            break;
          }
          if (!this.ctx.grid.isPassable(st.x, st.y)) break;
          this.player.tile = { ...st };
        }
        fx(this.ctx, { kind: 'shove', from: this.player.tile, to: target, colour: '#ffb74d', lifeMs: 300 });
        return;
      }

      case 'roaring_sprint': {
        this.areaStrike({
          centre: this.player.tile, radius: 2, amount: Math.max(dmg, 6), type: 'physical',
          tags: ['AOE', 'OnMove', 'Nature'], colour: '#d2691e',
        });
        return;
      }

      case 'repeating_echo': {
        this.ctx.owned.flags.nextSkillBeatDiscount = 2;
        this.player.flags.shieldHp = Number(this.player.flags.shieldHp ?? 0) + 8;
        logLine(this.ctx, 'trigger', 'Repeating Echo: your next skill costs 2 fewer Beats', true);
        return;
      }

      case 'thorn_mantle': {
        // Retaliation aura: thorn zones bloom around you as you are struck.
        tilesInRadius(this.ctx.grid, this.player.tile, 1).forEach(t =>
          spawnHazard(this.ctx, t, 4, 8, 'player', 'Thorn Mantle', '#8d6e63', ['DOT', 'Physical']));
        logLine(this.ctx, 'trigger', 'Thorn Mantle bristles around you', true);
        return;
      }

      default: {
        // Unknown skills still do something honest rather than silently nothing.
        if (dmg > 0) {
          this.areaStrike({
            centre: target, radius: def.aoeRadius ? 1 : 0, amount: dmg,
            type: 'nature', tags: def.tags, colour: '#aed581',
          });
        }
      }
    }
  }

  /** Area damage with the player's area-modifying items folded in. */
  private areaStrike(spec: {
    centre: Tile; radius: number; amount: number;
    type: 'physical' | 'nature' | 'poison' | 'spirit'; tags: Tag[]; colour: string;
  }): Actor[] {
    let radius = spec.radius;
    let times = 1;
    if (this.ctx.owned.itemIds.has('rootgrip_staff')) radius += 1;
    if (this.ctx.owned.itemIds.has('condensed_fury')) {
      radius = Math.max(0, radius - 1);
      times = 2;
    }
    let hit: Actor[] = [];
    for (let i = 0; i < times; i++) {
      hit = dealAreaDamage(this.ctx, {
        attacker: this.player, centre: spec.centre, radius,
        amount: spec.amount, type: spec.type, tags: spec.tags,
        hits: 'enemy', requireLos: true, colour: spec.colour,
      });
    }
    return hit;
  }

  private summonWolf(defId: string, damage: number, maxSummons: number): void {
    const existing = this.ctx.actors.filter(a => a.alive && a.kind === 'summon' && a.defId === defId);
    const cap = Math.min(maxSummons, HARD_CAPS.maxActiveSummons);
    if (existing.length >= cap) {
      // Replace the weakest rather than refusing the cast outright.
      const weakest = existing.sort((a, b) => a.hp - b.hp)[0];
      if (weakest) killActor(this.ctx, weakest, null);
    }
    const spot = freeNeighbourTile(this.ctx, this.player.tile);
    if (!spot) { logLine(this.ctx, 'system', 'No room to summon'); return; }

    const wolf: Actor = {
      id: `s${++this.idSeq}`, kind: 'summon', faction: 'player',
      tile: { ...spot }, hp: 26, maxHp: 26, armor: 0, alive: true,
      tags: ['Summon', 'Nature', 'Melee'],
      nextActAt: this.ctx.clock + 3, actSpeed: 3, intent: null,
      statuses: {}, facing: { x: 1, y: 0 }, defId,
      name: 'Briar Wolf', flashMs: 0, deathAnimMs: 0,
      flags: { damage, lifespan: 24 },
    };
    this.ctx.actors.push(wolf);
    fx(this.ctx, { kind: 'ring', tile: spot, colour: '#8bc34a', lifeMs: 420, radius: 1 });
    logLine(this.ctx, 'trigger', 'A Briar Wolf answers', true);
    emit(this.ctx, { type: 'OnSummon', actor: this.player, summonId: defId });
  }

  private summonTotem(spot: Tile, damage: number): void {
    const totem: Actor = {
      id: `s${++this.idSeq}`, kind: 'summon', faction: 'player',
      tile: { ...spot }, hp: 20, maxHp: 20, armor: 2, alive: true,
      tags: ['Summon', 'Totem', 'Nature'],
      nextActAt: this.ctx.clock + 4, actSpeed: 4, intent: null,
      statuses: {}, facing: { x: 1, y: 0 }, defId: 'totem',
      name: 'Bark Totem', flashMs: 0, deathAnimMs: 0,
      flags: { damage, lifespan: 20, immobile: true },
    };
    this.ctx.actors.push(totem);
    fx(this.ctx, { kind: 'ring', tile: spot, colour: '#a1887f', lifeMs: 420, radius: 1 });
    logLine(this.ctx, 'trigger', 'A Bark Totem roots itself', true);
    emit(this.ctx, { type: 'OnSummon', actor: this.player, summonId: 'totem' });
  }

  private toggleForm(): void {
    const into: FormId = this.form === 'bear' ? 'caster' : 'bear';
    this.applyFormStats(into, false);
    this.form = into;
    fx(this.ctx, {
      kind: 'ring', tile: this.player.tile,
      colour: into === 'bear' ? '#8d6e63' : '#66bb6a', lifeMs: 520, radius: 1,
    });
    logLine(this.ctx, 'trigger', `You shift into ${FORM[into].name}`, true);
    emit(this.ctx, { type: 'OnTransform', actor: this.player, intoBear: into === 'bear' });
  }

  /**
   * Bear Form grants +20% max HP. Derived from a stored base so repeated
   * toggles can never drift the player's maximum, which the old code did.
   */
  private applyFormStats(into: FormId, silent: boolean): void {
    const base = Number(this.ctx.owned.flags.baseMaxHp ?? this.player.maxHp);
    const target = Math.round(base * FORM[into].hpMult);
    const delta = target - this.player.maxHp;
    this.player.maxHp = target;
    if (delta > 0) this.player.hp += delta;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    if (!silent && delta !== 0) {
      fx(this.ctx, {
        kind: 'text', tile: this.player.tile, colour: '#66bb6a',
        text: delta > 0 ? `+${delta}` : `${delta}`, lifeMs: 700,
      });
    }
  }

  // --- Resolution plumbing -------------------------------------

  private fail(reason: string): PerformResult {
    return { ok: false, reason, beatsSpent: 0, outcome: this.outcome, killed: [] };
  }

  private beginResolution(): void {
    this.ctx.chain = newChainGuard();
    this.ctx.killedThisResolution = [];
    this.hpBefore = this.player.hp;
  }

  private hpBefore = 0;

  private endResolution(cost: Beats): PerformResult {
    const killedByPlayer = [...this.ctx.killedThisResolution];
    this.advanceClock(cost);

    const killed = [...killedByPlayer, ...this.ctx.killedThisResolution]
      .filter((a, i, arr) => arr.findIndex(b => b.id === a.id) === i)
      .filter(a => a.faction === 'enemy');

    this.stats.beatsSpent += cost;
    this.stats.kills += killed.length;

    // Delve Pressure: killing something resets the dungeon's patience.
    if (killed.length > 0) {
      this.beatsSinceKill = 0;
      if (this.ctx.pressure > 0) {
        this.ctx.pressure = 0;
        logLine(this.ctx, 'system', 'The pressure eases', true);
      }
    } else {
      this.beatsSinceKill += cost;
      while (this.beatsSinceKill >= PRESSURE_INTERVAL) {
        this.beatsSinceKill -= PRESSURE_INTERVAL;
        if (this.ctx.pressure >= PRESSURE_MAX) break;
        this.ctx.pressure = Math.min(PRESSURE_MAX, this.ctx.pressure + 1);
        logLine(this.ctx, 'system',
          `The delve presses in — enemies hit for +${this.ctx.pressure}`, true);
      }
    }
    const lost = this.hpBefore - this.player.hp;
    if (lost > 0) this.stats.damageTaken += lost;

    this.updateOutcome();
    return { ok: true, beatsSpent: cost, outcome: this.outcome, killed };
  }

  /**
   * Spend Beats. Everything whose turn falls inside that window acts, in
   * clock order, executing the intent the player already saw.
   */
  private advanceClock(beats: Beats): void {
    const target = this.ctx.clock + beats;

    if (Number(this.ctx.owned.flags.hasteActions ?? 0) > 0) {
      this.ctx.owned.flags.hasteActions = Number(this.ctx.owned.flags.hasteActions) - 1;
    }

    // Guard against any pathological scheduling loop.
    let guard = 0;
    for (;;) {
      if (++guard > 400) break;

      const due = this.ctx.actors
        .filter(a => a.alive && a.id !== 'player' && a.nextActAt <= target)
        .sort((a, b) => a.nextActAt - b.nextActAt || a.id.localeCompare(b.id));

      if (!due.length) break;
      const actor = due[0];

      // Move the shared clock to this actor's moment so effects it causes are
      // stamped correctly and hazards burn down in the right order.
      const step = Math.max(0, actor.nextActAt - this.ctx.clock);
      if (step > 0) this.tickWorld(step);

      this.ctx.chain = newChainGuard();
      this.takeActorTurn(actor);

      if (!this.player.alive) break;
    }

    if (this.player.alive) {
      const remaining = Math.max(0, target - this.ctx.clock);
      if (remaining > 0) this.tickWorld(remaining);
      else this.ctx.clock = target;
    }

    // Player upkeep happens once per player action, at the end.
    if (this.player.alive) {
      this.ctx.chain = newChainGuard();
      runActorUpkeep(this.ctx, this.player);
      this.skills.forEach(s => {
        s.cooldownRemaining = Math.max(0, s.cooldownRemaining - beats);
      });
    }

    this.refreshAllIntents();
    this.syncMetaHp();
  }

  /** Advance the world clock by `beats` without giving anyone a turn. */
  private tickWorld(beats: Beats): void {
    this.ctx.clock += beats;
    tickHazards(this.ctx, beats);
    this.ctx.actors.forEach(a => {
      if (!a.alive) return;
      tickStatusDurations(a.statuses, beats);
    });
    decayOwnedFlags(this.ctx, beats);
    this.expireSummons(beats);
  }

  private expireSummons(beats: Beats): void {
    this.ctx.actors.forEach(a => {
      if (!a.alive || a.kind !== 'summon') return;
      const life = Number(a.flags.lifespan ?? 0) - beats;
      a.flags.lifespan = life;
      if (life <= 0) {
        logLine(this.ctx, 'system', `${a.name} fades`);
        killActor(this.ctx, a, null);
      }
    });
  }

  private takeActorTurn(actor: Actor): void {
    runActorUpkeep(this.ctx, actor);
    if (!actor.alive) return;

    if (hasStatus(actor.statuses, 'stun')) {
      clearStatus(actor.statuses, 'stun');
      logLine(this.ctx, 'status', `${actor.name} is stunned and loses its turn`);
      actor.nextActAt = this.ctx.clock + actor.actSpeed;
      declareIntent(this.ctx, actor);
      return;
    }

    if (actor.kind === 'summon') {
      this.takeSummonTurn(actor);
    } else {
      const res = executeIntent(this.ctx, actor);
      res.spawned.forEach(s => { s.nextActAt = this.ctx.clock + s.actSpeed; });
    }

    // Slow makes an actor act less often, same as it taxes the player.
    const slow = actor.statuses.slow?.stacks ?? 0;
    actor.nextActAt = this.ctx.clock + actor.actSpeed + slow;
    if (actor.alive) declareIntent(this.ctx, actor);
  }

  private takeSummonTurn(summon: Actor): void {
    const damage = Number(summon.flags.damage ?? 8) + Number(summon.flags.bonusDamage ?? 0);
    const focusId = String(this.ctx.owned.flags.hiveFocusId ?? '');
    const enemies = livingEnemies(this.ctx);
    if (!enemies.length) return;

    let target = enemies[0];
    const focused = enemies.find(e => e.id === focusId);
    if (focused) {
      target = focused;
    } else {
      let bd = tileDist(summon.tile, target.tile);
      for (const e of enemies) {
        const d = tileDist(summon.tile, e.tile);
        if (d < bd) { target = e; bd = d; }
      }
    }

    const d = tileDist(summon.tile, target.tile);
    const immobile = Boolean(summon.flags.immobile);

    if (d <= 1 || (immobile && d <= 3 && canTarget(this.ctx.grid, summon.tile, target.tile))) {
      fx(this.ctx, {
        kind: immobile ? 'tracer' : 'slash',
        from: summon.tile, to: target.tile, tile: target.tile,
        colour: '#aed581', lifeMs: 240,
      });
      dealDamage(this.ctx, {
        attacker: summon, target, amount: damage,
        type: 'nature', tags: immobile ? ['Totem', 'Nature'] : ['Melee', 'Summon', 'Nature'],
        melee: !immobile,
      });
      return;
    }

    if (immobile) return;

    const path = findPath(this.ctx.grid, summon.tile, target.tile, {
      occupied: occupiedTiles(this.ctx, summon.id), ignoreOccupiedAtGoal: true,
    });
    if (path && path.length > 1) {
      summon.facing = stepToward(summon.tile, path[1]);
      summon.tile = { ...path[1] };
    }
  }

  private refreshAllIntents(): void {
    this.ctx.actors.forEach(a => {
      if (a.alive && a.kind === 'enemy') declareIntent(this.ctx, a);
    });
  }

  private syncMetaHp(): void {
    // Meta HP tracks the form-independent base so toggling form between rooms
    // cannot be used to farm health.
    const base = Number(this.ctx.owned.flags.baseMaxHp ?? this.meta.maxHp);
    const ratioHp = Math.min(this.player.hp, this.player.maxHp);
    this.meta.hp = Math.max(0, Math.round(Math.min(ratioHp, base)));
    this.meta.maxHp = base;
  }

  private updateOutcome(): void {
    if (!this.player.alive || this.meta.hp <= 0) {
      this.outcome = 'defeat';
      return;
    }
    if (livingEnemies(this.ctx).length === 0) {
      this.outcome = 'cleared';
      return;
    }
    this.outcome = 'ongoing';
  }

  // --- Queries used by the UI ---------------------------------

  /** Every tile currently threatened by a declared enemy intent. */
  threatenedTiles(): Map<string, { damage: number; sources: string[] }> {
    const m = new Map<string, { damage: number; sources: string[] }>();
    this.ctx.actors.forEach(a => {
      if (!a.alive || a.faction !== 'enemy' || !a.intent) return;
      const i = a.intent;
      if (i.kind !== 'attack' && i.kind !== 'hazard') return;
      i.tiles.forEach(t => {
        const k = tileKey(t);
        const cur = m.get(k) ?? { damage: 0, sources: [] };
        cur.damage += i.damage;
        cur.sources.push(a.name);
        m.set(k, cur);
      });
    });
    return m;
  }

  /** Incoming damage if the player stays exactly where they are. */
  incomingDamageAt(tile: Tile): number {
    return this.threatenedTiles().get(tileKey(tile))?.damage ?? 0;
  }
}

export { DIRECTIONS_8, neighbors8, tileDist, tileKey };
export type { Tile, Actor, Intent, PlayerActionOption };
