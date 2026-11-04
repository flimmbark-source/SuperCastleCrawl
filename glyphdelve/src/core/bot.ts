// ============================================================
// Glyphdelve - Reference Bot
//
// A deliberately simple heuristic player, used two ways:
//  - as a balance oracle in tests ("can a competent player clear room 1?")
//  - as an automated playtester for whole-run sweeps
//
// It is intentionally NOT optimal. It plays the way a reasonable first-time
// player would once they understand the telegraphs: kill what you can, step
// out of what is aimed at you, otherwise close the distance. If the bot
// cannot survive, a human almost certainly cannot either.
// ============================================================

import type { TacticalEngine } from './tactical';
import { tileDist, tileKey, findPath } from './grid';
import type { Tile } from './grid';
import { livingEnemies } from './combat';

export interface BotStepLog {
  action: string;
  cost: number;
  hp: number;
  enemies: number;
}

export interface BotOptions {
  /** Set false to measure the basic-attack floor, for A/B comparison. */
  useSkills?: boolean;
}

export interface BotRoomResult {
  outcome: 'cleared' | 'defeat' | 'stalled';
  steps: number;
  beats: number;
  hpStart: number;
  hpEnd: number;
  kills: number;
  log: BotStepLog[];
}

/** Play one room to completion. Returns how it went. */
export function botPlayRoom(
  engine: TacticalEngine, maxSteps = 400, opts: BotOptions = {},
): BotRoomResult {
  const useSkills = opts.useSkills !== false;
  const hpStart = engine.player.hp;
  const log: BotStepLog[] = [];
  let kills = 0;
  let steps = 0;

  while (engine.outcome === 'ongoing' && steps < maxSteps) {
    steps++;
    const action = chooseAndPerform(engine, useSkills);
    kills += action.killed;
    log.push({
      action: action.label, cost: action.cost,
      hp: Math.round(engine.player.hp), enemies: livingEnemies(engine.ctx).length,
    });
    if (!action.ok) break;
  }

  const outcome = engine.outcome === 'cleared' ? 'cleared'
    : engine.outcome === 'defeat' ? 'defeat' : 'stalled';

  return {
    outcome, steps, beats: engine.ctx.clock,
    hpStart, hpEnd: Math.round(engine.player.hp),
    kills, log,
  };
}

interface Decision { ok: boolean; label: string; cost: number; killed: number }

function chooseAndPerform(engine: TacticalEngine, useSkills: boolean): Decision {
  const enemies = livingEnemies(engine.ctx);
  const threat = engine.threatenedTiles();
  const standingDamage = threat.get(tileKey(engine.player.tile))?.damage ?? 0;
  const hpFrac = engine.player.hp / engine.player.maxHp;

  // 1. Finish anything we can kill right now. Removing an enemy removes its
  //    whole future damage output, which beats almost any other play.
  const targets = engine.attackableTiles();
  for (const t of targets) {
    const e = enemies.find(a => a.tile.x === t.x && a.tile.y === t.y);
    if (!e) continue;
    const estimate = engine.attackDamage();
    if (e.hp <= estimate) {
      const r = engine.performAttack(t);
      if (r.ok) return { ok: true, label: `kill ${e.name}`, cost: r.beatsSpent, killed: r.killed.length };
    }
  }

  // 1b. Use a skill when it is plainly the better buy. The bot needs this or
  //     the balance sweep only ever measures the basic-attack floor and says
  //     nothing about whether the skill economy works.
  const skill = useSkills ? pickSkill(engine, enemies) : null;
  if (skill) {
    const r = engine.performSkill(skill.id, skill.aim);
    if (r.ok) return { ok: true, label: `skill ${skill.id}`, cost: r.beatsSpent, killed: r.killed.length };
  }

  // 2. If something is aimed at this tile and it would really hurt, step off it.
  //    Deliberately bounded: dodging every telegraph forever is a livelock,
  //    not a strategy, and a player who never commits never clears the room.
  //    Dodge only against a lethal blow or a genuinely heavy one, and never
  //    more than twice in a row.
  const dodgeStreak = Number(engine.player.flags.botDodgeStreak ?? 0);
  const worthDodging = standingDamage >= engine.player.hp
    || (standingDamage >= engine.player.maxHp * 0.15 && hpFrac < 0.6);

  if (standingDamage > 0 && worthDodging && dodgeStreak < 2) {
    const safe = engine.moveOptions()
      .filter(o => (threat.get(tileKey(o.tile))?.damage ?? 0) === 0)
      .sort((a, b) => {
        // Prefer cheap steps that keep us near the fight.
        const da = nearestDist(a.tile, enemies.map(e => e.tile));
        const db = nearestDist(b.tile, enemies.map(e => e.tile));
        return (a.cost - b.cost) || (da - db);
      });
    if (safe.length) {
      const r = engine.performMove(safe[0].tile);
      if (r.ok) {
        engine.player.flags.botDodgeStreak = dodgeStreak + 1;
        return { ok: true, label: 'dodge', cost: r.beatsSpent, killed: r.killed.length };
      }
    }
  }
  engine.player.flags.botDodgeStreak = 0;

  // 3. Otherwise hit whatever is in reach, preferring the weakest target.
  if (targets.length) {
    const sorted = [...targets].sort((a, b) => {
      const ea = enemies.find(e => e.tile.x === a.x && e.tile.y === a.y);
      const eb = enemies.find(e => e.tile.x === b.x && e.tile.y === b.y);
      return (ea?.hp ?? 999) - (eb?.hp ?? 999);
    });
    const r = engine.performAttack(sorted[0]);
    if (r.ok) return { ok: true, label: 'attack', cost: r.beatsSpent, killed: r.killed.length };
  }

  // 4. Close the distance. Follow an actual path rather than descending
  //    greedily on straight-line distance: a greedy bot gets stuck whenever
  //    the route to an enemy requires stepping away from it first, which
  //    would make a perfectly navigable room look broken.
  const opts = engine.moveOptions();
  if (opts.length && enemies.length) {
    const nearest = enemies.reduce((best, e) =>
      tileDist(engine.player.tile, e.tile) < tileDist(engine.player.tile, best.tile) ? e : best,
      enemies[0]);

    const path = findPath(engine.ctx.grid, engine.player.tile, nearest.tile, {
      occupied: new Set(enemies.map(e => tileKey(e.tile))),
      ignoreOccupiedAtGoal: true,
    });

    if (path && path.length > 1) {
      // Prefer the next path tile, but take a safe detour if that tile is
      // telegraphed and an equally-advancing alternative is not.
      const next = path[1];
      const nextDanger = threat.get(tileKey(next))?.damage ?? 0;
      let chosen = opts.find(o => o.tile.x === next.x && o.tile.y === next.y);

      if (!chosen || (nextDanger > 0 && nextDanger >= engine.player.hp * 0.25)) {
        const alt = opts
          .filter(o => (threat.get(tileKey(o.tile))?.damage ?? 0) < nextDanger)
          .sort((a, b) => nearestDist(a.tile, [nearest.tile]) - nearestDist(b.tile, [nearest.tile]));
        chosen = alt[0] ?? chosen;
      }

      if (chosen) {
        const r = engine.performMove(chosen.tile);
        if (r.ok) return { ok: true, label: 'advance', cost: r.beatsSpent, killed: r.killed.length };
      }
    }

    // No path at all: take any step that reduces the gap or the danger.
    const enemyTiles = enemies.map(e => e.tile);
    const cur = nearestDist(engine.player.tile, enemyTiles);
    const fallback = opts
      .map(o => ({ o, danger: threat.get(tileKey(o.tile))?.damage ?? 0, dist: nearestDist(o.tile, enemyTiles) }))
      .filter(s => s.dist < cur || s.danger < standingDamage)
      .sort((a, b) => (a.danger - b.danger) || (a.dist - b.dist))[0];
    if (fallback) {
      const r = engine.performMove(fallback.o.tile);
      if (r.ok) return { ok: true, label: 'advance', cost: r.beatsSpent, killed: r.killed.length };
    }
  }

  // 5. Nothing better to do: hold for a single Beat and let them come.
  const r = engine.performWait();
  return { ok: r.ok, label: 'wait', cost: r.beatsSpent, killed: r.killed.length };
}

