// ============================================================
// Glyphdelve - Tile Inspector
//
// Hovering anything explains it. Progressive disclosure: the board carries the
// essentials (threat numbers, step costs) and detail is one hover away, so
// nothing has to be memorised from a manual.
// ============================================================

import React from 'react';
import { T, panel, label } from '../theme';

interface Props {
  info: { title: string; lines: string[] } | null;
}

export const TileInspector: React.FC<Props> = ({ info }) => {
  if (!info) {
    return (
      <div style={wrap}>
        <div style={label}>Inspect</div>
        <div style={{ color: T.textFaint, fontSize: 11, marginTop: 4 }}>
          Point at a tile to read it.
        </div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={label}>Inspect</div>
      <div style={{ fontFamily: T.mono, fontSize: 13, color: T.text, marginTop: 3 }}>
        {info.title}
      </div>
      {info.lines.map((l, i) => (
        <div
          key={i}
          style={{
            fontFamily: T.mono, fontSize: 10.5, marginTop: 3, lineHeight: 1.45,
            color: l.startsWith('Incoming') ? T.threat
              : l.startsWith('Step here') ? T.beat
              : T.textMuted,
          }}
        >
          {l}
        </div>
      ))}
    </div>
  );
};

const wrap: React.CSSProperties = {
  ...panel, position: 'absolute', bottom: 12, left: 12,
  width: 220, padding: '9px 11px', zIndex: 18,
};
