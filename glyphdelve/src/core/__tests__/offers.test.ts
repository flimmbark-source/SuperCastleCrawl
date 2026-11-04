import { describe, it, expect } from 'vitest';
import { ensureRegistry } from './helpers';
import { createRunState } from '../../engine/RunState';
import { registry } from '../../engine/DataRegistry';
import { SeededRNG } from '../../engine/SeededRNG';
import { generateLevelUpOffers, applyLevelUpChoice } from '../../systems/LevelSystem';
import { updateBuildTags } from '../../engine/RunState';

/**
 * The offer generator is the heart of the build-crafting identity — the game
 * noticing what you are building — and had no test coverage at all.
 */
describe('level-up offers', () => {
  function freshState(seed = 5) {
    ensureRegistry();
    return createRunState(seed);
  }

  it('counts the starting kit, so synergy means something on the first level', () => {
    const s = freshState();
    // Regression: buildTags was empty at run start, which made calculateSynergy
    // short-circuit and report "Med" for every single offer.
    expect(s.player.buildTags.size).toBeGreaterThan(0);
  });

  it('always offers a full, non-duplicated hand', () => {
    const s = freshState();
    const rng = new SeededRNG(1);
    for (let level = 0; level < 6; level++) {
      const offers = generateLevelUpOffers(s, rng);
      expect(offers.length).toBeGreaterThanOrEqual(3);
      const ids = offers.map(o => o.id);
      expect(new Set(ids).size, `duplicate offers: ${ids.join(', ')}`).toBe(ids.length);
      applyLevelUpChoice(s, offers[0].id);
      updateBuildTags(s.player);
    }
  });

  it('never offers something the player already owns', () => {
    const s = freshState(11);
    const rng = new SeededRNG(2);
    for (let i = 0; i < 8; i++) {
      const offers = generateLevelUpOffers(s, rng);
      const owned = new Set([
        ...s.player.skills.map(x => x.def.id),
        ...s.player.passives.map(x => x.def.id),
      ]);
      const dupes = offers.filter(o => o.type !== 'skill_upgrade' && owned.has(o.id));
      expect(dupes.map(d => d.id), 'offered something already owned').toEqual([]);
      applyLevelUpChoice(s, offers[0].id);
      updateBuildTags(s.player);
    }
  });

  it('differentiates synergy once a build has a shape', () => {
    const s = freshState(21);
    // Commit hard to summons, then check the generator notices.
    ['summon_briar_wolf', 'spirit_swarm'].forEach(id => {
      const def = registry.getSkill(id)!;
      s.player.skills.push({ def, cooldownRemaining: 0, level: 1, upgraded: false });
    });
    updateBuildTags(s.player);

    const rng = new SeededRNG(3);
    const ratings = new Set<string>();
    for (let i = 0; i < 12; i++) {
      generateLevelUpOffers(s, rng).forEach(o => ratings.add(o.synergy));
    }
    // A committed build should see more than one synergy tier across 12 hands.
    expect(ratings.size, `only ever saw: ${[...ratings].join(', ')}`).toBeGreaterThan(1);
  });

  it('rarely pushes summon passives at a player with no summon', () => {
    const s = freshState(31);
    const rng = new SeededRNG(4);
    let summonCards = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      generateLevelUpOffers(s, rng).forEach(o => {
        total++;
        if (o.type === 'passive' && o.tags.includes('Summon')) summonCards++;
      });
    }
    // Regression: a level-1 hand could be three-fifths summon passives, each
    // of which does literally nothing without a summon skill.
    expect(summonCards / total, 'too many inert summon offers').toBeLessThan(0.2);
  });
});