function nearestDist(from: Tile, tiles: Tile[]): number {
  let best = Infinity;
  for (const t of tiles) best = Math.min(best, tileDist(from, t));
  return best === Infinity ? 0 : best;
}

/**
 * Pick a skill worth casting this turn, or null to fall back to attacking.
 *
 * Deliberately simple and legible rather than optimal: it only casts when the
 * case is obvious, which keeps it a fair proxy for a competent human rather
 * than a solver.
 */
function pickSkill(
  engine: TacticalEngine,
  enemies: ReturnType<typeof livingEnemies>,
): { id: string; aim?: Tile } | null {
  if (!enemies.length) return null;
  const me = engine.player.tile;
  const ready = engine.skills.filter(s => s.cooldownRemaining <= 0);
  if (!ready.length) return null;

  const near = (r: number) => enemies.filter(e => tileDist(me, e.tile) <= r).length;
  const nearest = enemies.reduce((b, e) => tileDist(me, e.tile) < tileDist(me, b.tile) ? e : b, enemies[0]);
  const has = (id: string) => ready.some(s => s.id === id);
  const summons = engine.ctx.actors.filter(a => a.alive && a.kind === 'summon').length;

  // Keep a pack out: a summon pays for itself over the rest of the room.
  if (summons === 0 && has('summon_briar_wolf')) return { id: 'summon_briar_wolf' };
  if (summons === 0 && has('summon_briar_wolf_alpha')) return { id: 'summon_briar_wolf_alpha' };
  if (summons === 0 && has('totemic_ward') && near(4) > 0) return { id: 'totemic_ward' };

  // Crowd control and area damage once a cluster forms.
  if (near(2) >= 2) {
    if (has('thornburst')) return { id: 'thornburst' };
    if (has('roaring_sprint')) return { id: 'roaring_sprint' };
    if (has('thorn_mantle')) return { id: 'thorn_mantle' };
  }
  if (near(5) >= 3 && has('spirit_swarm')) return { id: 'spirit_swarm' };
  if (near(3) >= 2 && has('entangling_vines')) return { id: 'entangling_vines', aim: nearest.tile };

  // Single-target burst on anything in reach.
  if (tileDist(me, nearest.tile) <= 5 && has('spore_bolt')) {
    return { id: 'spore_bolt', aim: nearest.tile };
  }
  if (tileDist(me, nearest.tile) <= 3 && tileDist(me, nearest.tile) > 1 && has('wild_charge')) {
    return { id: 'wild_charge', aim: nearest.tile };
  }

  // Shift to Bear when the fight is already in melee, back to Caster when not.
  if (has('bear_form_transform') || has('bear_form_enhanced')) {
    const id = has('bear_form_enhanced') ? 'bear_form_enhanced' : 'bear_form_transform';
    if (engine.form === 'caster' && near(1) >= 2) return { id };
    if (engine.form === 'bear' && near(2) === 0 && enemies.length > 0) return { id };
  }

  if (has('fungal_link') && summons >= 2) return { id: 'fungal_link' };
  return null;
}
