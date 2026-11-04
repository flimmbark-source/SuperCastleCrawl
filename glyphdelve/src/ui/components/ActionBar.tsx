// ============================================================
// Glyphdelve - Action Bar
//
// The primary interface. Every action states its Beat cost before it is
// taken, because the whole game is the question "can I afford this?".
// ============================================================

import React, { useState } from 'react';
import type { PlayerActionOption } from '../../core/model';
import { T, S, FONT, panel, beatChip, num, label, EASE } from '../theme';

interface Props {
  actions: PlayerActionOption[];
  selectedId: string | null;
  form: 'caster' | 'bear';
  onAction: (a: PlayerActionOption) => void;
}

const HOTKEY: Record<string, string> = {
  wait: 'SPC',
  attack: 'CLK',
};

const ActionBarInner: React.FC<Props> = ({ actions, selectedId, form, onAction }) => {
  const [hovered, setHovered] = useState<PlayerActionOption | null>(null);
  const [focusRing, setFocusRing] = useState<string | null>(null);
  let skillIndex = 0;

  return (
    <div style={wrap}>
      {hovered && (
        <div style={tooltip} role="tooltip">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.md, alignItems: 'center' }}>
            <strong style={{ fontSize: T.size.lead, fontWeight: 700, letterSpacing: 0.2 }}>
              {hovered.label}
            </strong>
            <span style={beatChip(hovered.cost)}>{hovered.cost} Beats</span>
          </div>

          {hovered.description && (
            <p style={{ color: T.textMuted, fontSize: T.size.body, marginTop: S.sm, lineHeight: 1.55 }}>
              {hovered.description}
            </p>
          )}

          {hovered.tags && hovered.tags.length > 0 && (
            <div style={{ marginTop: S.sm, display: 'flex', gap: S.xs, flexWrap: 'wrap' }}>
              {hovered.tags.map(t => <span key={t} style={tagChip}>{t}</span>)}
            </div>
          )}

          {hovered.disabledReason && (
            <div style={{ color: T.threat, fontSize: T.size.small, marginTop: S.sm, fontWeight: 500 }}>
              {hovered.disabledReason}
            </div>
          )}

          <div style={costNote}>
            Spending <span style={{ ...num, color: T.beat, fontWeight: 700 }}>{hovered.cost}</span>
            {' '}Beats hands every enemy that much time to act.
          </div>
        </div>
      )}

      <div style={row}>
        {actions.map(a => {
          const isSkill = a.kind === 'skill';
          if (isSkill) skillIndex++;
          const hotkey = HOTKEY[a.id] ?? (isSkill ? `${skillIndex}` : '');
          const disabled = Boolean(a.disabledReason);
          const selected = selectedId === a.id;
          const hot = hovered?.id === a.id || focusRing === a.id;

          return (
            <button
              key={a.id}
              onClick={() => !disabled && onAction(a)}
              onMouseEnter={() => setHovered(a)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => { setHovered(a); setFocusRing(a.id); }}
              onBlur={() => { setHovered(null); setFocusRing(null); }}
              disabled={disabled}
              aria-label={`${a.label}, ${a.cost} beats${disabled ? `, unavailable: ${a.disabledReason}` : ''}`}
              style={{
                ...card,
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                borderColor: selected ? T.beat : hot && !disabled ? T.lineStrong : T.line,
                background: selected
                  ? 'linear-gradient(180deg, rgba(255,207,77,0.16) 0%, rgba(255,207,77,0.06) 100%)'
                  : hot && !disabled
                    ? 'linear-gradient(180deg, rgba(42,53,74,0.98) 0%, rgba(27,34,49,0.98) 100%)'
                    : 'linear-gradient(180deg, rgba(31,39,56,0.95) 0%, rgba(21,27,39,0.95) 100%)',
                transform: hot && !disabled ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: selected ? `0 0 0 1px ${T.beat}, ${T.shadowMd}`
                  : hot && !disabled ? T.shadowMd : T.shadowSm,
              }}
            >
              <div style={cardTop}>
                <span style={{ ...label, fontSize: T.size.micro, letterSpacing: 1 }}>{hotkey}</span>
                <span style={beatChip(a.cost, disabled)}>{a.cost}</span>
              </div>
              <div style={{
                fontFamily: FONT.ui,
                fontSize: T.size.body,
                color: disabled ? T.textFaint : T.text,
                marginTop: S.xs + 1,
                fontWeight: 600,
                lineHeight: 1.2,
              }}>
                {a.label}
              </div>
              {a.cooldownBeats != null && a.cooldownBeats > 0 && (
                <div style={{ ...num, fontSize: T.size.micro, color: T.threat, marginTop: 2 }}>
                  {a.cooldownBeats} Beats
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={hint}>
        <span style={{
          color: form === 'bear' ? T.bear : T.info,
          fontWeight: 600, fontSize: T.size.small,
        }}>
          ◆ {form === 'bear' ? 'Bear Form' : 'Caster Form'}
        </span>
        <span style={{ color: T.textFaint, fontSize: T.size.tiny }}>
          WASD/QEZC step · click to move or strike · Space waits · 1-9 skills (press twice to aim) · Tab hints
        </span>
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = {
  position: 'absolute', bottom: S.md, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: S.sm,
  zIndex: 20, pointerEvents: 'none',
};

const row: React.CSSProperties = { display: 'flex', gap: S.sm - 2, pointerEvents: 'auto' };

const card: React.CSSProperties = {
  width: 110, minHeight: 66, padding: `${S.sm - 1}px ${S.sm + 2}px`,
  border: `1px solid ${T.line}`, borderRadius: T.radius,
  color: T.text, textAlign: 'left',
  transition: `transform 160ms ${EASE}, box-shadow 160ms ${EASE}, border-color 160ms ${EASE}, background 160ms ${EASE}`,
};

const cardTop: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.sm,
};

const tooltip: React.CSSProperties = {
  ...panel,
  padding: `${S.md}px ${S.lg - 2}px`,
  maxWidth: 400, marginBottom: 2,
  boxShadow: T.shadowLg,
  pointerEvents: 'none',
};

const tagChip: React.CSSProperties = {
  fontFamily: FONT.ui,
  fontSize: T.size.micro, color: T.textMuted,
  background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${T.line}`, borderRadius: 3,
  padding: '2px 6px', letterSpacing: 0.4,
};

const costNote: React.CSSProperties = {
  marginTop: S.sm + 2, paddingTop: S.sm, borderTop: `1px solid ${T.line}`,
  color: T.textFaint, fontSize: T.size.tiny, lineHeight: 1.5,
};

const hint: React.CSSProperties = {
  display: 'flex', gap: S.lg, alignItems: 'center',
  fontFamily: FONT.ui, pointerEvents: 'none',
};

/** Memoised: these panels re-render only when their own props change. */
export const ActionBar = React.memo(ActionBarInner);
