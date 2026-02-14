import React, { useState } from 'react';
import type { RunState, PlayerEntity, Tag, CombatLogEntry } from '../../types';

interface SidePanelProps {
  state: RunState;
}

export const SidePanel: React.FC<SidePanelProps> = ({ state }) => {
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
        {tab === 'build' && <BuildTab player={state.player} state={state} />}
        {tab === 'tags' && <TagsTab player={state.player} />}
        {tab === 'log' && <LogTab log={state.combatLog} />}
      </div>
    </div>
  );
};

const BuildTab: React.FC<{ player: PlayerEntity; state: RunState }> = ({ player, state }) => (
  <div style={styles.buildTab}>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Skills ({player.skills.length}/{player.maxSkillSlots})</h4>
      {player.skills.map(s => (
        <div key={s.def.id} style={styles.buildItem}>
          <span style={styles.buildItemName}>{s.def.name}</span>
          <span style={styles.buildItemTags}>{s.def.tags.slice(0, 2).join(', ')}</span>
        </div>
      ))}
    </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Passives ({player.passives.length})</h4>
      {player.passives.map(p => (
        <div key={p.def.id} style={styles.buildItem}>
          <span style={styles.buildItemName}>{p.def.name}</span>
          <span style={styles.buildItemTags}>{p.def.tags.slice(0, 2).join(', ')}</span>
        </div>
      ))}
    </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Items ({player.items.length})</h4>
      {player.items.map(i => (
        <div key={i.def.id} style={styles.buildItem}>
          <span style={styles.buildItemName}>{i.def.name}</span>
          <span style={styles.buildItemRarity}>[{i.def.rarity}]</span>
        </div>
      ))}
    </div>
    <div style={styles.buildSection}>
      <h4 style={styles.sectionTitle}>Active Summons</h4>
      <span style={styles.summonCount}>
        {state.entities.filter(e => e.type === 'summon' && e.alive).length} / 8
      </span>
    </div>
  </div>
);

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
  panel: { position: 'absolute', top: 8, right: 8, width: 220, maxHeight: 'calc(100vh - 80px)', backgroundColor: 'rgba(13,13,26,0.92)', borderRadius: 8, border: '1px solid #333', zIndex: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid #333' },
  tabs: { display: 'flex', gap: 2 },
  tab: { padding: '3px 8px', border: 'none', borderRadius: 3, color: '#ccc', fontFamily: 'monospace', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize' },
  collapseBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '2px 4px' },
  expandBtn: { position: 'absolute', top: 8, right: 8, background: 'rgba(13,13,26,0.9)', border: '1px solid #333', borderRadius: 4, color: '#666', cursor: 'pointer', fontSize: 14, padding: '4px 8px', zIndex: 10 },
  content: { padding: 8, overflowY: 'auto', flex: 1 },
  buildTab: { display: 'flex', flexDirection: 'column', gap: 8 },
  buildSection: {},
  sectionTitle: { fontSize: 10, color: '#81d4fa', fontFamily: 'monospace', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 },
  buildItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' },
  buildItemName: { fontSize: 10, color: '#ccc', fontFamily: 'monospace' },
  buildItemTags: { fontSize: 8, color: '#666', fontFamily: 'monospace' },
  buildItemRarity: { fontSize: 8, color: '#888', fontFamily: 'monospace' },
  summonCount: { fontSize: 12, color: '#66bb6a', fontFamily: 'monospace' },
  tagsTab: { display: 'flex', flexDirection: 'column', gap: 4 },
  emptyText: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
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
