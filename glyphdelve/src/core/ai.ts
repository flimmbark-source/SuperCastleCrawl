// ============================================================
// Glyphdelve - Enemy Intent
//
// Enemies DECLARE what they will do, the player sees it, and then they do it.
// Attack intents are committed: the tiles are locked in when declared, so the
// enemy strikes those tiles even if you walk away. That commitment is the
// whole reason dodging is a decision instead of a dice roll.
// ============================================================

import type { EnemyDef } from '../types';
import type { Tile } from './grid';
import {
  tileDist, findPath, canTarget, neighbors8, tileKey,
  tilesInRadius, tilesInCone, stepToward, line,
} from './grid';
import type { Actor, Intent } from './model';
import { hasStatus } from './model';
import type { CombatContext } from './combat';
import {
  dealDamage, dealAreaDamage, inflictStatus, spawnHazard, shove,
  occupiedTiles, livingAllies, logLine, fx, actorAt, freeNeighbourTile,
} from './combat';
import { registry } from '../engine/DataRegistry';

/** Beats between actions, per archetype. Lower is faster and more threatening. */
export const ARCHETYPE_SPEED: Record<string, number> = {
  melee_chaser: 3,
  ranged_spitter: 4,
  tank: 5,
  blinker: 2,
  hazard_generator: 4,
};

function nearestTarget(ctx: CombatContext, from: Tile): Actor | null {
  const allies = livingAllies(ctx);
  if (!allies.length) return null;
  let best = allies[0];
  let bd = tileDist(from, best.tile);
  for (const a of allies) {
    // Prefer the player on ties so enemies do not endlessly chase summons.
    const d = tileDist(from, a.tile);
    if (d < bd || (d === bd && a.kind === 'player')) { best = a; bd = d; }
  }
  return best;
}

/**
 * The enemy's real damage, including floor scaling and elite bonuses.
 * Intents must use this, not the raw definition, or elites hit like trash.
 */
function dmgOf(enemy: Actor, def: EnemyDef): number {
  return Math.round(Number(enemy.flags.baseDamage ?? def.damage));
}

/**
 * Decide what this enemy will do on its NEXT activation and store it as intent.
 * Called after every one of its actions, so the board always shows the truth.
 */
export function declareIntent(ctx: CombatContext, enemy: Actor): void {
  if (!enemy.alive) { enemy.intent = null; return; }

  if (hasStatus(enemy.statuses, 'stun')) {
    enemy.intent = { kind: 'wait', label: 'Stunned' };
    return;
  }

  const def = enemy.defId ? registry.getEnemy(enemy.defId) : undefined;
  const target = nearestTarget(ctx, enemy.tile);
  if (!def || !target) {
    enemy.intent = { kind: 'wait', label: 'Idle' };
    return;
  }

  if (enemy.flags.isBoss) {
    enemy.intent = declareBossIntent(ctx, enemy, def, target);
    return;
  }

  switch (def.archetype) {
    case 'melee_chaser': enemy.intent = meleeIntent(ctx, enemy, def, target); break;
    case 'blinker': enemy.intent = blinkerIntent(ctx, enemy, def, target); break;
    case 'ranged_spitter': enemy.intent = rangedIntent(ctx, enemy, def, target); break;
    case 'tank': enemy.intent = tankIntent(ctx, enemy, def, target); break;
    case 'hazard_generator': enemy.intent = hazardIntent(ctx, enemy, def, target); break;
    default: enemy.intent = { kind: 'wait', label: 'Idle' };
  }
}

// --- Per-archetype intent -------------------------------------

function moveIntentToward(
  ctx: CombatContext, enemy: Actor, target: Actor, label = 'Advance',
): Intent {
  if (hasStatus(enemy.statuses, 'root')) {
    return { kind: 'wait', label: 'Rooted' };
  }
  const occupied = occupiedTiles(ctx, enemy.id);
  const path = findPath(ctx.grid, enemy.tile, target.tile, {
    occupied, ignoreOccupiedAtGoal: true,
  });
  if (!path || path.length < 2) {
    // No route: shuffle toward the target if any adjacent tile helps.
    const step = stepToward(enemy.tile, target.tile);
    const cand = { x: enemy.tile.x + step.x, y: enemy.tile.y + step.y };
    if (ctx.grid.isPassable(cand.x, cand.y) && !occupied.has(tileKey(cand))) {
      return { kind: 'move', path: [enemy.tile, cand], to: cand, label };
    }
    return { kind: 'wait', label: 'Blocked' };
  }
  const to = path[1];
  return { kind: 'move', path: [enemy.tile, to], to, label };
}

