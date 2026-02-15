import type { RunState, ItemDef, Tag, ActiveItem } from '../types';
import { DROP_RATES, HARD_CAPS } from '../types';
import { SeededRNG } from '../engine/SeededRNG';
import { registry } from '../engine/DataRegistry';
import { addCombatLog } from '../engine/RunState';

export interface DropResult {
  items: ItemDef[];
  essence: number;
  consumable: boolean;
}

export function rollDrops(
  state: RunState,
  enemyType: 'normal' | 'elite' | 'boss',
  rng: SeededRNG
): DropResult {
  const result: DropResult = { items: [], essence: 0, consumable: false };

  if (enemyType === 'normal') {
    // Pity logic
    let itemChance = DROP_RATES.normal.item;
    if (state.normalKillsSinceItem >= DROP_RATES.pityThreshold) {
      itemChance = DROP_RATES.pityItemChance;
    }

    if (rng.chance(itemChance)) {
      result.items.push(pickItem(state, rng, 'Common'));
      state.normalKillsSinceItem = 0;
    } else {
      state.normalKillsSinceItem++;
    }

    if (rng.chance(DROP_RATES.normal.essence)) {
      result.essence = rng.nextInt(3, 8);
    }
    if (rng.chance(DROP_RATES.normal.consumable)) {
      result.consumable = true;
    }
  } else if (enemyType === 'elite') {
    if (rng.chance(DROP_RATES.elite.item)) {
      result.items.push(pickItem(state, rng, 'Uncommon'));
      state.normalKillsSinceItem = 0;
    }
    // Elite always drops essence
    result.essence = rng.nextInt(12, 25);
    if (rng.chance(DROP_RATES.elite.consumable)) {
      result.consumable = true;
    }
  } else if (enemyType === 'boss') {
    // Guaranteed item
    const isRareRelic = rng.chance(DROP_RATES.boss.rareRelic);
    result.items.push(pickItem(state, rng, isRareRelic ? 'Rare' : 'Uncommon'));
    state.normalKillsSinceItem = 0;
    // Guaranteed essence cache
    result.essence = rng.nextInt(30, 50);
  }

  return result;
}

function pickItem(state: RunState, rng: SeededRNG, minRarity: string): ItemDef {
  const allItems = registry.getAllItems();
  const player = state.player;

  // Weight by tag synergy with current build
  const weights = allItems.map(item => {
    let weight = item.baseWeight;
    // Boost items matching player tags
    item.tags.forEach(t => {
      if (player.buildTags.has(t)) {
        weight *= 1.3;
      }
    });
    // Filter by rarity
    if (minRarity === 'Rare' && item.rarity === 'Common') weight *= 0.2;
    if (minRarity === 'Uncommon' && item.rarity === 'Common') weight *= 0.5;
    return weight;
  });

  return rng.weightedPick(allItems, weights);
}


export function createGuaranteedEncounterDrop(
  state: RunState,
  rng: SeededRNG,
  enemyType: 'normal' | 'elite' | 'boss'
): DropResult {
  const rarityFloor = enemyType === 'boss' ? 'Rare' : enemyType === 'elite' ? 'Uncommon' : 'Common';
  return {
    items: [pickItem(state, rng, rarityFloor)],
    essence: enemyType === 'boss' ? rng.nextInt(8, 14) : enemyType === 'elite' ? rng.nextInt(4, 8) : rng.nextInt(2, 5),
    consumable: false,
  };
}

export function applyDrops(state: RunState, drops: DropResult) {
  const player = state.player;

  drops.items.forEach(itemDef => {
    // Auto-equip if slot empty, otherwise add to inventory
    player.items.push({
      def: itemDef,
      modifiers: [],
      melded: false,
      cooldownRemaining: 0,
    });

    addCombatLog(state, {
      type: 'drop',
      source: 'enemy',
      details: `Dropped item: ${itemDef.name} [${itemDef.rarity}]`,
    });
  });

  if (drops.essence > 0) {
    player.essence += drops.essence;
    addCombatLog(state, {
      type: 'drop',
      source: 'enemy',
      value: drops.essence,
      details: `Dropped ${drops.essence} Essence`,
    });
  }

  if (drops.consumable) {
    player.inventory.push({
      id: `consumable_${Date.now()}_${Math.random()}`,
      name: 'Vial of Renewal',
      description: 'A compact restorative draught carried into the delve.',
      effect: 'heal',
      value: 20,
      charges: 1,
    });

    addCombatLog(state, {
      type: 'drop',
      source: 'enemy',
      details: 'Found consumable: Vial of Renewal (+20 HP on use)',
    });
  }
}

// Guaranteed pity drop for node 4 if no item yet
export function checkPityDrop(state: RunState, nodeIndex: number, rng: SeededRNG): DropResult | null {
  if (nodeIndex >= 3 && state.player.items.length === 0) {
    return {
      items: [pickItem(state, rng, 'Common')],
      essence: 5,
      consumable: false,
    };
  }
  return null;
}
