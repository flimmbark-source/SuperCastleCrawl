import { describe, it, expect } from 'vitest';
import { makeEngine, giveSkill } from './helpers';
import { livingEnemies } from '../combat';

describe('the Beat economy', () => {
  it('spends cooldown only when the player spends Beats (regression: the idle cooldown drain)', () => {
    // The original bug: skill cooldowns were decremented every render frame
    // while the player stood still, so standing still was a cooldown reset.
    // Measured before the rewrite: 30s of cooldown drained to 8.65s in one
    // real second of idling. Cooldowns are now denominated in Beats and can
    // only move when an action is actually taken.
    const { engine, meta } = makeEngine();
    giveSkill(meta, 'thornburst');
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);

    const skill = engine.skills.find(s => s.id === 'thornburst')!;
    engine.performSkill('thornburst');
    const afterCast = skill.cooldownRemaining;
    expect(afterCast).toBeGreaterThan(0);

    // Wall-clock time passing changes nothing: there is no wall clock.
    const before = engine.ctx.clock;
    for (let i = 0; i < 1000; i++) {
      // Querying the board as a thinking player would must never advance state.
      engine.availableActions();
      engine.threatenedTiles();
      engine.moveOptions();
    }
    expect(engine.ctx.clock).toBe(before);
    expect(skill.cooldownRemaining).toBe(afterCast);

    // Taking a 1-Beat action burns exactly 1 Beat of cooldown.
    engine.performWait();
    expect(skill.cooldownRemaining).toBe(afterCast - 1);
  });

  it('charges the advertised Beat cost, so the UI never lies', () => {
    const { engine, meta } = makeEngine();
    giveSkill(meta, 'spore_bolt');
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);

    for (const action of engine.availableActions()) {
      if (action.disabledReason) continue;
      const clockBefore = engine.ctx.clock;
      let res;
      if (action.kind === 'wait') res = engine.performWait();
      else if (action.kind === 'attack') {
        const t = engine.attackableTiles()[0];
        if (!t) continue;
        res = engine.performAttack(t);
      } else {
        res = engine.performSkill(action.id);
      }
      if (!res.ok) continue;
      expect(res.beatsSpent).toBe(action.cost);
      expect(engine.ctx.clock - clockBefore).toBe(action.cost);
    }
  });

  it('gives faster enemies proportionally more turns for the same Beats', () => {
    // A 2-Beat-per-action blinker should act about twice as often as a
    // 4-Beat-per-action spitter over the same span. This is the arithmetic
    // the player is expected to do in their head, so it must hold exactly.
    const { engine } = makeEngine(99);
    engine.startRoom('combat', 1, ['shadow_imp', 'mushroom_spitter'], false);

    const imp = engine.ctx.actors.find(a => a.defId === 'shadow_imp')!;
    const spitter = engine.ctx.actors.find(a => a.defId === 'mushroom_spitter')!;
    expect(imp.actSpeed).toBe(2);
    expect(spitter.actSpeed).toBe(4);

    let impTurns = 0, spitterTurns = 0;
    let lastImp = imp.nextActAt, lastSpitter = spitter.nextActAt;
    for (let i = 0; i < 12 && engine.outcome === 'ongoing'; i++) {
      engine.performWait();
      if (imp.nextActAt !== lastImp) { impTurns++; lastImp = imp.nextActAt; }
      if (spitter.nextActAt !== lastSpitter) { spitterTurns++; lastSpitter = spitter.nextActAt; }
    }
    expect(impTurns).toBeGreaterThan(spitterTurns);
  });

  it('is fully deterministic for a given seed', () => {
    const run = () => {
      const { engine, meta } = makeEngine(4242);
      giveSkill(meta, 'thornburst');
      engine.startRoom('combat', 1, ['skeleton_chaser', 'mushroom_spitter'], false);
      for (let i = 0; i < 20 && engine.outcome === 'ongoing'; i++) {
        const t = engine.attackableTiles()[0];
        if (t) engine.performAttack(t);
        else {
          const opts = engine.moveOptions();
          if (opts.length) engine.performMove(opts[0].tile);
          else engine.performWait();
        }
      }
      return {
        clock: engine.ctx.clock,
        hp: engine.player.hp,
        outcome: engine.outcome,
        enemies: livingEnemies(engine.ctx).map(e => `${e.id}@${e.tile.x},${e.tile.y}:${e.hp}`),
      };
    };
    expect(run()).toEqual(run());
  });
});
