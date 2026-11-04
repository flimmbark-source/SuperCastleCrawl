import React from 'react';
import type { PlayerEntity, RunState } from '../../types';
import { T, S, FONT, panel, barTrack, bar, label, num } from '../theme';

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
  const low = hpFrac < 0.3;

  return (
    <div style={wrap}>
      {/* Vitality is the loudest thing in the panel, by design. */}
      <div style={rowBetween}>
        <span style={label}>Vitality</span>
        <span style={{ ...num, fontSize: T.size.lead, fontWeight: 700, color: low ? T.threat : T.text }}>
          {hp}
          <span style={{ color: T.textFaint, fontWeight: 400 }}>/{maxHp}</span>
          {shield > 0 && (
            <span style={{ color: T.info, fontWeight: 700 }}> +{Math.round(shield)}</span>
          )}
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: S.xs, height: 10 }}>
        <div style={bar(hpFrac, low ? T.threat : T.good, 10)} />
      </div>

      <div style={{ ...rowBetween, marginTop: S.md }}>
        <span style={label}>Level {player.level}</span>
        <span style={{ ...num, fontSize: T.size.small, color: T.textMuted }}>
          {player.xp}<span style={{ color: T.textFaint }}>/{player.xpToNext}</span>
        </span>
      </div>
      <div style={{ ...barTrack, marginTop: S.xs, height: 5 }}>
        <div style={bar(xpFrac, T.info, 5)} />
      </div>

      <div style={stats}>
        <Stat name="Essence" value={player.essence} colour={T.essence} />
        <Stat name="Floor" value={state.floor} colour={T.textMuted} />
        <Stat name="Slain" value={state.killCount} colour={T.textMuted} />
        {player.armor > 0 && <Stat name="Armour" value={player.armor} colour={T.info} />}
      </div>

      {(beats != null || layoutName) && (
        <div style={footer}>
          {layoutName && (
            <div style={{ fontFamily: FONT.ui, fontSize: T.size.small, color: T.text, fontWeight: 500 }}>
              {layoutName}
            </div>
          )}
          {beats != null && (
            <div style={{ fontSize: T.size.micro, color: T.textFaint, marginTop: 3 }}>
              <span style={num}>{beats}</span> Beats elapsed here
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ name: string; value: number; colour: string }> = ({
  name, value, colour,
}) => (
  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
    <span style={{ ...label, fontSize: 8, letterSpacing: 1.1 }}>{name}</span>
    <span style={{ ...num, color: colour, fontSize: T.size.body, fontWeight: 600 }}>{value}</span>
  </span>
);

const wrap: React.CSSProperties = {
  ...panel,
  position: 'absolute', top: S.md, left: S.md,
  width: 198, padding: `${S.md}px ${S.md}px ${S.sm + 2}px`,
  zIndex: 18,
};

const rowBetween: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
};

const stats: React.CSSProperties = {
  display: 'flex', gap: S.md, marginTop: S.md, flexWrap: 'wrap',
};

const footer: React.CSSProperties = {
  marginTop: S.sm + 2, paddingTop: S.sm, borderTop: `1px solid ${T.line}`,
};
