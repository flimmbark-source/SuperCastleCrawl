import { describe, it, expect } from 'vitest';
import { makeEngine, giveSkill } from './helpers';
import { botPlayRoom } from '../bot';

/**
 * Before the rewrite, a bot with perfect aim and maximum fire rate ended the
 * FIRST room of the game at 7/100 HP with 3 of 5 enemies still alive: the
 * opening was not winnable. These tests pin that down so it cannot regress.
 */
describe('opening balance', () => {
  it('lets a level-1 player clear the first room across many seeds', () => {
    const results = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { engine, meta } = makeEngine(seed);
      giveSkill(meta, 'bear_form_transform');
      engine.startRoom('combat', 1, ['skeleton_chaser', 'skeleton_chaser', 'mushroom_spitter'], false);
      results.push(botPlayRoom(engine));
    }

    const cleared = results.filter(r => r.outcome === 'cleared');
    const stalled = results.filter(r => r.outcome === 'stalled');

    // A competent player should essentially always survive room 1.
    expect(cleared.length / results.length).toBeGreaterThanOrEqual(0.9);
    // A stall means the bot could not reach an enemy: a room-generation bug.
    expect(stalled.length).toBe(0);

    const avgLoss = cleared.reduce((a, r) => a + (r.hpStart - r.hpEnd), 0) / cleared.length;
    // The fight must cost something, or there is no tension...
    expect(avgLoss).toBeGreaterThan(2);
    // ...but it must not consume the whole health bar on node 1 of 18.
    expect(avgLoss).toBeLessThan(45);
  });

  it('makes floor 2 meaningfully harder than floor 1', () => {
    const loss = (floor: number) => {
      let total = 0, n = 0;
      for (let seed = 100; seed < 120; seed++) {
        const { engine, meta } = makeEngine(seed);
        giveSkill(meta, 'bear_form_transform');
        meta.hp = 500; meta.maxHp = 500; // isolate damage taken from death
        engine.startRoom('combat', floor, ['skeleton_chaser', 'mushroom_spitter', 'stone_golem'], false);
        const r = botPlayRoom(engine);
        if (r.outcome === 'cleared') { total += r.hpStart - r.hpEnd; n++; }
      }
      return n ? total / n : 0;
    };
    expect(loss(2)).toBeGreaterThan(loss(1));
  });

  it('makes elites a real step up from the same enemies unmodified', () => {
    const run = (elite: boolean) => {
      let total = 0, n = 0;
      for (let seed = 200; seed < 220; seed++) {
        const { engine, meta } = makeEngine(seed);
        giveSkill(meta, 'bear_form_transform');
        meta.hp = 500; meta.maxHp = 500;
        engine.startRoom('elite', 1, ['stone_golem', 'skeleton_chaser'], elite);
        const r = botPlayRoom(engine);
        if (r.outcome === 'cleared') { total += r.beats; n++; }
      }
      return n ? total / n : 0;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('always generates a room the player can actually fight in', () => {
    // Every enemy must be reachable and the player must never be boxed in.
    for (let seed = 1; seed <= 60; seed++) {
      const { engine, meta } = makeEngine(seed);
      giveSkill(meta, 'bear_form_transform');
      engine.startRoom('combat', seed % 2 ? 1 : 2, ['skeleton_chaser', 'shadow_imp', 'toxic_shroom'], false);
      expect(engine.moveOptions().length, `seed ${seed}: player boxed in`).toBeGreaterThan(0);

      const r = botPlayRoom(engine, 500);
      expect(r.outcome, `seed ${seed} stalled`).not.toBe('stalled');
    }
  });

  it('never spawns an enemy on top of the player', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { engine } = makeEngine(seed);
      engine.startRoom('combat', 1, ['skeleton_chaser', 'skeleton_chaser', 'shadow_imp'], false);
      const p = engine.player.tile;
      engine.ctx.actors.filter(a => a.kind === 'enemy').forEach(e => {
        expect(e.tile.x !== p.x || e.tile.y !== p.y).toBe(true);
        // And nothing starts close enough to hit before the player acts.
        expect(Math.max(Math.abs(e.tile.x - p.x), Math.abs(e.tile.y - p.y))).toBeGreaterThanOrEqual(5);
      });
    }
  });
});