function meleeIntent(ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor): Intent {
  if (tileDist(enemy.tile, target.tile) <= 1) {
    return {
      kind: 'attack', tiles: [target.tile], damage: dmgOf(enemy, def),
      label: 'Strike', melee: true,
    };
  }
  return moveIntentToward(ctx, enemy, target);
}

function blinkerIntent(ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor): Intent {
  if (tileDist(enemy.tile, target.tile) <= 1) {
    return {
      kind: 'attack', tiles: [target.tile], damage: dmgOf(enemy, def),
      label: 'Rend', melee: true,
    };
  }
  // Every other action it blinks adjacent instead of walking.
  const charge = Number(enemy.flags.blinkCharge ?? 0);
  if (charge >= 1 && tileDist(enemy.tile, target.tile) <= 6) {
    const spot = freeNeighbourTile(ctx, target.tile);
    if (spot) {
      return { kind: 'move', path: [enemy.tile, spot], to: spot, label: 'Blink' };
    }
  }
  return moveIntentToward(ctx, enemy, target, 'Stalk');
}

function rangedIntent(ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor): Intent {
  const range = Math.max(2, Math.round(def.attackRange / 32));
  const d = tileDist(enemy.tile, target.tile);
  const clear = canTarget(ctx.grid, enemy.tile, target.tile);

  if (d <= range && clear) {
    // Too close is bad for a spitter: back off while still shooting next turn.
    if (d <= 1) {
      const away = stepToward(target.tile, enemy.tile);
      const back = { x: enemy.tile.x + away.x, y: enemy.tile.y + away.y };
      const occupied = occupiedTiles(ctx, enemy.id);
      if (ctx.grid.isPassable(back.x, back.y) && !occupied.has(tileKey(back))) {
        return { kind: 'move', path: [enemy.tile, back], to: back, label: 'Back off' };
      }
    }
    return {
      kind: 'attack', tiles: [target.tile], damage: dmgOf(enemy, def),
      label: 'Spit', melee: false, effect: 'poison',
    };
  }
  return moveIntentToward(ctx, enemy, target, clear ? 'Close in' : 'Find a line');
}

function tankIntent(ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor): Intent {
  const d = tileDist(enemy.tile, target.tile);
  const slamReady = Number(enemy.flags.slamCharge ?? 0) >= 1;

  if (d <= 2 && slamReady) {
    // Big, slow, clearly telegraphed: the signature readable threat.
    const tiles = tilesInRadius(ctx.grid, enemy.tile, 2)
      .filter(t => ctx.grid.isPassable(t.x, t.y));
    return {
      kind: 'attack', tiles, damage: Math.round(dmgOf(enemy, def) * 1.4),
      label: 'Ground Slam', melee: true, effect: 'shove',
    };
  }
  if (d <= 1) {
    return { kind: 'attack', tiles: [target.tile], damage: dmgOf(enemy, def), label: 'Smash', melee: true };
  }
  return moveIntentToward(ctx, enemy, target, 'Lumber');
}

function hazardIntent(ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor): Intent {
  const range = Math.max(3, Math.round(def.attackRange / 32));
  const d = tileDist(enemy.tile, target.tile);
  if (d <= range && canTarget(ctx.grid, enemy.tile, target.tile)) {
    const tiles = tilesInRadius(ctx.grid, target.tile, 1)
      .filter(t => ctx.grid.isPassable(t.x, t.y));
    return {
      kind: 'hazard', tiles, damage: Math.max(2, dmgOf(enemy, def)),
      label: 'Gas Cloud',
    };
  }
  return moveIntentToward(ctx, enemy, target, 'Drift');
}

