import { SeededRNG } from '../../engine/SeededRNG';
import { registry } from '../../engine/DataRegistry';
import { initializeRegistry } from '../../data';
import { createPlayer } from '../../engine/RunState';
import { TacticalEngine } from '../tactical';
import type { PlayerEntity } from '../../types';

let ready = false;
export function ensureRegistry(): void {
  if (ready) return;
  initializeRegistry();
  ready = true;
}

export function makeEngine(seed = 1234): { engine: TacticalEngine; meta: PlayerEntity } {
  ensureRegistry();
  const meta = createPlayer();
  const engine = new TacticalEngine(new SeededRNG(seed), meta);
  return { engine, meta };
}

export function giveSkill(meta: PlayerEntity, id: string): void {
  ensureRegistry();
  const def = registry.getSkill(id);
  if (!def) throw new Error(`no skill ${id}`);
  if (meta.skills.some(s => s.def.id === id)) return;
  meta.skills.push({ def, cooldownRemaining: 0, level: 1, upgraded: false });
}

export function giveItem(meta: PlayerEntity, id: string): void {
  ensureRegistry();
  const def = registry.getItem(id);
  if (!def) throw new Error(`no item ${id}`);
  meta.items.push({ def, modifiers: [], melded: false });
}

export function givePassive(meta: PlayerEntity, id: string): void {
  ensureRegistry();
  const def = registry.getPassive(id);
  if (!def) throw new Error(`no passive ${id}`);
  meta.passives.push({ def, active: true });
}
