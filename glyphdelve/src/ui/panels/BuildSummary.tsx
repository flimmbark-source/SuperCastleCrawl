import React from 'react';
import type { PlayerEntity, RunState, Tag } from '../../types';

interface BuildSummaryProps {
  player: PlayerEntity;
  state: RunState;
  onClose: () => void;
}

export const BuildSummary: React.FC<BuildSummaryProps> = ({ player, state, onClose }) => {
  const tags = Array.from(player.buildTags.entries()).sort((a, b) => b[1] - a[1]);
  const topTags = tags.slice(0, 5);
  const activeSummons = state.entities.filter(e => e.type === 'summon' && e.alive).length;

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Build Summary</h2>
        <p style={styles.subtitle}>Level {player.level} Druid · Floor {state.floor}</p>

        <div style={styles.grid}>
          <div style={styles.column}>
            <h3 style={styles.colTitle}>Skills ({player.skills.length}/{player.maxSkillSlots})</h3>
            {player.skills.map(s => (
              <div key={s.def.id} style={styles.entry}>
                <span style={styles.entryName}>{s.def.name}</span>
                <div style={styles.entryTags}>
                  {s.def.tags.map(t => <span key={t} style={styles.tag}>{t}</span>)}
                </div>
                <p style={styles.entryDesc}>{s.def.description}</p>
              </div>
            ))}
          </div>

          <div style={styles.column}>
            <h3 style={styles.colTitle}>Passives ({player.passives.length})</h3>
            {player.passives.map(p => (
              <div key={p.def.id} style={styles.entry}>
                <span style={styles.entryName}>{p.def.name}</span>
                <div style={styles.entryTags}>
                  {p.def.tags.map(t => <span key={t} style={styles.tag}>{t}</span>)}
                </div>
              </div>
            ))}
          </div>

          <div style={styles.column}>
            <h3 style={styles.colTitle}>Items ({player.items.length})</h3>
            {player.items.map(i => (
              <div key={i.def.id} style={styles.entry}>
                <span style={styles.entryName}>{i.def.name} <span style={{ color: '#888' }}>[{i.def.rarity}]</span></span>
                <div style={styles.entryTags}>
                  {i.def.tags.map(t => <span key={t} style={styles.tag}>{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.statsRow}>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Top Tags</span>
            <div style={styles.topTags}>
              {topTags.map(([tag, count]) => (
                <span key={tag} style={styles.topTag}>{tag} ({count})</span>
              ))}
            </div>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>HP</span>
            <span style={styles.statValue}>{Math.ceil(player.hp)}/{player.maxHp}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Essence</span>
            <span style={styles.statValue}>{player.essence}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Summon Cap</span>
            <span style={styles.statValue}>{activeSummons}/8</span>
          </div>
        </div>

        <button style={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  panel: { maxWidth: 800, width: '95%', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 24, maxHeight: '85vh', overflowY: 'auto' },
  title: { fontSize: 22, color: '#ffd54f', fontFamily: 'monospace', margin: '0 0 4px', textAlign: 'center' },
  subtitle: { fontSize: 12, color: '#888', fontFamily: 'monospace', margin: '0 0 16px', textAlign: 'center' },
  grid: { display: 'flex', gap: 16, marginBottom: 16 },
  column: { flex: 1 },
  colTitle: { fontSize: 12, color: '#81d4fa', fontFamily: 'monospace', margin: '0 0 8px', borderBottom: '1px solid #333', paddingBottom: 4 },
  entry: { marginBottom: 8, padding: 6, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 4 },
  entryName: { fontSize: 11, color: '#e0e0e0', fontFamily: 'monospace', fontWeight: 'bold' },
  entryTags: { display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 },
  tag: { fontSize: 8, color: '#aaa', backgroundColor: 'rgba(255,255,255,0.08)', padding: '0 3px', borderRadius: 2, fontFamily: 'monospace' },
  entryDesc: { fontSize: 9, color: '#888', fontFamily: 'monospace', margin: '2px 0 0' },
  statsRow: { display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', padding: '12px 0', borderTop: '1px solid #333' },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  statLabel: { fontSize: 9, color: '#888', fontFamily: 'monospace', textTransform: 'uppercase' },
  statValue: { fontSize: 14, color: '#e0e0e0', fontFamily: 'monospace', fontWeight: 'bold' },
  topTags: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  topTag: { fontSize: 10, color: '#4fc3f7', fontFamily: 'monospace' },
  closeBtn: { width: '100%', marginTop: 12, padding: '8px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'monospace' },
};
