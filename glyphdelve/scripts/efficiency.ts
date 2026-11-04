// Is a skill ever worth its Beats compared with just attacking?
import { initializeRegistry } from '../src/data';
import { registry } from '../src/engine/DataRegistry';
import { defaultBeatCost } from '../src/core/model';
import { FORM } from '../src/core/tactical';

initializeRegistry();
const LEVEL = 4;
const basic = FORM.caster.damage + (LEVEL - 1) * 2;
console.log(`Basic attack (Caster, L${LEVEL}): ${basic} dmg / ${FORM.caster.cost} Beats = ${(basic / FORM.caster.cost).toFixed(2)} dmg/Beat\n`);
console.log('skill                  dmg  beats  dmg/Beat  vs basic   targets needed');
for (const s of registry.getAllSkills()) {
  if (!s.damage) continue;
  const cost = defaultBeatCost(s.cooldown);
  const dpb = s.damage / cost;
  const ratio = dpb / (basic / FORM.caster.cost);
  const need = Math.ceil((basic / FORM.caster.cost) / dpb);
  console.log(
    `${s.id.padEnd(22)} ${String(s.damage).padStart(3)} ${String(cost).padStart(5)} ` +
    `${dpb.toFixed(2).padStart(9)} ${(ratio * 100).toFixed(0).padStart(7)}% ${String(need).padStart(10)}`);
}
