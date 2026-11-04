import { describe, it, expect } from 'vitest';
import { makeEngine, giveSkill, givePassive } from './helpers';
import { livingEnemies } from '../combat';
import { tileDist } from '../grid';
import { registry } from '../../engine/DataRegistry';

describe('summons', () => {
  it('appears, acts on its own clock, and attacks without the player', () => {
    const { engine, meta } = makeEngine(401);
    giveSkill(meta, 'summon_briar_wolf');
    engine.startRoom('combat', 1, ['stone_golem'], false);

    engine.performSkill('summon_briar_wolf');
    const wolf = engine.ctx.actors.find(a => a.kind === 'summon');
    expect(wolf, 'no summon appeared').toBeTruthy();
    expect(wolf!.alive).toBe(true);

    // Park the golem next to the wolf and let the clock run; the wolf should
    // damage it with no further input from the player.
    const enemy = livingEnemies(engine.ctx)[0];
    enemy.hp = enemy.maxHp;
    const hp0 = enemy.hp;
    enemy.tile = { x: wolf!.tile.x + 1, y: wolf!.tile.y };

    for (let i = 0; i < 8 && engine.outcome === 'ongoing'; i++) engine.performWait();
    expect(enemy.hp, 'the summon never attacked').toBeLessThan(hp0);
  });

  it('fades on its own once its lifespan runs out', () => {
    const { engine, meta } = makeEngine(402);
    giveSkill(meta, 'summon_briar_wolf');
    engine.startRoom('combat', 1, ['stone_golem'], false);
    engine.performSkill('summon_briar_wolf');
    expect(engine.ctx.actors.some(a => a.kind === 'summon' && a.alive)).toBe(true);

    for (let i = 0; i < 60 && engine.outcome === 'ongoing'; i++) engine.performWait();
    expect(engine.ctx.actors.some(a => a.kind === 'summon' && a.alive)).toBe(false);
  });

  it('respects the cap the skill declares rather than piling up endlessly', () => {
    const { engine, meta } = makeEngine(403);
    giveSkill(meta, 'summon_briar_wolf');
    engine.startRoom('combat', 1, ['stone_golem'], false);

    // Assert against the declared cap, not a magic number, so retuning the
    // data cannot silently invalidate the guard.
    const cap = registry.getSkill('summon_briar_wolf')!.maxSummons ?? 1;
    for (let i = 0; i < cap + 4; i++) {
      engine.skills.forEach(s => { s.cooldownRemaining = 0; });
      engine.performSkill('summon_briar_wolf');
    }
    const alive = engine.ctx.actors.filter(a => a.kind === 'summon' && a.alive).length;
    expect(alive).toBeLessThanOrEqual(cap);
    expect(alive).toBeGreaterThan(0);
  });

  it('feeds the summon passives that depend on it', () => {
    const { engine, meta } = makeEngine(404);
    giveSkill(meta, 'summon_briar_wolf');
    givePassive(meta, 'symbiotic_growth'); // +8 max HP per living summon
    engine.startRoom('combat', 1, ['stone_golem'], false);

    const before = engine.player.maxHp;
    engine.performSkill('summon_briar_wolf');
    expect(engine.player.maxHp, 'Symbiotic Growth did not fire').toBeGreaterThan(before);
  });
});

describe('forms are a real trade, not a dominant pick', () => {
  it('makes Bear better than Caster against a cluster, worse against one target', () => {
    const { engine, meta } = makeEngine(405);
    giveSkill(meta, 'bear_form_transform');
    engine.startRoom('combat', 1, ['stone_golem'], false);

    // Caster: one target, cheaper.
    const casterDpb = engine.attackDamage() / engine.attackCost();
    engine.performSkill('bear_form_transform');
    expect(engine.form).toBe('bear');
    const bearSingleDpb = engine.attackDamage() / engine.attackCost();
    const bearTripleDpb = (engine.attackDamage() * 3) / engine.attackCost();

    expect(bearSingleDpb, 'Bear should be worse per Beat on one target')
      .toBeLessThan(casterDpb);
    expect(bearTripleDpb, 'Bear should be clearly better on a cluster')
      .toBeGreaterThan(casterDpb);
    // And it has to give something back for standing in melee.
    expect(engine.player.maxHp).toBeGreaterThan(100);
  });

  it('lets a Bear sweep hit more than one tile', () => {
    const { engine, meta } = makeEngine(406);
    giveSkill(meta, 'bear_form_transform');
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    engine.performSkill('bear_form_transform');
    const target = { x: engine.player.tile.x + 1, y: engine.player.tile.y };
    expect(engine.attackPreview(target).length).toBeGreaterThan(1);
  });
});

void tileDist;
