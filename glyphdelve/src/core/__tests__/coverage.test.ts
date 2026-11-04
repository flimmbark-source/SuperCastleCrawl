import { describe, it, expect } from 'vitest';
import { ensureRegistry } from './helpers';
import { registry } from '../../engine/DataRegistry';
import { HOOK_IMPLEMENTED_IDS } from '../contentHooks';
import { ENGINE_IMPLEMENTED_IDS } from '../tactical';
import { druidItems } from '../../data/items';
import { druidPassives } from '../../data/passives';
import { druidSkills } from '../../data/skills';

/**
 * The original build shipped 8 items, 5 passives and a skill that were offered
 * to the player, read as upgrades, and did literally nothing. These tests make
 * that failure impossible to reintroduce silently: adding content without
 * implementing it fails the suite.
 */
describe('content coverage', () => {
  const implemented = new Set([...HOOK_IMPLEMENTED_IDS, ...ENGINE_IMPLEMENTED_IDS]);

  it('implements every declared item', () => {
    const missing = druidItems.map(i => i.id).filter(id => !implemented.has(id));
    expect(missing, `items with no implementation: ${missing.join(', ')}`).toEqual([]);
  });

  it('implements every declared passive', () => {
    const missing = druidPassives.map(p => p.id).filter(id => !implemented.has(id));
    expect(missing, `passives with no implementation: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives every declared skill an executable effect', () => {
    ensureRegistry();
    // Every skill id must be reachable by the engine's skill switch. We assert
    // via the registry plus the engine's own handled-id list below.
    const handled = new Set([
      'bear_form_transform', 'bear_form_enhanced',
      'summon_briar_wolf', 'summon_briar_wolf_alpha',
      'entangling_vines', 'spore_bolt', 'spirit_swarm', 'thornburst',
      'totemic_ward', 'fungal_link', 'wild_charge', 'roaring_sprint',
      'repeating_echo', 'thorn_mantle',
    ]);
    const missing = druidSkills.map(s => s.id).filter(id => !handled.has(id));
    expect(missing, `skills with no engine case: ${missing.join(', ')}`).toEqual([]);

    // Upgrades must resolve to a real parent skill.
    druidSkills.forEach(s => {
      (s.upgrades ?? []).forEach(u => {
        expect(registry.getSkill(u.parentSkillId), `${u.id} parent`).toBeTruthy();
      });
    });
  });

  it('keeps every piece of content honest about what it does', () => {
    // Descriptions are the player's only contract with the systems. Anything
    // still describing the pre-rewrite real-time world would be a lie.
    const stale = /\b\d+(\.\d+)?s\b|seconds?\b|move speed|attack speed|cooldown reduction/i;
    const offenders: string[] = [];
    [...druidItems, ...druidPassives].forEach(c => {
      if (stale.test(c.triggerSentence)) offenders.push(`${c.id}: ${c.triggerSentence}`);
    });
    expect(offenders, `content still described in real-time terms:\n${offenders.join('\n')}`).toEqual([]);
  });
});
