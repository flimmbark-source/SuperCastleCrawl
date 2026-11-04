import React from 'react';
import type { PlayerEntity, RunState } from '../../types';
import { T, panel, barTrack, bar, label } from '../theme';

interface Props {
  player: PlayerEntity;
  state: RunState;
  /** Live room HP, which differs from meta HP while in Bear Form. */
  roomHp?: number;
  roomMaxHp?: number;
  shield?: number;
  beats?: number;
  layoutName?: string;
}

export const HUD: React.FC<Props> = ({
  player, state, roomHp, roomMaxHp, shield = 0, beats, layoutName,
}) => {
  const hp = Math.ceil(roomHp ?? player.hp);
  const maxHp = roomMaxHp ?? player.maxHp;
  const hpFrac = maxHp > 0 ? hp / maxHp : 0;
  const xpFrac = player.xpToNext > 0 ? player.xp / player.xpToNext : 0;

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={label}>Vitality</span>
        <span style={{ fontFamily: T.mono, fontSize: 13, color: hpFrac < 0.3 ? T.threat : T.text }}>
          {hp}<span style={{ color: T.textFaint }}>/{maxHp}</span>
          {shield > 0 && <span style={{ color: T.info }}> +{Math.round(shield)}</span>}
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: 3, height: 9 }}>
        <div style={bar(hpFrac, hpFrac < 0.3 ? T.threat : T.good, 9)} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 9 }}>
        <span style={label}>Level {player.level}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
          {player.xp}/{player.xpToNext} xp
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: 3, height: 5 }}>
        <div style={bar(xpFrac, T.info, 5)} />
      </div>

      <div style={statRow}>
        <span style={{ color: T.essence }}>◆ {player.essence}</span>
        <span style={{ color: T.textMuted }}>Floor {state.floor}</span>
        <span style={{ color: T.textMuted }}>☠ {state.killCount}</span>
        {player.armor > 0 && <span style={{ color: T.info }}>⛊ {player.armor}</span>}
      </div>

      {(beats != null || layoutName) && (
        <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${T.line}` }}>
          {layoutName && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.text }}>{layoutName}</div>
          )}
          {beats != null && (
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textFaint, marginTop: 2 }}>
              {beats} Beats elapsed in this room
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = {
  ...panel, position: 'absolute', top: 12, left: 12,
  width: 196, padding: '10px 11px', zIndex: 18,
};

const statRow: React.CSSProperties = {
  display: 'flex', gap: 10, marginTop: 9, flexWrap: 'wrap',
  fontFamily: T.mono, fontSize: 11,
};
