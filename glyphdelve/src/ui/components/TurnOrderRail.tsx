// ============================================================
// Glyphdelve - Turn Order Rail
//
// Who acts next, and in how many Beats. Without this, an action's Beat cost
// is just a number; with it the player can read "this costs 4 and the imp
// acts in 2" and make the trade knowingly.
// ============================================================

import React from 'react';
import type { TurnOrderEntry } from '../../engine/Game';
import { T, S, FONT, panel, barTrack, bar, label, num, EASE } from '../theme';

interface Props {
  entries: TurnOrderEntry[];
  /** Beats the hovered action would spend, to shade what it would unlock. */
  pendingCost: number | null;
  pressure: number;
  beatsToPressure: number;
}

const PRESSURE_WINDOW = 18;

const TurnOrderRailInner: React.FC<Props> = ({
  entries, pendingCost, pressure, beatsToPressure,
}) => (
  <div style={wrap}>
    <div style={{ ...label, marginBottom: S.sm }}>Acting next</div>

    {entries.length === 0 && (
      <div style={{ color: T.textFaint, fontSize: T.size.small }}>Nothing left standing.</div>
    )}

    {entries.map(e => {
      const willAct = pendingCost != null && e.inBeats <= pendingCost;
      const imminent = e.inBeats === 0;
      return (
        <div
          key={e.id}
          style={{
            ...row,
            borderColor: willAct ? 'rgba(255,207,77,0.55)' : 'transparent',
            background: willAct ? 'rgba(255,207,77,0.08)' : 'transparent',
          }}
        >
          <div style={{
            ...beatPill,
            color: imminent ? T.threat : T.beat,
            borderColor: imminent ? 'rgba(242,84,91,0.6)' : 'rgba(255,207,77,0.32)',
            background: imminent ? 'rgba(242,84,91,0.12)' : 'rgba(255,207,77,0.07)',
          }}>
            {e.inBeats}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={name}>{e.name}</span>
              {e.rank !== 'normal' && (
                <span style={{
                  ...label, fontSize: 7.5, flexShrink: 0,
                  color: e.rank === 'boss' ? T.essence : T.bear,
                }}>
                  {e.rank}
                </span>
              )}
            </div>
            <div style={{
              fontSize: T.size.tiny,
              color: e.dangerous ? T.threat : T.textMuted,
              fontWeight: e.dangerous ? 600 : 400,
              marginTop: 1,
            }}>
              {e.dangerous ? '\u25A0 ' : '\u203A '}{e.intentLabel}
            </div>
            <div style={{ ...barTrack, marginTop: S.xs, height: 4 }}>
              <div style={bar(e.hp / e.maxHp, e.hp / e.maxHp < 0.35 ? T.threat : '#e8827f', 4)} />
            </div>
          </div>
        </div>
      );
    })}

    <div style={pressureBox}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={label}>Delve Pressure</span>
        <span style={{
          ...num, fontSize: T.size.body, fontWeight: 700,
          color: pressure > 0 ? T.threat : T.textFaint,
        }}>
          {pressure > 0 ? `+${pressure}` : '—'}
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: S.xs, height: 4 }}>
        <div style={{
          ...bar(Math.max(0, Math.min(1, 1 - beatsToPressure / PRESSURE_WINDOW)),
            pressure > 0 ? T.threat : T.warn, 4),
          transition: `width 300ms ${EASE}`,
        }} />
      </div>
      <div style={{ fontSize: T.size.micro, color: T.textFaint, marginTop: S.xs, lineHeight: 1.5 }}>
        {pressure > 0
          ? <>Enemies hit for <span style={{ ...num, color: T.threat }}>+{pressure}</span>. A kill resets it.</>
          : <><span style={num}>{beatsToPressure}</span> Beats before the delve presses in.</>}
      </div>
    </div>
  </div>
);

const wrap: React.CSSProperties = {
  ...panel,
  position: 'absolute', top: S.md, right: S.md,
  width: 212, padding: `${S.md}px ${S.md}px ${S.sm + 2}px`,
  zIndex: 18,
};

const row: React.CSSProperties = {
  display: 'flex', gap: S.sm + 2, alignItems: 'center',
  padding: `${S.xs + 1}px ${S.xs + 2}px`, marginBottom: 3,
  border: '1px solid transparent', borderRadius: 5,
  transition: `background 180ms ${EASE}, border-color 180ms ${EASE}`,
};

const beatPill: React.CSSProperties = {
  ...num,
  minWidth: 24, height: 24, borderRadius: 12,
  border: '1px solid rgba(255,207,77,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: T.size.small, fontWeight: 700, flexShrink: 0,
};

const name: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.small, fontWeight: 500, color: T.text,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

const pressureBox: React.CSSProperties = {
  marginTop: S.sm + 2, paddingTop: S.sm + 2, borderTop: `1px solid ${T.line}`,
};

/** Memoised: these panels re-render only when their own props change. */
export const TurnOrderRail = React.memo(TurnOrderRailInner);
