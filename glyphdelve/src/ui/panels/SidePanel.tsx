import React, { useState } from 'react';
import type { RunState, PlayerEntity, CombatLogEntry, ActiveItem, InventoryItem } from '../../types';
import { inventoryItemIcon } from '../itemPresentation';

interface SidePanelProps {
  state: RunState;
  onUseInventoryItem: (itemId: string) => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({ state, onUseInventoryItem }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'tags' | 'log' | 'build'>('build');

  if (collapsed) {
    return (
      <button style={styles.expandBtn} onClick={() => setCollapsed(false)}>
        ◀
      </button>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.tabs}>
          {(['build', 'tags', 'log'] as const).map(t => (
            <button
              key={t}
              style={{ ...styles.tab, backgroundColor: tab === t ? '#2e7d32' : 'transparent' }}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button style={styles.collapseBtn} onClick={() => setCollapsed(true)}>▶</button>
      </div>

      <div style={styles.content}>
        {tab === 'build' && <BuildTab player={state.player} state={state} onUseInventoryItem={onUseInventoryItem} />}
        {tab === 'tags' && <TagsTab player={state.player} />}
        {tab === 'log' && <LogTab log={state.combatLog} />}
      </div>
    </div>
  );
};

const BuildTab: React.FC<{ player: PlayerEntity; state: RunState; onUseInventoryItem: (itemId: string) => void }> = ({ player, state, onUseInventoryItem }) => (
  <InventorySection player={player} state={state} onUseInventoryItem={onUseInventoryItem} />
);

const InventorySection: React.FC<{ player: PlayerEntity; state: RunState; onUseInventoryItem: (itemId: string) => void }> = ({ player, state, onUseInventoryItem }) => {
  const [tooltip, setTooltip] = useState<{ item: InventoryItem; x: number; y: number } | null>(null);

  return (
    <div style={styles.buildTab}>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Skills ({player.skills.length}/{player.maxSkillSlots})</h4>
      {player.skills.map(s => (
        <div key={s.def.id} style={styles.buildItem} title={`${s.def.description}\n${s.def.triggerSentence}`}>
          <span style={styles.buildItemName}>{s.def.name}</span>
          <span style={styles.buildItemTags}>{s.def.tags.slice(0, 2).join(', ')}</span>
        </div>
      ))}
    </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Passives ({player.passives.length})</h4>
      {player.passives.map(p => (
        <div key={p.def.id} style={styles.buildItem} title={`${p.def.description}\n${p.def.triggerSentence}`}>
          <span style={styles.buildItemName}>{p.def.name}</span>
          <span style={styles.buildItemTags}>{p.def.tags.slice(0, 2).join(', ')}</span>
        </div>
      ))}
    </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Items ({player.items.length})</h4>
      {player.items.map(i => (
        <div key={i.def.id} style={styles.itemCard} title={buildEquippedItemTooltip(i)}>
          <div style={styles.buildItem}>
            <span style={styles.buildItemName}>{i.def.name}</span>
            <span style={styles.buildItemRarity}>[{i.def.rarity}]</span>
          </div>
          <div style={styles.itemDescription}>{buildItemEffectSummary(i)}</div>
        </div>
      ))}
      {player.items.length === 0 && <p style={styles.emptyText}>No equipped items yet</p>}
    </div>
      <div style={styles.buildSection}>
        <h4 style={styles.sectionTitle}>Inventory ({player.inventory.length})</h4>
        <div style={styles.inventoryContainer}>
          {player.inventory.length === 0 && <p style={styles.emptyText}>No consumables in pack</p>}
          {player.inventory.map(item => (
            <button
              key={item.id}
              style={styles.inventoryButton}
              onClick={() => onUseInventoryItem(item.id)}
              onMouseEnter={(e) => setTooltip({ item, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setTooltip({ item, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            >
              <div style={styles.inventoryHeader}>
                <span style={styles.inventoryIcon}>{inventoryItemIcon(item)}</span>
                <span style={styles.inventoryName}>{item.name}</span>
              </div>
              <span style={styles.inventoryDesc}>{item.description}</span>
              <span style={styles.inventoryEffect}>{inventoryEffectSummary(item)} · x{item.charges}</span>
            </button>
          ))}
        </div>
      </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Active Summons</h4>
      <span style={styles.summonCount}>
        {state.entities.filter(e => e.type === 'summon' && e.alive).length} / 8
      </span>
    </div>
      {tooltip && (
        <div style={{ ...styles.inventoryTooltip, left: tooltip.x + 10, top: tooltip.y + 10 }}>
          <div style={styles.inventoryTooltipTitle}>{inventoryItemIcon(tooltip.item)} {tooltip.item.name}</div>
          <div style={styles.inventoryTooltipBody}>{tooltip.item.description}</div>
          <div style={styles.inventoryTooltipBody}>{inventoryEffectSummary(tooltip.item)}</div>
          <div style={styles.inventoryTooltipCharges}>Charges: {tooltip.item.charges}</div>
        </div>
      )}
    </div>
  );
};

const TagsTab: React.FC<{ player: PlayerEntity }> = ({ player }) => {
  const tags = Array.from(player.buildTags.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <div style={styles.tagsTab}>
      {tags.length === 0 && <p style={styles.emptyText}>No tags yet</p>}
      {tags.map(([tag, count]) => (
        <div key={tag} style={styles.tagRow}>
          <span style={styles.tagName}>{tag}</span>
          <div style={styles.tagBar}>
            <div style={{ ...styles.tagBarFill, width: `${Math.min(100, count * 15)}%` }} />
          </div>
          <span style={styles.tagCount}>{count}</span>
        </div>
      ))}
    </div>
  );
};

const LogTab: React.FC<{ log: CombatLogEntry[] }> = ({ log }) => (
  <div style={styles.logTab}>
    {log.slice(-30).reverse().map((entry, i) => (
      <div key={i} style={styles.logEntry}>
        <span style={{ ...styles.logType, color: LOG_COLORS[entry.type] || '#888' }}>
          [{entry.type}]
        </span>
        <span style={styles.logDetails}>{entry.details}</span>
      </div>
    ))}
  </div>
);

function buildItemEffectSummary(item: ActiveItem): string {
  if (item.def.effects.length === 0) return item.def.description;
  return item.def.effects.map(effect => {
    if (effect.type === 'stat_mod' && effect.stat) {
      const amt = effect.percent ? `${Math.round((effect.value || 0) * 100)}%` : `${effect.value || 0}`;
      return `${effect.stat.replaceAll('_', ' ')} +${amt}`;
    }
    if (effect.type === 'trigger' && effect.trigger) {
      return `${effect.trigger.event}: ${effect.trigger.effect.replaceAll('_', ' ')}`;
    }
    if (effect.description) return effect.description;
    return effect.type;
  }).join(' · ');
}

function buildEquippedItemTooltip(item: ActiveItem): string {
  return `${item.def.name}\n${item.def.description}\n${buildItemEffectSummary(item)}`;
}

function inventoryEffectSummary(item: InventoryItem): string {
  if (item.effect === 'heal') return `Restore ${item.value} HP`;
  if (item.effect === 'resource') return `Restore ${item.value} Resource`;
  return 'Cleanse negative effects';
}

const LOG_COLORS: Record<string, string> = {
  damage: '#ef5350',
  heal: '#4caf50',
  kill: '#ff9800',
  trigger: '#81d4fa',
  summon: '#66bb6a',
  drop: '#ffd54f',
  levelup: '#e040fb',
  meld: '#ab47bc',
};

const styles: Record<string, React.CSSProperties> = {
  panel: { position: 'absolute', top: 8, right: 8, width: 248, maxHeight: 'calc(100vh - 80px)', backgroundColor: 'rgba(13,13,26,0.92)', borderRadius: 8, border: '1px solid #333', zIndex: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid #333' },
  tabs: { display: 'flex', gap: 2 },
  tab: { padding: '3px 8px', border: 'none', borderRadius: 3, color: '#ccc', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize' },
  collapseBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '2px 4px' },
  expandBtn: { position: 'absolute', top: 8, right: 8, background: 'rgba(13,13,26,0.9)', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontSize: 14, padding: '4px 8px', zIndex: 10 },
  content: { padding: 8, overflowY: 'auto', flex: 1 },
  buildTab: { display: 'flex', flexDirection: 'column', gap: 8 },
  buildSection: {},
  sectionTitle: { fontSize: 10, color: '#81d4fa', fontFamily: 'monospace', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 },
  buildItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', gap: 8 },
  buildItemName: { fontSize: 10, color: '#ccc', fontFamily: 'monospace' },
  buildItemTags: { fontSize: 8, color: '#666', fontFamily: 'monospace' },
  buildItemRarity: { fontSize: 8, color: '#888', fontFamily: 'monospace' },
  itemCard: { border: '1px solid #2e3446', borderRadius: 4, padding: '4px 6px', marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.02)' },
  itemDescription: { fontSize: 9, color: '#97a2bd', fontFamily: 'monospace', lineHeight: 1.25 },
  inventoryContainer: { display: 'flex', flexDirection: 'column', gap: 6 },
  inventoryButton: { border: '1px solid #455a64', backgroundColor: 'rgba(38, 50, 56, 0.45)', borderRadius: 4, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px', cursor: 'pointer' },
  inventoryHeader: { display: 'flex', alignItems: 'center', gap: 6 },
  inventoryIcon: { fontSize: 14, lineHeight: 1 },
  inventoryName: { fontSize: 10, color: '#e0f2f1', fontFamily: 'monospace', fontWeight: 'bold' },
  inventoryDesc: { fontSize: 9, color: '#9fb0c9', fontFamily: 'monospace' },
  inventoryEffect: { fontSize: 9, color: '#c5e1a5', fontFamily: 'monospace' },
  inventoryTooltip: {
    position: 'fixed',
    maxWidth: 220,
    backgroundColor: 'rgba(10, 14, 25, 0.96)',
    border: '1px solid #415073',
    borderRadius: 6,
    padding: '6px 7px',
    zIndex: 160,
    pointerEvents: 'none',
    boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
  },
  inventoryTooltipTitle: { color: '#e4ecff', fontFamily: 'monospace', fontSize: 10, marginBottom: 4 },
  inventoryTooltipBody: { color: '#b3c1dd', fontFamily: 'monospace', fontSize: 9, lineHeight: 1.25 },
  inventoryTooltipCharges: { color: '#c5e1a5', fontFamily: 'monospace', fontSize: 9, marginTop: 4 },
  summonCount: { fontSize: 12, color: '#66bb6a', fontFamily: 'monospace' },
  tagsTab: { display: 'flex', flexDirection: 'column', gap: 4 },
  emptyText: { fontSize: 10, color: '#555', fontFamily: 'monospace', margin: 0 },
  tagRow: { display: 'flex', alignItems: 'center', gap: 4 },
  tagName: { fontSize: 10, color: '#bbb', fontFamily: 'monospace', minWidth: 55 },
  tagBar: { flex: 1, height: 6, backgroundColor: '#1a1a2e', borderRadius: 2, overflow: 'hidden' },
  tagBarFill: { height: '100%', backgroundColor: '#4fc3f7', borderRadius: 2, transition: 'width 0.3s' },
  tagCount: { fontSize: 9, color: '#888', fontFamily: 'monospace', minWidth: 14, textAlign: 'right' },
  logTab: { display: 'flex', flexDirection: 'column', gap: 2 },
  logEntry: { display: 'flex', gap: 4, alignItems: 'flex-start' },
  logType: { fontSize: 8, fontFamily: 'monospace', minWidth: 48, textTransform: 'uppercase' },
  logDetails: { fontSize: 9, color: '#999', fontFamily: 'monospace', lineHeight: 1.3 },
};
