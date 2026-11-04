// ============================================================
// Glyphdelve - Turn Order Rail
//
// Who acts next, and in how many Beats. Without this the Beat cost of an
// action is just a number; with it, the player can read "this costs 4 Beats
// and the imp acts in 2" and make an informed trade.
// ============================================================

import React from 'react';
import type { TurnOrderEntry } from '../../engine/Game';
import { T, panel, barTrack, bar, label } from '../theme';

interface Props {
  entries: TurnOrderEntry[];
  /** Beats the pending/hovered action would spend, to shade what it unlocks. */
  pendingCost: number | null;
  pressure: number;
  beatsToPressure: number;
}

export const TurnOrderRail: React.FC<Props> = ({
  entries, pendingCost, pressure, beatsToPressure,
}) => (
  <div style={wrap}>
    <div style={{ ...label, marginBottom: 6 }}>Acting next</div>

    {entries.length === 0 && (
      <div style={{ color: T.textFaint, fontSize: 11 }}>Nothing left standing.</div>
    )}

    {entries.map(e => {
      // Highlight everything the pending action would let act.
      const willAct = pendingCost != null && e.inBeats <= pendingCost;
      return (
        <div
          key={e.id}
          style={{
            ...row,
            borderColor: willAct ? T.beat : 'transparent',
            background: willAct ? 'rgba(255,213,79,0.08)' : 'transparent',
          }}
        >
          <div style={{
            ...beatPill,
            color: e.inBeats === 0 ? T.threat : T.beat,
            borderColor: e.inBeats === 0 ? T.threat : 'rgba(255,213,79,0.35)',
          }}>
            {e.inBeats}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, color: T.text, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {e.name}
            </div>
            <div style={{
              fontSize: 10,
              color: e.dangerous ? T.threat : T.textMuted,
            }}>
              {e.dangerous ? '⚔ ' : '› '}{e.intentLabel}
            </div>
            <div style={{ ...barTrack, marginTop: 3, height: 4 }}>
              <div style={bar(e.hp / e.maxHp, e.hp / e.maxHp < 0.35 ? T.threat : '#ef9a9a', 4)} />
            </div>
          </div>
        </div>
      );
    })}

    <div style={pressureBox}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={label}>Delve Pressure</span>
        <span style={{
          fontSize: 12, fontFamily: T.mono, fontWeight: 700,
          color: pressure > 0 ? T.threat : T.textFaint,
        }}>
          {pressure > 0 ? `+${pressure} dmg` : 'calm'}
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: 4, height: 4 }}>
        <div style={bar(Math.max(0, Math.min(1, 1 - beatsToPressure / 18)), pressure > 0 ? T.threat : T.warn, 4)} />
      </div>
      <div style={{ fontSize: 9, color: T.textFaint, marginTop: 3 }}>
        {beatsToPressure} Beats until the delve presses in. Killing something resets it.
      </div>
    </div>
  </div>
);

const wrap: React.CSSProperties = {
  ...panel, position: 'absolute', top: 12, right: 12,
  width: 206, padding: '10px 10px 8px', zIndex: 18,
};

const row: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: '4px 5px', marginBottom: 3,
  border: '1px solid transparent', borderRadius: 5,
};

const beatPill: React.CSSProperties = {
  minWidth: 22, height: 22, borderRadius: 11,
  border: '1px solid rgba(255,213,79,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: T.mono, fontSize: 11, fontWeight: 700, flexShrink: 0,
};

const pressureBox: React.CSSProperties = {
  marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.line}`,
};
