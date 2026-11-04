// ============================================================
// Glyphdelve - Tile Inspector
//
// Hovering anything explains it. Progressive disclosure: the board carries the
// essentials (threat numbers, step costs) and detail is one hover away, so
// nothing has to be memorised from a manual.
// ============================================================

import React from 'react';
import { T, S, FONT, panel, label } from '../theme';

interface Props {
  info: { title: string; lines: string[] } | null;
}

export const TileInspector: React.FC<Props> = ({ info }) => {
  if (!info) {
    return (
      <div style={wrap}>
        <div style={label}>Inspect</div>
        <div style={{
          color: T.textFaint, fontSize: T.size.small,
          marginTop: S.xs, fontFamily: FONT.ui,
        }}>
          Point at a tile to read it.
        </div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={label}>Inspect</div>
      <div style={{
        fontFamily: FONT.ui, fontSize: T.size.lead, fontWeight: 600,
        color: T.text, marginTop: 3, letterSpacing: 0.2,
      }}>
        {info.title}
      </div>
      {info.lines.map((l, i) => (
        <div
          key={i}
          style={{
            fontFamily: /\d/.test(l) ? FONT.num : FONT.ui,
            fontSize: T.size.small, marginTop: S.xs, lineHeight: 1.5,
            fontWeight: l.startsWith('Incoming') ? 600 : 400,
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
  ...panel, position: 'absolute', bottom: S.md, left: S.md,
  width: 226, padding: `${S.md - 2}px ${S.md}px`, zIndex: 18,
};
