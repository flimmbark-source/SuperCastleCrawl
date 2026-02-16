import React from 'react';
import type { RunState } from '../../types';

interface DebugOverlayProps {
  state: RunState;
  fps: number;
  showHitboxes: boolean;
  showTriggerChains: boolean;
  showCaps: boolean;
  onToggle: (key: string) => void;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  state, fps, showHitboxes, showTriggerChains, showCaps, onToggle
}) => {
  const activeSummons = state.entities.filter(e => e.type === 'summon' && e.alive).length;
  const activeEnemies = state.entities.filter(e => e.type === 'enemy' && e.alive).length;
  const activeProjectiles = state.entities.filter(e => e.type === 'projectile' && e.alive).length;
  const avgTriggerDepth = state.triggerChainDepths.length > 0
    ? (state.triggerChainDepths.reduce((a, b) => a + b, 0) / state.triggerChainDepths.length).toFixed(1)
    : '0';

  const deathCauses = Array.from(state.deathCauseTaxonomy.entries());
  const meldCount = state.meldHistory.length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>DEBUG</div>

      <div style={styles.row}>FPS: <span style={{ color: fps > 50 ? '#4caf50' : '#f44336' }}>{fps}</span></div>
      <div style={styles.row}>Seed: {state.seed}</div>
      <div style={styles.row}>Time: {state.runTime.toFixed(1)}s</div>
      <div style={styles.row}>Entities: {state.entities.length} (E:{activeEnemies} S:{activeSummons} P:{activeProjectiles})</div>
      <div style={styles.row}>Kills: {state.killCount}</div>
      <div style={styles.row}>Level: {state.player.level} (XP: {state.player.xp}/{state.player.xpToNext})</div>
      <div style={styles.row}>Avg Trigger Depth: {avgTriggerDepth}</div>
      <div style={styles.row}>Melds: {meldCount}</div>

      {deathCauses.length > 0 && (
        <div style={styles.section}>
          <div style={styles.subHeader}>Death Causes</div>
          {deathCauses.map(([cause, count]) => (
            <div key={cause} style={styles.row}>{cause}: {count}</div>
          ))}
        </div>
      )}

      {activeSummons >= 7 && showCaps && (
        <div style={{ ...styles.row, color: '#ff9800' }}>⚠ Summon cap near ({activeSummons}/8)</div>
      )}

      <div style={styles.toggles}>
        <button style={styles.toggleBtn} onClick={() => onToggle('hitboxes')}>
          {showHitboxes ? '● ' : '○ '}Hitboxes
        </button>
        <button style={styles.toggleBtn} onClick={() => onToggle('triggers')}>
          {showTriggerChains ? '● ' : '○ '}Triggers
        </button>
        <button style={styles.toggleBtn} onClick={() => onToggle('caps')}>
          {showCaps ? '● ' : '○ '}Caps
        </button>
      </div>

      <div style={styles.row}>
        <span style={styles.seedAction}>Press F5 to restart same seed</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'absolute', bottom: 70, left: 8, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 6, padding: '6px 10px', zIndex: 20, fontFamily: 'monospace', fontSize: 10, color: '#888', minWidth: 180 },
  header: { fontSize: 10, color: '#ff9800', fontWeight: 'bold', marginBottom: 4, letterSpacing: 2 },
  row: { padding: '1px 0' },
  section: { marginTop: 4, borderTop: '1px solid #333', paddingTop: 4 },
  subHeader: { fontSize: 9, color: '#81d4fa', fontWeight: 'bold' },
  toggles: { display: 'flex', gap: 4, marginTop: 4 },
  toggleBtn: { background: 'none', border: '1px solid #444', borderRadius: 3, color: '#888', cursor: 'pointer', fontSize: 9, padding: '2px 6px', fontFamily: 'monospace' },
  seedAction: { color: '#555', fontStyle: 'italic' },
};
