import type {
  SkillDef, PassiveDef, ItemDef, ModifierDef,
  EnemyDef, EliteModifierDef, BossDef, MeldRecipe, Tag
} from '../types';

class DataRegistry {
  private skills: Map<string, SkillDef> = new Map();
  private passives: Map<string, PassiveDef> = new Map();
  private items: Map<string, ItemDef> = new Map();
  private modifiers: Map<string, ModifierDef> = new Map();
  private enemies: Map<string, EnemyDef> = new Map();
  private eliteModifiers: Map<string, EliteModifierDef> = new Map();
  private bosses: Map<string, BossDef> = new Map();
  private meldRecipes: MeldRecipe[] = [];

  registerSkills(defs: SkillDef[]) {
    defs.forEach(d => this.skills.set(d.id, d));
  }
  registerPassives(defs: PassiveDef[]) {
    defs.forEach(d => this.passives.set(d.id, d));
  }
  registerItems(defs: ItemDef[]) {
    defs.forEach(d => this.items.set(d.id, d));
  }
  registerModifiers(defs: ModifierDef[]) {
    defs.forEach(d => this.modifiers.set(d.id, d));
  }
  registerEnemies(defs: EnemyDef[]) {
    defs.forEach(d => this.enemies.set(d.id, d));
  }
  registerEliteModifiers(defs: EliteModifierDef[]) {
    defs.forEach(d => this.eliteModifiers.set(d.id, d));
  }
  registerBosses(defs: BossDef[]) {
    defs.forEach(d => this.bosses.set(d.id, d));
  }
  registerMeldRecipes(recipes: MeldRecipe[]) {
    this.meldRecipes = recipes;
  }

  getSkill(id: string): SkillDef | undefined { return this.skills.get(id); }
  getPassive(id: string): PassiveDef | undefined { return this.passives.get(id); }
  getItem(id: string): ItemDef | undefined { return this.items.get(id); }
  getModifier(id: string): ModifierDef | undefined { return this.modifiers.get(id); }
  getEnemy(id: string): EnemyDef | undefined { return this.enemies.get(id); }
  getEliteModifier(id: string): EliteModifierDef | undefined { return this.eliteModifiers.get(id); }
  getBoss(id: string): BossDef | undefined { return this.bosses.get(id); }

  getAllSkills(): SkillDef[] { return Array.from(this.skills.values()); }
  getAllPassives(): PassiveDef[] { return Array.from(this.passives.values()); }
  getAllItems(): ItemDef[] { return Array.from(this.items.values()); }
  getAllModifiers(): ModifierDef[] { return Array.from(this.modifiers.values()); }
  getAllEnemies(): EnemyDef[] { return Array.from(this.enemies.values()); }
  getAllEliteModifiers(): EliteModifierDef[] { return Array.from(this.eliteModifiers.values()); }
  getAllBosses(): BossDef[] { return Array.from(this.bosses.values()); }
  getMeldRecipes(): MeldRecipe[] { return this.meldRecipes; }

  getSkillsByTags(tags: Tag[]): SkillDef[] {
    return this.getAllSkills().filter(s => tags.some(t => s.tags.includes(t)));
  }
  getPassivesByTags(tags: Tag[]): PassiveDef[] {
    return this.getAllPassives().filter(p => tags.some(t => p.tags.includes(t)));
  }
  getItemsByTags(tags: Tag[]): ItemDef[] {
    return this.getAllItems().filter(i => tags.some(t => i.tags.includes(t)));
  }

  findMeldRecipe(input1Tags: Tag[], input2Tags: Tag[], type: string): MeldRecipe | undefined {
    return this.meldRecipes.find(r => {
      if (r.type !== type) return false;
      const match1 = r.input1Tags.some(t => input1Tags.includes(t));
      const match2 = r.input2Tags.some(t => input2Tags.includes(t));
      return match1 && match2;
    });
  }
}

export const registry = new DataRegistry();
