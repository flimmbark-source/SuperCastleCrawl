// ============================================================
// Glyphdelve - Headless Run Simulator
//
// Plays complete runs with no browser, no renderer and no timers, so
// progression pacing and difficulty can be measured rather than guessed at.
// Used by the balance tests and by `npm run sim` for bulk sweeps.
// ============================================================

import { SeededRNG } from '../engine/SeededRNG';
import {
  createRunState, getCurrentNode, completeCurrentNode, travelTo,
  getAvailableNodes, updateBuildTags,
} from '../engine/RunState';
import type { RunState, NodeType, LevelUpOffer } from '../types';
import { awardXP, XP_REWARDS, generateLevelUpOffers, applyLevelUpChoice } from '../systems/LevelSystem';
import { rollDrops, applyDrops, createGuaranteedEncounterDrop } from '../systems/DropSystem';
import { TacticalEngine } from './tactical';
import { botPlayRoom } from './bot';
import type { Actor } from './model';

const FLOOR_POOL: Record<number, string[]> = {
  1: ['skeleton_chaser', 'mushroom_spitter', 'shadow_imp', 'toxic_shroom'],
  2: ['skeleton_chaser', 'mushroom_spitter', 'stone_golem', 'shadow_imp', 'toxic_shroom'],
};

export interface RoomRecord {
  floor: number;
  type: NodeType;
  outcome: 'cleared' | 'defeat' | 'stalled';
  beats: number;
  hpBefore: number;
  hpAfter: number;
  level: number;
  layout: string;
}

export interface RunRecord {
  seed: number;
  won: boolean;
  diedOn: { floor: number; type: NodeType } | null;
  roomsCleared: number;
  finalLevel: number;
  totalBeats: number;
  kills: number;
  skills: number;
  passives: number;
  items: number;
  melds: number;
  rooms: RoomRecord[];
  /** Set if the run could not finish for a structural reason, not a death. */
  error?: string;
}

/** How the simulated player picks a level-up card. */
export type OfferPolicy = 'highest_synergy' | 'random' | 'first';

function chooseOffer(offers: LevelUpOffer[], rng: SeededRNG, policy: OfferPolicy): LevelUpOffer {
  if (policy === 'first') return offers[0];
  if (policy === 'random') return rng.pick(offers);
  const rank = { High: 2, Med: 1, Low: 0 } as const;
  return [...offers].sort((a, b) => rank[b.synergy] - rank[a.synergy])[0];
}

/** How the simulated player picks a route. */
export type RoutePolicy = 'greedy_safe' | 'greedy_power' | 'random';

function chooseRoute(
  state: RunState, rng: SeededRNG, policy: RoutePolicy,
): string | null {
  const options = getAvailableNodes(state);
  if (!options.length) return null;
  if (options.length === 1) return options[0].id;
  if (policy === 'random') return rng.pick(options).id;

  const hpFrac = state.player.hp / state.player.maxHp;
  const score = (t: NodeType): number => {
    if (policy === 'greedy_power') {
      return { elite: 5, shrine: 4, combat: 3, event: 2, recovery: hpFrac < 0.5 ? 6 : 1, boss: 0 }[t] ?? 0;
    }
    // greedy_safe: take the spring when hurt, avoid elites when hurt.
    return {
      recovery: hpFrac < 0.75 ? 6 : 2,
      event: 4, shrine: 3, combat: 3,
      elite: hpFrac > 0.8 ? 2 : 0,
      boss: 0,
    }[t] ?? 0;
  };
  return [...options].sort((a, b) => score(b.type) - score(a.type))[0].id;
}

export interface SimOptions {
  offerPolicy?: OfferPolicy;
  routePolicy?: RoutePolicy;
  maxRooms?: number;
  /** Set false to measure the game with skills ignored entirely. */
  useSkills?: boolean;
}

