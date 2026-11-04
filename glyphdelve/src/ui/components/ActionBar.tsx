// ============================================================
// Glyphdelve - Action Bar
//
// The primary interface. Every action shows its Beat cost before it is taken,
// because the whole game is the question "can I afford this right now?".
// ============================================================

import React, { useState } from 'react';
import type { PlayerActionOption } from '../../core/model';
import { T, panel, beatChip } from '../theme';

interface Props {
  actions: PlayerActionOption[];
  selectedId: string | null;
  form: 'caster' | 'bear';
  /** Beats until Delve Pressure rises, so the cost of stalling is visible. */
  onAction: (a: PlayerActionOption) => void;
}

const HOTKEY: Record<string, string> = {
  wait: 'Space',
  attack: 'Click',
};

export const ActionBar: React.FC<Props> = ({ actions, selectedId, form, onAction }) => {
  const [hovered, setHovered] = useState<PlayerActionOption | null>(null);
  let skillIndex = 0;

  return (
    <div style={wrap}>
      {hovered && (
        <div style={tooltip}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <strong style={{ color: T.text, fontSize: 13 }}>{hovered.label}</strong>
            <span style={beatChip(hovered.cost)}>{hovered.cost} Beats</span>
          </div>
          {hovered.description && (
            <div style={{ color: T.textMuted, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              {hovered.description}
            </div>
          )}
          {hovered.tags && hovered.tags.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {hovered.tags.map(t => <span key={t} style={tagChip}>{t}</span>)}
            </div>
          )}
          {hovered.disabledReason && (
            <div style={{ color: T.threat, fontSize: 11, marginTop: 6 }}>{hovered.disabledReason}</div>
          )}
          <div style={{ color: T.textFaint, fontSize: 10, marginTop: 6 }}>
            Spending {hovered.cost} Beats gives every enemy that much time to act.
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

          return (
            <button
              key={a.id}
              onClick={() => !disabled && onAction(a)}
              onMouseEnter={() => setHovered(a)}
              onMouseLeave={() => setHovered(null)}
              disabled={disabled}
              aria-label={`${a.label}, ${a.cost} beats${disabled ? `, unavailable: ${a.disabledReason}` : ''}`}
              style={{
                ...card,
                opacity: disabled ? 0.42 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                borderColor: selected ? T.beat : disabled ? T.line : T.lineStrong,
                boxShadow: selected ? `0 0 0 1px ${T.beat}` : 'none',
                background: selected ? 'rgba(255,213,79,0.1)' : T.surfaceRaised,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: T.textFaint, letterSpacing: 1 }}>{hotkey}</span>
                <span style={beatChip(a.cost, disabled)}>{a.cost}</span>
              </div>
              <div style={{
                fontSize: 12, color: disabled ? T.textFaint : T.text,
                marginTop: 4, fontWeight: 600, lineHeight: 1.2,
              }}>
                {a.label}
              </div>
              {a.cooldownBeats != null && a.cooldownBeats > 0 && (
                <div style={{ fontSize: 9, color: T.threat, marginTop: 2 }}>
                  {a.cooldownBeats} Beats
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={hint}>
        <span style={{ color: form === 'bear' ? T.bear : T.info }}>
          {form === 'bear' ? '◆ Bear Form' : '◆ Caster Form'}
        </span>
        <span style={{ color: T.textFaint }}>
          WASD/QEZC move · click to move or strike · Space waits · Tab toggles step hints
        </span>
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = {
  position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 20,
};

const row: React.CSSProperties = { display: 'flex', gap: 6 };

const card: React.CSSProperties = {
  width: 104, minHeight: 62, padding: '6px 8px',
  border: `1px solid ${T.lineStrong}`, borderRadius: T.radius,
  color: T.text, fontFamily: T.mono, textAlign: 'left',
  transition: 'background 120ms, border-color 120ms',
};

const tooltip: React.CSSProperties = {
  ...panel, padding: '10px 12px', maxWidth: 380, marginBottom: 2,
};

const tagChip: React.CSSProperties = {
  fontSize: 9, color: T.textMuted, background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${T.line}`, borderRadius: 3, padding: '1px 4px',
};

const hint: React.CSSProperties = {
  display: 'flex', gap: 14, alignItems: 'center',
  fontFamily: T.mono, fontSize: 10,
};
