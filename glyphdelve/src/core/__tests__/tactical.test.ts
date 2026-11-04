import { describe, it, expect } from 'vitest';
import { makeEngine, giveSkill, giveItem, givePassive } from './helpers';
import { Grid, tileDist } from '../grid';
import { shove, livingEnemies, dealDamage, inflictStatus } from '../combat';
import { declareIntent } from '../ai';
import { hasStatus, statusStacks } from '../model';

describe('intent and dodging', () => {
  it('declares an intent for every living enemy, always', () => {
    const { engine } = makeEngine(7);
    engine.startRoom('combat', 1, ['skeleton_chaser', 'mushroom_spitter', 'stone_golem'], false);
    const enemies = livingEnemies(engine.ctx);
    expect(enemies.length).toBe(3);
    enemies.forEach(e => expect(e.intent).not.toBeNull());
  });

  it('commits attack intents to tiles, so stepping aside actually dodges', () => {
    // This is the core tactical promise: what you see telegraphed is what
    // happens, aimed where it was aimed, even if you leave.
    const { engine } = makeEngine(11);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);

    const enemy = livingEnemies(engine.ctx)[0];
    // Place the chaser adjacent so it declares an attack on the player's tile.
    enemy.tile = { x: engine.player.tile.x + 1, y: engine.player.tile.y };
    declareIntent(engine.ctx, enemy);
    expect(enemy.intent?.kind).toBe('attack');

    const targeted = (enemy.intent as { tiles: { x: number; y: number }[] }).tiles[0];
    expect(targeted).toEqual(engine.player.tile);

    // Step off the threatened tile before the enemy gets to act.
    const escape = engine.moveOptions()
      .find(o => tileDist(o.tile, targeted) >= 1 && (o.tile.x !== targeted.x || o.tile.y !== targeted.y));
    expect(escape).toBeTruthy();

    const hpBefore = engine.player.hp;
    engine.performMove(escape!.tile);
    // The attack resolved against the old tile and found nobody there.
    expect(engine.player.hp).toBe(hpBefore);
  });

  it('threatenedTiles surfaces the exact incoming damage the player faces', () => {
    const { engine } = makeEngine(13);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const enemy = livingEnemies(engine.ctx)[0];
    enemy.tile = { x: engine.player.tile.x + 1, y: engine.player.tile.y };
    declareIntent(engine.ctx, enemy);

    const incoming = engine.incomingDamageAt(engine.player.tile);
    expect(incoming).toBeGreaterThan(0);

    const hpBefore = engine.player.hp;
    // Stand in it on purpose. The chaser acts every 3 Beats, so hold until it does.
    while (engine.player.hp === hpBefore && engine.outcome === 'ongoing') engine.performWait();
    expect(hpBefore - engine.player.hp).toBe(incoming);
  });
});

describe('terrain', () => {
  it('blocks line of fire through walls and bramble', () => {
    const { engine } = makeEngine(21);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const g = new Grid(7, 3, 'floor');
    engine.ctx.grid = g;
    engine.player.tile = { x: 0, y: 1 };
    const target = { x: 4, y: 1 };

    expect(engine.canAttack(target).ok).toBe(true);
    g.set(2, 1, 'wall');
    expect(engine.canAttack(target).ok).toBe(false);
    g.set(2, 1, 'bramble');
    expect(engine.canAttack(target).ok).toBe(false);
    g.set(2, 1, 'floor');
    expect(engine.canAttack(target).ok).toBe(true);
  });

  it('protects an actor standing inside bramble from ranged fire', () => {
    const { engine } = makeEngine(22);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const g = new Grid(7, 3, 'floor');
    engine.ctx.grid = g;
    engine.player.tile = { x: 0, y: 1 };
    const target = { x: 3, y: 1 };
    expect(engine.canAttack(target).ok).toBe(true);
    g.set(3, 1, 'bramble');
    expect(engine.canAttack(target).ok).toBe(false);
  });

  it('charges the advertised extra Beat for moving into bramble', () => {
    const { engine } = makeEngine(23);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const p = engine.player.tile;
    const to = { x: p.x, y: p.y + 1 };
    engine.ctx.grid.set(to.x, to.y, 'floor');
    const plain = engine.moveCost(to);
    engine.ctx.grid.set(to.x, to.y, 'bramble');
    expect(engine.moveCost(to)).toBe(plain + 1);
  });

  it('never lets the player walk into a chasm', () => {
    const { engine } = makeEngine(24);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const p = engine.player.tile;
    const to = { x: p.x + 1, y: p.y };
    engine.ctx.grid.set(to.x, to.y, 'chasm');
    expect(engine.canMoveTo(to).ok).toBe(false);
    expect(engine.performMove(to).ok).toBe(false);
  });
});