export function simulateRun(seed: number, opts: SimOptions = {}): RunRecord {
  const offerPolicy = opts.offerPolicy ?? 'highest_synergy';
  const routePolicy = opts.routePolicy ?? 'greedy_safe';
  const maxRooms = opts.maxRooms ?? 40;

  const rng = new SeededRNG(seed);
  const state = createRunState(seed);
  const engine = new TacticalEngine(rng, state.player);

  const rec: RunRecord = {
    seed, won: false, diedOn: null, roomsCleared: 0,
    finalLevel: 1, totalBeats: 0, kills: 0,
    skills: 0, passives: 0, items: 0, melds: 0, rooms: [],
  };

  let pendingLevelUps = 0;
  let guard = 0;

  const resolveLevelUps = () => {
    let spins = 0;
    while (pendingLevelUps > 0 && spins++ < 20) {
      pendingLevelUps--;
      const offers = generateLevelUpOffers(state, rng);
      if (!offers.length) break;
      applyLevelUpChoice(state, chooseOffer(offers, rng, offerPolicy).id);
      updateBuildTags(state.player);
      engine.rebuildSkills();
    }
  };

  while (!state.runComplete && guard++ < maxRooms) {
    const target = chooseRoute(state, rng, routePolicy);
    if (!target) { rec.error = 'no route available'; break; }
    if (!travelTo(state, target)) { rec.error = 'travel refused'; break; }

    const node = getCurrentNode(state);
    const hpBefore = state.player.hp;

    if (node.type === 'recovery') {
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + Math.ceil(state.player.maxHp * 0.35));
      completeCurrentNode(state);
      continue;
    }
    if (node.type === 'event') {
      state.player.maxHp += 12; state.player.hp += 12;
      completeCurrentNode(state);
      continue;
    }
    if (node.type === 'shrine') {
      // Melding is modelled only as the essence sink; the meld system itself
      // has its own tests and is not what this harness measures.
      completeCurrentNode(state);
      continue;
    }

    const pool = FLOOR_POOL[state.floor] ?? FLOOR_POOL[1];
    let ids: string[];
    if (node.type === 'boss') {
      ids = [state.floor >= 2 ? 'boss_spore_queen' : 'boss_elder_treant'];
      for (let i = 0; i < 2; i++) ids.push(rng.pick(pool));
    } else if (node.type === 'elite') {
      const n = state.floor >= 2 ? 4 : 3;
      ids = Array.from({ length: n }, () => rng.pick(pool));
    } else {
      const n = state.floor >= 2 ? rng.nextInt(4, 5) : rng.nextInt(3, 4);
      ids = Array.from({ length: n }, () => rng.pick(pool));
    }

    engine.startRoom(node.type, state.floor, ids, node.type === 'elite' || node.type === 'boss');

    // Award XP and loot as kills land, mirroring what the orchestrator does.
    const seenKills = new Set<string>();
    const harvest = (killed: Actor[]) => {
      killed.forEach(k => {
        if (seenKills.has(k.id)) return;
        seenKills.add(k.id);
        const kind = k.flags.isBoss ? 'boss' : k.flags.isElite ? 'elite' : 'normal';
        state.killCount++;
        rec.kills++;
        if (awardXP(state, XP_REWARDS[kind])) pendingLevelUps++;
        applyDrops(state, rollDrops(state, kind, rng));
      });
    };

    const before = engine.stats.kills;
    const result = botPlayRoom(engine, 600, { useSkills: opts.useSkills });
    void before;
    harvest(engine.ctx.actors.filter(a => !a.alive && a.faction === 'enemy'));

    rec.totalBeats += result.beats;
    rec.rooms.push({
      floor: state.floor, type: node.type, outcome: result.outcome,
      beats: result.beats, hpBefore: Math.round(hpBefore),
      hpAfter: Math.round(state.player.hp), level: state.player.level,
      layout: engine.layoutName,
    });

    if (result.outcome !== 'cleared') {
      if (result.outcome === 'defeat') {
        rec.diedOn = { floor: state.floor, type: node.type };
      } else {
        rec.error = `stalled on ${node.type} (floor ${state.floor})`;
      }
      break;
    }

    rec.roomsCleared++;
    if (awardXP(state, XP_REWARDS.roomClear)) pendingLevelUps++;
    const kind = node.type === 'boss' ? 'boss' : node.type === 'elite' ? 'elite' : 'normal';
    applyDrops(state, createGuaranteedEncounterDrop(state, rng, kind));
    updateBuildTags(state.player);
    resolveLevelUps();
    engine.rebuildSkills();

    completeCurrentNode(state);
  }

  rec.won = state.runComplete && state.runWon;
  rec.finalLevel = state.player.level;
  rec.skills = state.player.skills.length;
  rec.passives = state.player.passives.length;
  rec.items = state.player.items.length;
  rec.melds = state.meldHistory.length;
  return rec;
}

export interface SweepSummary {
  runs: number;
  winRate: number;
  avgRoomsCleared: number;
  avgFinalLevel: number;
  avgKills: number;
  avgBeats: number;
  errors: string[];
  stalls: number;
  deathsByFloor: Record<number, number>;
  deathsByType: Record<string, number>;
  avgHpLossByType: Record<string, number>;
}

export function sweep(seeds: number[], opts: SimOptions = {}): SweepSummary {
  const records = seeds.map(s => simulateRun(s, opts));
  const deathsByFloor: Record<number, number> = {};
  const deathsByType: Record<string, number> = {};
  const lossTotals: Record<string, { sum: number; n: number }> = {};

  records.forEach(r => {
    if (r.diedOn) {
      deathsByFloor[r.diedOn.floor] = (deathsByFloor[r.diedOn.floor] ?? 0) + 1;
      deathsByType[r.diedOn.type] = (deathsByType[r.diedOn.type] ?? 0) + 1;
    }
    r.rooms.forEach(room => {
      if (room.outcome !== 'cleared') return;
      const t = lossTotals[room.type] ?? { sum: 0, n: 0 };
      t.sum += room.hpBefore - room.hpAfter;
      t.n++;
      lossTotals[room.type] = t;
    });
  });

  const avgHpLossByType: Record<string, number> = {};
  Object.entries(lossTotals).forEach(([k, v]) => {
    avgHpLossByType[k] = Math.round((v.sum / Math.max(1, v.n)) * 10) / 10;
  });

  const avg = (f: (r: RunRecord) => number) =>
    Math.round((records.reduce((a, r) => a + f(r), 0) / records.length) * 10) / 10;

  return {
    stalls: records.filter(r => r.error?.startsWith('stalled')).length,
    runs: records.length,
    winRate: Math.round((records.filter(r => r.won).length / records.length) * 1000) / 10,
    avgRoomsCleared: avg(r => r.roomsCleared),
    avgFinalLevel: avg(r => r.finalLevel),
    avgKills: avg(r => r.kills),
    avgBeats: avg(r => r.totalBeats),
    errors: records.filter(r => r.error).map(r => `seed ${r.seed}: ${r.error}`),
    deathsByFloor, deathsByType, avgHpLossByType,
  };
}
