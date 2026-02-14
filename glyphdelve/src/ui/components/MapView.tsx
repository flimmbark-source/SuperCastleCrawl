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
  combat: '⚔', elite: '★', shrine: '◆', recovery: '♥', event: '?', boss: '☠',
};
const NODE_COLORS: Record<NodeType, string> = {
  combat: '#ef5350', elite: '#ff9800', shrine: '#ab47bc', recovery: '#4caf50', event: '#42a5f5', boss: '#e040fb',
};

export const MapView: React.FC<MapViewProps> = ({ maps, currentFloor, currentNodeIndex, onEnterNode, onShowBuildSummary }) => {
  const currentMap = maps[currentFloor - 1];
  if (!currentMap) return null;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Dungeon Map — Floor {currentFloor}</h2>
      <p style={styles.subtitle}>Navigate through rooms to reach the boss</p>

      <div style={styles.mapRow}>
        {currentMap.nodes.map((node, idx) => {
          const isCurrent = idx === currentNodeIndex;
          const isCompleted = node.completed;

          return (
            <React.Fragment key={node.id}>
              {idx > 0 && (
                <div style={{
                  ...styles.connector,
                  backgroundColor: idx <= currentNodeIndex ? '#4caf50' : '#333',
                }} />
              )}
              <button
                style={{
                  ...styles.node,
                  borderColor: isCurrent ? '#ffd54f' : isCompleted ? '#4caf50' : '#444',
                  backgroundColor: isCompleted ? 'rgba(76,175,80,0.15)' : isCurrent ? 'rgba(255,213,79,0.15)' : 'rgba(26,26,46,0.9)',
                  cursor: isCurrent ? 'pointer' : 'default',
                  opacity: isCompleted ? 0.6 : 1,
                  transform: isCurrent ? 'scale(1.1)' : 'scale(1)',
                }}
                onClick={isCurrent ? onEnterNode : undefined}
                disabled={!isCurrent}
                title={`${node.type} (${isCompleted ? 'completed' : isCurrent ? 'current' : 'locked'})`}
              >
                <span style={{ ...styles.nodeIcon, color: NODE_COLORS[node.type] }}>{NODE_ICONS[node.type]}</span>
                <span style={styles.nodeLabel}>{node.type}</span>
                <span style={styles.nodeIndex}>{idx + 1}</span>
                {isCompleted && <span style={styles.checkmark}>✓</span>}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div style={styles.legend}>
        {Object.entries(NODE_ICONS).map(([type, icon]) => (
          <span key={type} style={styles.legendItem}>
            <span style={{ color: NODE_COLORS[type as NodeType] }}>{icon}</span> {type}
          </span>
        ))}
      </div>

      {currentMap.nodes[currentNodeIndex]?.type === 'boss' && (
        <button style={styles.summaryBtn} onClick={onShowBuildSummary}>View Build Summary</button>
      )}

      <div style={styles.hint}>
        {currentMap.nodes[currentNodeIndex]?.type === 'boss'
          ? 'Boss room ahead! Make sure your build is ready.'
          : 'Click the current node to enter.'}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0d0d1a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  title: { fontSize: 24, color: '#e0e0e0', fontFamily: 'monospace', margin: '0 0 4px' },
  subtitle: { fontSize: 12, color: '#666', fontFamily: 'monospace', margin: '0 0 24px' },
  mapRow: { display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '20px 40px', maxWidth: '95vw' },
  connector: { width: 24, height: 3, borderRadius: 2, flexShrink: 0 },
  node: { width: 72, height: 72, border: '2px solid #444', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative', transition: 'all 0.15s', flexShrink: 0, background: 'none', fontFamily: 'monospace' },
  nodeIcon: { fontSize: 20 },
  nodeLabel: { fontSize: 9, color: '#888', textTransform: 'capitalize' },
  nodeIndex: { position: 'absolute', top: 2, right: 4, fontSize: 8, color: '#555' },
  checkmark: { position: 'absolute', top: 2, left: 4, fontSize: 10, color: '#4caf50' },
  legend: { display: 'flex', gap: 16, marginTop: 20 },
  legendItem: { fontSize: 11, color: '#888', fontFamily: 'monospace', display: 'flex', gap: 4, alignItems: 'center' },
  summaryBtn: { marginTop: 16, padding: '8px 20px', backgroundColor: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' },
  hint: { marginTop: 12, fontSize: 11, color: '#555', fontFamily: 'monospace' },
};
