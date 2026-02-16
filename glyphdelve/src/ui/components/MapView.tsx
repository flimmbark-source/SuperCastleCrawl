import React from 'react';
import type { FloorMap, NodeType } from '../../types';

interface MapViewProps {
  maps: FloorMap[];
  currentFloor: number;
  currentNodeIndex: number;
  onEnterNode: () => void;
  onShowBuildSummary: () => void;
}

const NODE_ICONS: Record<NodeType, string> = {
  combat: '⚔',
  elite: '⬟',
  shrine: '◆',
  recovery: '✚',
  event: '◌',
  boss: '☠',
};

const NODE_PATTERNS: Record<NodeType, string> = {
  combat: '////',
  elite: '▦',
  shrine: '◇◇',
  recovery: '++',
  event: '···',
  boss: 'XX',
};

const NODE_COLORS: Record<NodeType, string> = {
  combat: '#ef9a9a',
  elite: '#ffcc80',
  shrine: '#ce93d8',
  recovery: '#a5d6a7',
  event: '#90caf9',
  boss: '#f48fb1',
};

export const MapView: React.FC<MapViewProps> = ({ maps, currentFloor, currentNodeIndex, onEnterNode, onShowBuildSummary }) => {
  const currentMap = maps[currentFloor - 1];
  if (!currentMap) return null;

  return (
    <div style={styles.container}>
      <div style={styles.ambientVignette} />
      <div style={styles.gridTexture} />

      <div style={styles.headerCard}>
        <h2 style={styles.title}>Delving Route · Floor {currentFloor}</h2>
        <p style={styles.subtitle}>Turn flow: You act once, then enemies each act once.</p>
        <p style={styles.subtitleMuted}>Orthographic route planner with low-contrast stone backdrop for clarity-first tactical reading.</p>
      </div>

      <div style={styles.mapRow}>
        {currentMap.nodes.map((node, idx) => {
          const isCurrent = idx === currentNodeIndex;
          const isCompleted = node.completed;
          const isLocked = idx > currentNodeIndex;

          return (
            <React.Fragment key={node.id}>
              {idx > 0 && (
                <div
                  style={{
                    ...styles.connector,
                    background: idx <= currentNodeIndex ? 'linear-gradient(90deg, #4db6ac, #a5d6a7)' : 'linear-gradient(90deg, #2c2c3c, #35354a)',
                    opacity: isLocked ? 0.5 : 1,
                  }}
                />
              )}
              <button
                style={{
                  ...styles.node,
                  borderColor: isCurrent ? '#fff59d' : isCompleted ? '#81c784' : '#495067',
                  backgroundColor: isCompleted
                    ? 'rgba(129, 199, 132, 0.15)'
                    : isCurrent
                      ? 'rgba(255, 245, 157, 0.14)'
                      : 'rgba(24, 24, 35, 0.93)',
                  cursor: isCurrent ? 'pointer' : 'default',
                  opacity: isCompleted ? 0.75 : isLocked ? 0.6 : 1,
                  transform: isCurrent ? 'translateY(-2px) scale(1.04)' : 'scale(1)',
                  boxShadow: isCurrent ? '0 0 0 2px rgba(255,245,157,0.2), 0 10px 20px rgba(0,0,0,0.35)' : '0 6px 12px rgba(0,0,0,0.22)',
                }}
                onClick={isCurrent ? onEnterNode : undefined}
                disabled={!isCurrent}
                title={`${node.type} (${isCompleted ? 'completed' : isCurrent ? 'current' : 'locked'})`}
              >
                <span style={{ ...styles.nodeIcon, color: NODE_COLORS[node.type] }}>{NODE_ICONS[node.type]}</span>
                <span style={styles.nodeLabel}>{node.type}</span>
                <span style={styles.nodePattern}>{NODE_PATTERNS[node.type]}</span>
                <span style={styles.nodeIndex}>{idx + 1}</span>
                {isCompleted && <span style={styles.checkmark}>✓</span>}
                {isCurrent && <span style={styles.currentMarker}>▶ Enter</span>}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div style={styles.legend}>
        {Object.entries(NODE_ICONS).map(([type, icon]) => (
          <span key={type} style={styles.legendItem}>
            <span style={{ color: NODE_COLORS[type as NodeType] }}>{icon}</span>
            <span style={styles.legendType}>{type}</span>
            <span style={styles.legendPattern}>{NODE_PATTERNS[type as NodeType]}</span>
          </span>
        ))}
      </div>

      {currentMap.nodes[currentNodeIndex]?.type === 'boss' && (
        <button style={styles.summaryBtn} onClick={onShowBuildSummary}>Review Build Before Boss</button>
      )}

      <div style={styles.hint}>
        {currentMap.nodes[currentNodeIndex]?.type === 'boss'
          ? 'Boss room ahead. Verify status effects, cooldowns, and synergies before entry.'
          : 'Select the highlighted room to continue delving.'}
      </div>

      <div style={styles.accessibilityStrip}>
        <span>A11y: icon + pattern status cues</span>
        <span>Reduced motion friendly transitions</span>
        <span>Center play area intentionally clear</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'radial-gradient(circle at 50% 40%, #232337 0%, #121220 70%, #0c0c18 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    overflow: 'hidden',
  },
  ambientVignette: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at center, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.46) 75%)',
    pointerEvents: 'none',
  },
  gridTexture: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
    backgroundSize: '48px 48px',
    opacity: 0.35,
    pointerEvents: 'none',
  },
  headerCard: {
    backgroundColor: 'rgba(12,12,20,0.78)',
    border: '1px solid #3a3f53',
    borderRadius: 10,
    padding: '14px 18px',
    marginBottom: 18,
    textAlign: 'center',
  },
  title: { fontSize: 24, color: '#e0e0e0', fontFamily: 'monospace', margin: 0, letterSpacing: 1 },
  subtitle: { fontSize: 12, color: '#b0bec5', fontFamily: 'monospace', margin: '6px 0 2px' },
  subtitleMuted: { fontSize: 11, color: '#6f7b8a', fontFamily: 'monospace', margin: 0 },
  mapRow: { display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '20px 40px', maxWidth: '96vw', zIndex: 1 },
  connector: { width: 32, height: 4, borderRadius: 3, flexShrink: 0, transition: 'all 0.15s' },
  node: {
    width: 88,
    height: 88,
    border: '2px solid #444',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    position: 'relative',
    transition: 'all 0.15s',
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  nodeIcon: { fontSize: 24 },
  nodeLabel: { fontSize: 10, color: '#b0bec5', textTransform: 'capitalize', letterSpacing: 0.4 },
  nodePattern: { fontSize: 10, color: '#7f8aa6', letterSpacing: 0.5 },
  nodeIndex: { position: 'absolute', top: 4, right: 6, fontSize: 9, color: '#626d86' },
  checkmark: { position: 'absolute', top: 4, left: 6, fontSize: 11, color: '#81c784' },
  currentMarker: {
    position: 'absolute',
    bottom: 4,
    fontSize: 9,
    color: '#fff59d',
    letterSpacing: 0.5,
  },
  legend: {
    display: 'flex',
    gap: 14,
    marginTop: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90vw',
  },
  legendItem: {
    fontSize: 11,
    color: '#9ea7bd',
    fontFamily: 'monospace',
    display: 'inline-flex',
    gap: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(10,10,18,0.65)',
    border: '1px solid #31384a',
    borderRadius: 6,
    padding: '4px 8px',
  },
  legendType: { textTransform: 'capitalize' },
  legendPattern: { color: '#7f8aa6', fontSize: 10 },
  summaryBtn: { marginTop: 16, padding: '8px 20px', backgroundColor: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' },
  hint: { marginTop: 12, fontSize: 11, color: '#8a96ad', fontFamily: 'monospace', textAlign: 'center', zIndex: 1 },
  accessibilityStrip: {
    marginTop: 12,
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
    fontSize: 10,
    color: '#657189',
    fontFamily: 'monospace',
  },
};
