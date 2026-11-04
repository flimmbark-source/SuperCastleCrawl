// ============================================================
// Glyphdelve - Delve Route
//
// A branching graph, not a corridor. The route is a decision made before the
// fight: the elite pays better but costs health you may not get back, and the
// spring and the shrine are rarely on the same path.
// ============================================================

import React, { useState } from 'react';
import type { FloorMap, MapNode, NodeType } from '../../types';
import { T, panel, label } from '../theme';

interface Props {
  map: FloorMap;
  currentNodeId: string;
  availableNodeIds: string[];
  floor: number;
  onTravel: (nodeId: string) => void;
  onShowBuildSummary: () => void;
}

const ICON: Record<NodeType, string> = {
  combat: '⚔', elite: '⬟', shrine: '◆', recovery: '✚', event: '◌', boss: '☠',
};

const COLOUR: Record<NodeType, string> = {
  combat: '#ef9a9a', elite: '#ffb74d', shrine: '#ce93d8',
  recovery: '#81c784', event: '#4fc3f7', boss: '#f06292',
};

const BLURB: Record<NodeType, string> = {
  combat: 'A standard pack. Loot and experience.',
  elite: 'Tougher, armoured, hits harder — and always drops an item.',
  shrine: 'Meld two things you own into one hybrid.',
  recovery: 'Recover 35% of your health.',
  event: 'A choice: essence, vitality, or armour.',
  boss: 'The floor guardian and its escort.',
};

const CELL_W = 118;
const CELL_H = 86;
const PAD_X = 44;
const PAD_Y = 34;

export const MapView: React.FC<Props> = ({
  map, currentNodeId, availableNodeIds, floor, onTravel, onShowBuildSummary,
}) => {
  const [hover, setHover] = useState<MapNode | null>(null);

  const columns = Math.max(...map.nodes.map(n => n.column)) + 1;
  const rowsPerCol: number[] = [];
  for (let c = 0; c < columns; c++) {
    rowsPerCol[c] = map.nodes.filter(n => n.column === c).length;
  }
  const maxRows = Math.max(...rowsPerCol);

  const width = PAD_X * 2 + (columns - 1) * CELL_W + 72;
  const height = PAD_Y * 2 + (maxRows - 1) * CELL_H + 72;

  const pos = (n: MapNode) => {
    const count = rowsPerCol[n.column];
    const offset = (maxRows - count) / 2;
    return {
      x: PAD_X + n.column * CELL_W + 36,
      y: PAD_Y + (n.row + offset) * CELL_H + 36,
    };
  };

  const byId = new Map(map.nodes.map(n => [n.id, n]));

  return (
    <div style={overlay}>
      <div style={{ ...panel, padding: 18, maxWidth: '96vw', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 19, color: T.text, letterSpacing: 2 }}>
              DELVE ROUTE · FLOOR {floor}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, marginTop: 3 }}>
              Choose where to go next. Paths diverge — you cannot take every room.
            </div>
          </div>
          <button style={btn} onClick={onShowBuildSummary}>Build</button>
        </div>

        <div style={{ position: 'relative', width, height, marginTop: 14 }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            {map.nodes.flatMap(n =>
              n.connections.map(cid => {
                const to = byId.get(cid);
                if (!to) return null;
                const a = pos(n);
                const b = pos(to);
                const live = n.id === currentNodeId && availableNodeIds.includes(cid);
                return (
                  <path
                    key={`${n.id}->${cid}`}
                    d={`M ${a.x + 28} ${a.y} C ${a.x + 62} ${a.y}, ${b.x - 62} ${b.y}, ${b.x - 28} ${b.y}`}
                    fill="none"
                    stroke={live ? T.beat : n.completed ? T.lineStrong : T.line}
                    strokeWidth={live ? 2.5 : 1.5}
                    strokeDasharray={live ? undefined : '4 4'}
                    opacity={live ? 0.95 : 0.55}
                  />
                );
              }),
            )}
          </svg>

          {map.nodes.map(n => {
            const p = pos(n);
            const isCurrent = n.id === currentNodeId;
            const isAvailable = availableNodeIds.includes(n.id);
            const dim = !isCurrent && !isAvailable && !n.completed;

            return (
              <button
                key={n.id}
                onClick={() => isAvailable && onTravel(n.id)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(null)}
                disabled={!isAvailable}
                aria-label={`${n.type} room${isAvailable ? ', available' : ''}`}
                style={{
                  position: 'absolute',
                  left: p.x - 32, top: p.y - 30,
                  width: 64, height: 60,
                  background: isAvailable ? 'rgba(255,213,79,0.09)'
                    : n.completed ? 'rgba(255,255,255,0.03)' : T.surface,
                  border: `2px solid ${isAvailable ? T.beat : isCurrent ? T.lineStrong : T.line}`,
                  borderRadius: 8,
                  cursor: isAvailable ? 'pointer' : 'default',
                  opacity: dim ? 0.42 : 1,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  fontFamily: T.mono,
                  transition: 'opacity 150ms, border-color 150ms',
                }}
              >
                <span style={{ fontSize: 17, color: COLOUR[n.type] }}>{ICON[n.type]}</span>
                <span style={{ fontSize: 9, color: dim ? T.textFaint : T.textMuted, letterSpacing: 0.5 }}>
                  {n.type}
                </span>
                {n.completed && <span style={{ fontSize: 8, color: T.good }}>cleared</span>}
                {isAvailable && <span style={{ fontSize: 8, color: T.beat }}>▶ enter</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {(Object.keys(ICON) as NodeType[]).map(t => (
            <span key={t} style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>
              <span style={{ color: COLOUR[t] }}>{ICON[t]}</span> {t}
            </span>
          ))}
        </div>

        <div style={{ ...hoverBox, visibility: hover ? 'visible' : 'hidden' }}>
          <span style={{ color: hover ? COLOUR[hover.type] : T.text }}>
            {hover ? ICON[hover.type] : ''} {hover?.type}
          </span>
          <span style={{ color: T.textMuted }}>{hover ? BLURB[hover.type] : ''}</span>
        </div>

        <div style={{ ...label, marginTop: 6 }}>
          {availableNodeIds.length === 1 && availableNodeIds[0] === currentNodeId
            ? 'Enter this room to begin'
            : availableNodeIds.length > 1
              ? `${availableNodeIds.length} routes open — pick one`
              : 'One way forward'}
        </div>
      </div>
    </div>
  );
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(7,9,14,0.92)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
};

const btn: React.CSSProperties = {
  padding: '7px 16px', background: T.surfaceRaised, color: T.text,
  border: `1px solid ${T.lineStrong}`, borderRadius: T.radius,
  fontFamily: T.mono, fontSize: 12, cursor: 'pointer',
};

const hoverBox: React.CSSProperties = {
  marginTop: 10, display: 'flex', gap: 10, alignItems: 'baseline',
  fontFamily: T.mono, fontSize: 11, minHeight: 16,
};