function declareBossIntent(
  ctx: CombatContext, enemy: Actor, def: EnemyDef, target: Actor,
): Intent {
  const hpFrac = enemy.hp / enemy.maxHp;
  const enraged = hpFrac <= 0.5;
  enemy.flags.enraged = enraged;

  const cycle = Number(enemy.flags.bossCycle ?? 0);
  enemy.flags.bossCycle = cycle + 1;
  const d = tileDist(enemy.tile, target.tile);

  // A readable 3-beat rotation, tightened when enraged.
  const step = cycle % (enraged ? 3 : 4);

  if (step === 0 && d <= 6) {
    const dir = stepToward(enemy.tile, target.tile);
    const tiles = tilesInCone(ctx.grid, enemy.tile, dir, enraged ? 4 : 3);
    return {
      kind: 'attack', tiles, damage: Math.round(dmgOf(enemy, def) * 1.2),
      label: 'Sweep', melee: true, effect: 'shove',
    };
  }
  if (step === 1) {
    const tiles = tilesInRadius(ctx.grid, target.tile, enraged ? 2 : 1)
      .filter(t => ctx.grid.isPassable(t.x, t.y));
    return {
      kind: 'attack', tiles, damage: dmgOf(enemy, def),
      label: 'Barrage', melee: false,
    };
  }
  if (step === 2) {
    const spots: Tile[] = [];
    const n = enraged ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const s = freeNeighbourTile(ctx, enemy.tile);
      if (s && !spots.some(p => p.x === s.x && p.y === s.y)) spots.push(s);
    }
    if (spots.length) {
      return {
        kind: 'summon', tiles: spots, label: 'Call Brood',
        summonId: def.id.includes('spore') ? 'mushroom_spitter' : 'skeleton_chaser',
      };
    }
  }
  if (d <= 1) {
    return { kind: 'attack', tiles: [target.tile], damage: dmgOf(enemy, def), label: 'Crush', melee: true };
  }
  return moveIntentToward(ctx, enemy, target, 'Stalk');
}

// --- Intent execution -----------------------------------------

export interface ExecuteResult {
  /** A new enemy was summoned; engine must register it in the scheduler. */
  spawned: Actor[];
}

/**
 * Carry out the intent the player already saw. Nothing re-targets here: what
 * was declared is what happens.
 */
export function executeIntent(ctx: CombatContext, enemy: Actor): ExecuteResult {
  const result: ExecuteResult = { spawned: [] };
  const intent = enemy.intent;
  if (!enemy.alive || !intent) return result;

  if (enemy.flags.eliteModifier === 'elite_shielded') {
    enemy.flags.shieldHp = Math.min(30, Number(enemy.flags.shieldHp ?? 0) + 10);
  }

  switch (intent.kind) {
    case 'wait':
      break;

    case 'move': {
      if (hasStatus(enemy.statuses, 'root')) break;
      const to = intent.to;
      if (!ctx.grid.isPassable(to.x, to.y)) break;
      const blocker = actorAt(ctx, to);
      if (blocker && blocker.id !== enemy.id) break;
      enemy.facing = stepToward(enemy.tile, to);
      enemy.tile = { ...to };
      enemy.flags.blinkCharge = 0;
      break;
    }

    case 'attack': {
      enemy.flags.slamCharge = 0;
      const victims = ctx.actors.filter(a =>
        a.alive && a.faction === 'player' &&
        intent.tiles.some(t => t.x === a.tile.x && t.y === a.tile.y),
      );

      if (intent.melee) {
        fx(ctx, { kind: 'slash', tile: intent.tiles[0] ?? enemy.tile, colour: '#ef5350', lifeMs: 300 });
      } else {
        fx(ctx, {
          kind: 'tracer', from: enemy.tile, to: intent.tiles[0] ?? enemy.tile,
          colour: '#ab47bc', lifeMs: 260,
        });
      }

      if (!victims.length) {
        // The telegraph was dodged. Say so: the player earned it.
        logLine(ctx, 'trigger', `${enemy.name}'s ${intent.label} hits nothing`);
        intent.tiles.forEach(t =>
          fx(ctx, { kind: 'burst', tile: t, colour: '#546e7a', lifeMs: 280, radius: 0 }));
        break;
      }

      for (const v of victims) {
        // Ranged attacks still respect cover drawn after the declaration.
        if (!intent.melee && !canTarget(ctx.grid, enemy.tile, v.tile)) {
          logLine(ctx, 'trigger', `${v.name} is shielded by cover`);
          continue;
        }
        const res = dealDamage(ctx, {
          attacker: enemy, target: v, amount: intent.damage,
          type: intent.effect === 'poison' ? 'poison' : 'physical',
          tags: intent.melee ? ['Physical', 'Melee'] : ['Physical', 'Ranged'],
          melee: intent.melee,
        });
        if (res.dealt > 0 && (intent.effect === 'poison' || enemy.flags.eliteModifier === 'elite_toxic')) {
          inflictStatus(ctx, enemy, v, 'poison', 1, -1);
        }
        if (res.dealt > 0 && intent.effect === 'shove' && v.alive) {
          shove(ctx, enemy, v, stepToward(enemy.tile, v.tile), 1);
        }
      }
      break;
    }

    case 'hazard': {
      intent.tiles.forEach(t =>
        spawnHazard(ctx, t, intent.damage, 6, 'enemy', 'Toxic Gas', '#9ccc65', ['DOT', 'Poison']));
      logLine(ctx, 'trigger', `${enemy.name} releases ${intent.label}`);
      break;
    }

    case 'summon': {
      const occupied = occupiedTiles(ctx);
      for (const t of intent.tiles) {
        if (occupied.has(tileKey(t))) continue;
        if (!ctx.grid.isPassable(t.x, t.y)) continue;
        const spawned = spawnEnemyActor(ctx, intent.summonId, t, 1, false);
        if (spawned) {
          result.spawned.push(spawned);
          occupied.add(tileKey(t));
        }
      }
      logLine(ctx, 'trigger', `${enemy.name} calls reinforcements`, true);
      break;
    }
  }

  // Charge up the slower signature abilities for next time.
  enemy.flags.slamCharge = Number(enemy.flags.slamCharge ?? 0) + 1;
  enemy.flags.blinkCharge = Number(enemy.flags.blinkCharge ?? 0) + 1;
  return result;
}