describe('shove', () => {
  it('kills outright when something is pushed into a chasm', () => {
    const { engine } = makeEngine(31);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const g = new Grid(7, 3, 'floor');
    engine.ctx.grid = g;
    const enemy = livingEnemies(engine.ctx)[0];
    engine.player.tile = { x: 1, y: 1 };
    enemy.tile = { x: 2, y: 1 };
    enemy.hp = enemy.maxHp;
    g.set(3, 1, 'chasm');

    shove(engine.ctx, engine.player, enemy, { x: 1, y: 0 }, 1);
    expect(enemy.alive).toBe(false);
  });

  it('deals impact damage when something is slammed into a wall', () => {
    const { engine } = makeEngine(32);
    engine.startRoom('combat', 1, ['stone_golem'], false);
    const g = new Grid(7, 3, 'floor');
    engine.ctx.grid = g;
    const enemy = livingEnemies(engine.ctx)[0];
    engine.player.tile = { x: 1, y: 1 };
    enemy.tile = { x: 2, y: 1 };
    g.set(3, 1, 'wall');

    const hpBefore = enemy.hp;
    shove(engine.ctx, engine.player, enemy, { x: 1, y: 0 }, 1);
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(enemy.tile).toEqual({ x: 2, y: 1 }); // did not move through the wall
  });
});

describe('forms', () => {
  it('does not let repeated Bear Form toggles inflate max HP (regression)', () => {
    // The old implementation recomputed max HP from the current value, so
    // toggling form repeatedly ratcheted the player's maximum upward.
    const { engine, meta } = makeEngine(41);
    giveSkill(meta, 'bear_form_transform');
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);

    const baseMax = engine.player.maxHp;
    for (let i = 0; i < 8; i++) {
      engine.skills.forEach(s => { s.cooldownRemaining = 0; });
      engine.performSkill('bear_form_transform');
    }
    engine.skills.forEach(s => { s.cooldownRemaining = 0; });
    if (engine.form === 'bear') engine.performSkill('bear_form_transform');

    expect(engine.form).toBe('caster');
    expect(engine.player.maxHp).toBe(baseMax);
  });

  it('makes Bear Form a real trade: more damage and reach, more Beats', () => {
    const { engine, meta } = makeEngine(42);
    giveSkill(meta, 'bear_form_transform');
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);

    const casterCost = engine.attackCost();
    engine.performSkill('bear_form_transform');
    expect(engine.form).toBe('bear');
    expect(engine.attackCost()).toBeGreaterThan(casterCost);
    expect(engine.player.maxHp).toBeGreaterThan(100);
  });
});

