import { describe, it, expect } from 'vitest';
import { ensureRegistry } from './helpers';
import { createRunState } from '../../engine/RunState';
import { registry } from '../../engine/DataRegistry';
import { getMeldableItems, previewMeld, executeMeld } from '../../systems/ShrineMeldSystem';

/**
 * Melding is one of the game's distinctive ideas and had no coverage at all.
 * These tests pin down that the shrine economy actually functions.
 */
describe('shrine melding', () => {
  function stateWithStuff() {
    ensureRegistry();
    const s = createRunState(999);
    const skillIds = ['summon_briar_wolf', 'spore_bolt'];
    skillIds.forEach(id => {
      const def = registry.getSkill(id)!;
      s.player.skills.push({ def, cooldownRemaining: 0, level: 1, upgraded: false });
    });
    ['venomweave_cloak', 'wild_stride_boots'].forEach(id => {
      const def = registry.getItem(id)!;
      s.player.items.push({ def, modifiers: [], melded: false });
    });
    ['pack_tactics', 'thorned_hide'].forEach(id => {
      const def = registry.getPassive(id)!;
      s.player.passives.push({ def, active: true });
    });
    s.player.essence = 500;
    return s;
  }

  it('offers what the player actually owns', () => {
    const s = stateWithStuff();
    expect(getMeldableItems(s, 'skill_skill').length).toBeGreaterThanOrEqual(2);
    expect(getMeldableItems(s, 'item_item').length).toBeGreaterThanOrEqual(2);
    expect(getMeldableItems(s, 'passive_passive').length).toBeGreaterThanOrEqual(2);
  });

  it('previews a meld before committing to it', () => {
    const s = stateWithStuff();
    const inputs = getMeldableItems(s, 'skill_skill');
    const preview = previewMeld(s, inputs[0], inputs[1], 'skill_skill');
    expect(preview.possible).toBe(true);
    expect(preview.outputName.length).toBeGreaterThan(0);
    expect(preview.outputDescription.length).toBeGreaterThan(0);
    expect(preview.cost).toBeGreaterThan(0);
    // The promise of a meld is two inherited traits plus one emergent one.
    expect(preview.inheritedTraits.length).toBeGreaterThanOrEqual(1);
    expect(preview.emergentTrait.length).toBeGreaterThan(0);
  });

  it('consumes both inputs and the essence, and yields one output', () => {
    const s = stateWithStuff();
    const before = s.player.skills.length;
    const essenceBefore = s.player.essence;

    const inputs = getMeldableItems(s, 'skill_skill');
    const preview = previewMeld(s, inputs[0], inputs[1], 'skill_skill');
    const ok = executeMeld(s, inputs[0], inputs[1], 'skill_skill', preview);

    expect(ok).toBe(true);
    // Two skills in, one out.
    expect(s.player.skills.length).toBe(before - 1);
    expect(s.player.essence).toBe(essenceBefore - preview.cost);
    expect(s.meldHistory.length).toBe(1);
  });

  it('refuses a meld the player cannot pay for', () => {
    const s = stateWithStuff();
    s.player.essence = 0;
    const inputs = getMeldableItems(s, 'skill_skill');
    const preview = previewMeld(s, inputs[0], inputs[1], 'skill_skill');
    expect(preview.possible).toBe(false);
    expect(preview.reason).toBeTruthy();
    expect(executeMeld(s, inputs[0], inputs[1], 'skill_skill', preview)).toBe(false);
  });
});