// --- Spawning -------------------------------------------------

let enemySeq = 0;

export function resetEnemySeq(): void { enemySeq = 0; }

/**
 * Elite modifiers. Each changes how the enemy behaves, not just its numbers,
 * so an elite poses a different question rather than a longer one.
 */
export const ELITE_MODIFIERS = {
  elite_frenzied: {
    name: 'Frenzied',
    rule: 'Acts 1 Beat sooner than its kind and hits 20% harder.',
    colour: '#ff7043',
  },
  elite_shielded: {
    name: 'Shielded',
    rule: 'Regains a 10-point shield every time it acts.',
    colour: '#64b5f6',
  },
  elite_toxic: {
    name: 'Toxic',
    rule: 'Its hits apply Poison, and it leaves a toxic cloud where it dies.',
    colour: '#9ccc65',
  },
} as const;

export type EliteModifierId = keyof typeof ELITE_MODIFIERS;
const ELITE_IDS = Object.keys(ELITE_MODIFIERS) as EliteModifierId[];

export function spawnEnemyActor(
  ctx: CombatContext,
  defId: string,
  tile: Tile,
  floor: number,
  isElite: boolean,
): Actor | null {
  const def = registry.getEnemy(defId) ?? registry.getBoss(defId);
  if (!def) return null;

  const scale = floor >= 2 ? def.floorScaling : { hpMult: 1, damageMult: 1 };
  const isBoss = defId.startsWith('boss_');
  // Bosses carry their own tuned stat line. Applying the elite multiplier on
  // top of it turned the floor-1 boss into a 504 HP wall.
  const elite = isElite && !isBoss;
  let hp = Math.round(def.hp * scale.hpMult);
  if (elite) hp = Math.round(hp * 1.8);

  const actor: Actor = {
    id: `e${++enemySeq}`,
    kind: 'enemy',
    faction: 'enemy',
    tile: { ...tile },
    hp, maxHp: hp,
    armor: elite ? 2 : isBoss ? 1 : 0,
    alive: true,
    tags: [...def.tags],
    nextActAt: ctx.clock + (isBoss ? 3 : (ARCHETYPE_SPEED[def.archetype] ?? 3)),
    actSpeed: isBoss ? 3 : (ARCHETYPE_SPEED[def.archetype] ?? 3),
    intent: null,
    statuses: {},
    facing: { x: -1, y: 0 },
    defId,
    name: elite ? `Elite ${def.name}` : def.name,
    flashMs: 0,
    deathAnimMs: 0,
    flags: {
      isElite: elite, isBoss,
      baseDamage: Math.round(def.damage * scale.damageMult * (elite ? 1.3 : 1)),
    },
  };

  if (elite) {
    const mod = ctx.rng.pick(ELITE_IDS);
    actor.flags.eliteModifier = mod;
    actor.name = `${ELITE_MODIFIERS[mod].name} ${def.name}`;
    if (mod === 'elite_frenzied') {
      actor.actSpeed = Math.max(2, actor.actSpeed - 1);
      actor.flags.baseDamage = Math.round(Number(actor.flags.baseDamage) * 1.2);
    }
  }

  ctx.actors.push(actor);
  declareIntent(ctx, actor);
  return actor;
}

export { line, neighbors8 };