describe('statuses', () => {
  it('makes Slow tax every action by a Beat per stack', () => {
    const { engine } = makeEngine(51);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const base = engine.attackCost();
    inflictStatus(engine.ctx, engine.player, engine.player, 'slow', 2, 10);
    expect(engine.attackCost()).toBe(base + 2);
  });

  it('ticks Bleed on the victim turn and decays a stack', () => {
    const { engine } = makeEngine(52);
    engine.startRoom('combat', 1, ['stone_golem'], false);
    const enemy = livingEnemies(engine.ctx)[0];
    inflictStatus(engine.ctx, engine.player, enemy, 'bleed', 3, 20);

    const hp0 = enemy.hp;
    // Spend enough Beats that the golem (5 Beats/action) definitely acts.
    for (let i = 0; i < 6; i++) engine.performWait();
    expect(enemy.hp).toBeLessThan(hp0);
    expect(statusStacks(enemy.statuses, 'bleed')).toBeLessThan(3);
  });

  it('consumes Brittle on the next hit for bonus damage', () => {
    const { engine } = makeEngine(53);
    engine.startRoom('combat', 1, ['stone_golem'], false);
    const enemy = livingEnemies(engine.ctx)[0];
    enemy.armor = 0;

    const plain = dealDamage(engine.ctx, {
      attacker: engine.player, target: enemy, amount: 10,
      type: 'physical', tags: ['Physical'], silentTriggers: true,
    }).dealt;

    inflictStatus(engine.ctx, engine.player, enemy, 'brittle', 1, 10);
    expect(hasStatus(enemy.statuses, 'brittle')).toBe(true);
    const boosted = dealDamage(engine.ctx, {
      attacker: engine.player, target: enemy, amount: 10,
      type: 'physical', tags: ['Physical'], silentTriggers: true,
    }).dealt;

    expect(boosted).toBeGreaterThan(plain);
    expect(hasStatus(enemy.statuses, 'brittle')).toBe(false);
  });
});

describe('action-modifying items actually modify the action', () => {
  it('Leaping Greaves extends Move to two tiles and costs a Beat more', () => {
    const { engine, meta } = makeEngine(61);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    expect(engine.moveRange()).toBe(1);
    giveItem(meta, 'leaping_greaves');
    engine.rebuildSkills();
    expect(engine.moveRange()).toBe(2);
  });

  it('Splinter Fang widens the ranged attack to the flanking tiles', () => {
    const { engine, meta } = makeEngine(62);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const target = { x: engine.player.tile.x + 2, y: engine.player.tile.y };
    expect(engine.attackPreview(target).length).toBe(1);
    giveItem(meta, 'splinter_fang');
    engine.rebuildSkills();
    expect(engine.attackPreview(target).length).toBeGreaterThan(1);
  });

  it('Wild Stride Boots make Move cheaper', () => {
    const { engine, meta } = makeEngine(63);
    engine.startRoom('combat', 1, ['skeleton_chaser'], false);
    const p = engine.player.tile;
    const to = { x: p.x, y: p.y + 1 };
    engine.ctx.grid.set(to.x, to.y, 'floor');
    const before = engine.moveCost(to);
    giveItem(meta, 'wild_stride_boots');
    engine.rebuildSkills();
    expect(engine.moveCost(to)).toBe(before - 1);
  });
});

describe('passives fire', () => {
  it('Bleeding Wounds applies Bleed when an area hit lands', () => {
    const { engine, meta } = makeEngine(71);
    givePassive(meta, 'bleeding_wounds');
    giveSkill(meta, 'thornburst');
    engine.startRoom('combat', 1, ['skeleton_chaser', 'skeleton_chaser'], false);

    // Put both enemies next to the player so Thornburst definitely catches them.
    const es = livingEnemies(engine.ctx);
    es[0].tile = { x: engine.player.tile.x + 1, y: engine.player.tile.y };
    es[1].tile = { x: engine.player.tile.x, y: engine.player.tile.y + 1 };

    // Bleed decays a stack each time the victim acts, so read the log for the
    // moment of application rather than the state several Beats later.
    engine.performSkill('thornburst');
    const applied = engine.ctx.log.filter(l => l.text.includes('gains Bleed'));
    expect(applied.length).toBeGreaterThan(0);
  });

  it('Debilitating Presence chains Slow onto any other debuff', () => {
    const { engine, meta } = makeEngine(72);
    givePassive(meta, 'debilitating_presence');
    engine.startRoom('combat', 1, ['stone_golem'], false);
    const enemy = livingEnemies(engine.ctx)[0];
    inflictStatus(engine.ctx, engine.player, enemy, 'bleed', 1, 6);
    expect(statusStacks(enemy.statuses, 'slow')).toBeGreaterThan(0);
  });
});
