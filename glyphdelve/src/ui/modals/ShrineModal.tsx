// ============================================================
// Glyphdelve - Shrine of Melding
//
// Fuse two things you own into one hybrid that inherits from both and gains
// something neither had. It is the most distinctive idea in the game, so the
// screen's job is to make the trade legible: what goes in, what comes out,
// and what it costs — all before you commit.
// ============================================================

import React, { useMemo, useState } from 'react';
import type { RunState, MeldType } from '../../types';
import { MELD_COSTS } from '../../types';
import { getMeldableItems, previewMeld, executeMeld } from '../../systems/ShrineMeldSystem';
import type { MeldInput, MeldPreview } from '../../systems/ShrineMeldSystem';
import { T, S, FONT, panel, label, num, EASE } from '../theme';

interface Props {
  state: RunState;
  onComplete: () => void;
  onStateChange: () => void;
}

const TAB_LABEL: Record<MeldType, string> = {
  skill_skill: 'Skills',
  passive_passive: 'Passives',
  item_item: 'Items',
};

export const ShrineModal: React.FC<Props> = ({ state, onComplete, onStateChange }) => {
  const [meldType, setMeldType] = useState<MeldType>('skill_skill');
  const [picked, setPicked] = useState<MeldInput[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const pool = useMemo(() => getMeldableItems(state, meldType), [state, meldType]);
  const cost = MELD_COSTS[meldType];
  const essence = state.player.essence;

  const preview: MeldPreview | null = picked.length === 2
    ? previewMeld(state, picked[0], picked[1], meldType)
    : null;

  const reset = (t?: MeldType) => {
    if (t) setMeldType(t);
    setPicked([]);
  };

  const toggle = (item: MeldInput) => {
    setFlash(null);
    setPicked(cur => {
      if (cur.some(c => c.id === item.id)) return cur.filter(c => c.id !== item.id);
      if (cur.length >= 2) return [cur[1], item];
      return [...cur, item];
    });
  };

  const commit = () => {
    if (!preview?.possible) return;
    if (executeMeld(state, picked[0], picked[1], meldType, preview)) {
      setFlash(`${preview.outputName} takes shape.`);
      setPicked([]);
      onStateChange();
    } else {
      setFlash('The shrine rejects the offering.');
    }
  };

  return (
    <div style={overlay} role="dialog" aria-label="Shrine of Melding">
      <div style={{ ...panel, padding: S.xl, width: 920, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: S.xl }}>
          <div>
            <div style={{ ...label, color: T.essence }}>Shrine of Melding</div>
            <h2 style={title}>Fuse two into one</h2>
            <p style={subtitle}>
              The hybrid inherits from both parents and gains one trait neither had.
              Both originals are consumed.
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={label}>Essence</div>
            <div style={{ ...num, fontSize: T.size.h2, fontWeight: 700, color: T.essence }}>
              {essence}
            </div>
          </div>
        </div>

        <div style={tabs}>
          {(Object.keys(TAB_LABEL) as MeldType[]).map(t => {
            const active = meldType === t;
            const affordable = essence >= MELD_COSTS[t];
            return (
              <button
                key={t}
                onClick={() => reset(t)}
                style={{
                  ...tab,
                  background: active ? 'rgba(197,138,249,0.14)' : 'transparent',
                  borderColor: active ? T.essence : T.line,
                  color: active ? T.text : T.textMuted,
                }}
              >
                {TAB_LABEL[t]}
                <span style={{ ...num, color: affordable ? T.essence : T.threat, marginLeft: 6 }}>
                  {MELD_COSTS[t]}◆
                </span>
              </button>
            );
          })}
        </div>

        <div style={grid}>
          <div>
            <div style={{ ...label, marginBottom: S.sm }}>
              Choose two ({picked.length}/2)
            </div>
            {pool.length < 2 && (
              <div style={emptyNote}>
                You need two different {TAB_LABEL[meldType].toLowerCase()} before you can meld.
              </div>
            )}
            <div style={list}>
              {pool.map(item => {
                const idx = picked.findIndex(c => c.id === item.id);
                const on = idx >= 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => toggle(item)}
                    style={{
                      ...row,
                      borderColor: on ? T.essence : T.line,
                      background: on ? 'rgba(197,138,249,0.1)' : 'rgba(255,255,255,0.025)',
                    }}
                  >
                    <span style={{
                      ...slotPip,
                      borderColor: on ? T.essence : T.line,
                      color: on ? T.essence : 'transparent',
                    }}>
                      {on ? idx + 1 : ''}
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <span style={{ fontSize: T.size.body, color: T.text, fontWeight: 500 }}>
                        {item.name}
                      </span>
                      <span style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                        {item.tags.slice(0, 4).map(tg => (
                          <span key={tg} style={tagChip}>{tg}</span>
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ ...label, marginBottom: S.sm }}>Result</div>
            <div style={{
              ...resultBox,
              borderColor: preview?.possible ? T.essence : T.line,
              borderStyle: preview ? 'solid' : 'dashed',
            }}>
              {!preview && (
                <div style={{ color: T.textFaint, fontSize: T.size.body, textAlign: 'center' }}>
                  Pick two different things to see what they would become.
                </div>
              )}

              {preview && !preview.possible && (
                <div style={{ color: T.threat, fontSize: T.size.body, textAlign: 'center' }}>
                  {preview.reason ?? 'These cannot be melded.'}
                </div>
              )}

              {preview?.possible && (
                <>
                  <div style={{ fontSize: T.size.h3, fontWeight: 700, color: T.essence }}>
                    {preview.outputName}
                  </div>
                  <p style={{ fontSize: T.size.body, color: T.textMuted, lineHeight: 1.55, marginTop: S.sm }}>
                    {preview.outputDescription}
                  </p>

                  {preview.inheritedTraits.length > 0 && (
                    <div style={{ marginTop: S.md }}>
                      <div style={label}>Inherited</div>
                      {preview.inheritedTraits.map((tr, i) => (
                        <div key={i} style={traitLine}>· {tr}</div>
                      ))}
                    </div>
                  )}

                  {preview.emergentTrait && (
                    <div style={{ marginTop: S.md }}>
                      <div style={{ ...label, color: T.beat }}>Emergent</div>
                      <div style={{ ...traitLine, color: T.beat }}>· {preview.emergentTrait}</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 4, marginTop: S.md, flexWrap: 'wrap' }}>
                    {preview.outputTags.map(tg => <span key={tg} style={tagChip}>{tg}</span>)}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={commit}
              disabled={!preview?.possible}
              style={{
                ...meldBtn,
                opacity: preview?.possible ? 1 : 0.4,
                cursor: preview?.possible ? 'pointer' : 'not-allowed',
              }}
            >
              Meld — <span style={num}>{cost}</span>◆
            </button>
          </div>
        </div>

        <div style={footer}>
          <span style={{
            fontSize: T.size.small,
            color: flash ? T.good : T.textFaint,
            minHeight: 16,
          }}>
            {flash ?? 'Melding is permanent. You may meld as often as your essence allows.'}
          </span>
          <button style={leaveBtn} onClick={onComplete}>Leave the shrine</button>
        </div>
      </div>
    </div>
  );
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'radial-gradient(ellipse at center, rgba(22,16,30,0.96) 0%, rgba(6,8,13,0.98) 70%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 80, padding: S.lg,
};

const title: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.h1, fontWeight: 700,
  color: T.text, margin: `${S.xs}px 0 0`, letterSpacing: -0.4,
};

const subtitle: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.body, color: T.textMuted,
  margin: `${S.sm}px 0 0`, maxWidth: 470, lineHeight: 1.55,
};

const tabs: React.CSSProperties = { display: 'flex', gap: S.sm, marginTop: S.lg };

const tab: React.CSSProperties = {
  padding: `${S.sm}px ${S.lg}px`, border: `1px solid ${T.line}`,
  borderRadius: T.radius, fontFamily: FONT.ui, fontSize: T.size.body,
  fontWeight: 500, cursor: 'pointer',
  transition: `background 160ms ${EASE}, border-color 160ms ${EASE}`,
};

const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: S.xl, marginTop: S.lg,
};

const list: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: S.sm - 2,
  maxHeight: 300, overflowY: 'auto', paddingRight: 4,
};

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: S.md,
  padding: `${S.sm + 2}px ${S.md}px`,
  border: `1px solid ${T.line}`, borderRadius: T.radius,
  cursor: 'pointer', fontFamily: FONT.ui,
  transition: `background 150ms ${EASE}, border-color 150ms ${EASE}`,
};

const slotPip: React.CSSProperties = {
  ...num,
  width: 20, height: 20, borderRadius: 10, flexShrink: 0,
  border: '1px solid', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  fontSize: T.size.tiny, fontWeight: 700,
};

const tagChip: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: 8.5, color: T.textMuted,
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.line}`,
  borderRadius: 3, padding: '1px 5px',
};

const resultBox: React.CSSProperties = {
  minHeight: 240, padding: S.lg,
  border: `1px dashed ${T.line}`, borderRadius: T.radiusLg,
  background: 'rgba(0,0,0,0.25)',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
};

const traitLine: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.small, color: T.textMuted,
  lineHeight: 1.6, marginTop: 2,
};

const meldBtn: React.CSSProperties = {
  width: '100%', marginTop: S.md, padding: `${S.md}px 0`,
  background: 'linear-gradient(180deg, #8a5cc4 0%, #6a43a0 100%)',
  color: '#fff', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: T.radius, fontFamily: FONT.ui,
  fontSize: T.size.lead, fontWeight: 700, letterSpacing: 0.6,
};

const footer: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: S.lg, marginTop: S.lg, paddingTop: S.md,
  borderTop: `1px solid ${T.line}`, fontFamily: FONT.ui,
};

const leaveBtn: React.CSSProperties = {
  padding: `${S.sm + 2}px ${S.xl}px`, background: T.surfaceRaised,
  color: T.text, border: `1px solid ${T.lineStrong}`, borderRadius: T.radius,
  fontFamily: FONT.ui, fontSize: T.size.body, fontWeight: 500, cursor: 'pointer',
};

const emptyNote: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.small, color: T.textFaint,
  padding: `${S.md}px 0`, lineHeight: 1.5,
};
