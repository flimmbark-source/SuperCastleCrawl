import { registry } from '../engine/DataRegistry';
import { druidSkills } from './skills';
import { druidPassives } from './passives';
import { druidItems } from './items';
import { druidModifiers } from './modifiers';
import { enemies, eliteModifiers, bosses } from './enemies';
import { meldRecipes, meldedSkills, meldedPassives, meldedItems } from './meldRecipes';

export function initializeRegistry() {
  registry.registerSkills([...druidSkills, ...meldedSkills as any]);
  registry.registerPassives([...druidPassives, ...meldedPassives as any]);
  registry.registerItems([...druidItems, ...meldedItems as any]);
  registry.registerModifiers(druidModifiers);
  registry.registerEnemies(enemies);
  registry.registerEliteModifiers(eliteModifiers);
  registry.registerBosses(bosses);
  registry.registerMeldRecipes(meldRecipes);
}
