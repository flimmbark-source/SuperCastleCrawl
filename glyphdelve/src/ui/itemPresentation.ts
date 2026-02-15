import type { InventoryItem, EncounterLootEntry, Rarity } from '../types';

const EFFECT_ICONS: Record<InventoryItem['effect'], string> = {
  heal: '🧪',
  resource: '🔷',
  cleanse: '✨',
};

const RARITY_ICONS: Record<Rarity, string> = {
  Common: '◻',
  Uncommon: '◼',
  Rare: '◆',
  Relic: '✦',
};

export function inventoryItemIcon(item: InventoryItem): string {
  return EFFECT_ICONS[item.effect] || '🎒';
}

export function encounterLootIcon(item: EncounterLootEntry): string {
  return RARITY_ICONS[item.rarity] || '◻';
}
