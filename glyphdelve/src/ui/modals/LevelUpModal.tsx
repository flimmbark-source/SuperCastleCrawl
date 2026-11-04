// ============================================================
// Glyphdelve - Level Up
//
// The build-crafting beat. Information hierarchy on each card, in order:
// what it is, what it does in a sentence, what tags it carries, and how well
// it fits the build you already have. Synergy is shown because the offer
// generator genuinely weights toward your tags — the player should be able to
// see the system working on their behalf.
// ============================================================

import React, { useState } from 'react';
import type { LevelUpOffer } from '../../types';
import { T, S, FONT, panel, label, RARITY, RARITY_GLOW, EASE } from '../theme';

interface Props {
  offers: LevelUpOffer[];
  playerLevel: number;
  onChoose: (offerId: string) => void;
  tooltipMode: 'plain' | 'detailed';
}

const TYPE_META = {
  skill: { label: 'Skill', colour: '#4fc3f7' },
  skill_upgrade: { label: 'Upgrade', colour: '#ff9f43' },
  passive: { label: 'Passive', colour: '#c58af9' },
} as const;

const SYNERGY_META = {
  High: { colour: '#5ec47d', pips: 3, note: 'Strongly matches your build' },
  Med: { colour: '#ffcf4d', pips: 2, note: 'Partly matches your build' },
  Low: { colour: '#6c7789', pips: 1, note: 'A new direction' },
} as const;

export const LevelUpModal: React.FC<Props> = ({
  offers, playerLevel, onChoose, tooltipMode,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={overlay} role="dialog" aria-label={`Level ${playerLevel} reward`}>
      <div style={{ textAlign: 'center', marginBottom: S.xl }}>
        <div style={{ ...label, color: T.beat }}>Level {playerLevel}</div>
        <h2 style={title}>Shape the build</h2>
        <p style={subtitle}>
          Offers lean toward the tags you already carry. Take one.
        </p>
      </div>

      <div style={cardRow}>
        {offers.map(offer => {
          const type = TYPE_META[offer.type];
          const syn = SYNERGY_META[offer.synergy];
          const hot = hovered === offer.id;

          return (
            <button
              key={offer.id}
              onClick={() => onChoose(offer.id)}
              onMouseEnter={() => setHovered(offer.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(offer.id)}
              onBlur={() => setHovered(null)}
              aria-label={`${offer.name}, ${type.label}, ${offer.rarity}, ${offer.synergy} synergy`}
              style={{
                ...card,
                borderColor: hot ? RARITY[offer.rarity] : T.line,
                transform: hot ? 'translateY(-6px)' : 'translateY(0)',
                boxShadow: hot
                  ? `0 18px 44px rgba(0,0,0,0.6), 0 0 0 1px ${RARITY[offer.rarity]}, 0 0 34px ${RARITY_GLOW[offer.rarity]}`
                  : T.shadowMd,
              }}
            >
              {/* Rarity spine: the fastest read on the card. */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                background: RARITY[offer.rarity],
                borderTopLeftRadius: T.radiusLg, borderBottomLeftRadius: T.radiusLg,
              }} />

              <div style={badgeRow}>
                <span style={{ ...typeBadge, color: type.colour, borderColor: `${type.colour}55` }}>
                  {type.label}
                </span>
                <span style={{ ...label, color: RARITY[offer.rarity], fontSize: 8.5 }}>
                  {offer.rarity}
                </span>
              </div>

              <h3 style={cardTitle}>{offer.name}</h3>

              <p style={triggerText}>{offer.triggerSentence}</p>

              {tooltipMode === 'detailed' && offer.description && (
                <p style={descText}>{offer.description}</p>
              )}

              <div style={tagRow}>
                {offer.tags.slice(0, 4).map(t => (
                  <span key={t} style={tagChip}>{t}</span>
                ))}
              </div>

              <div style={{ flex: 1 }} />

              <div style={synergyRow}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      style={{
                        width: 5, height: 5, borderRadius: 3,
                        background: i < syn.pips ? syn.colour : T.line,
                      }}
                    />
                  ))}
                </span>
                <span style={{ color: syn.colour, fontSize: T.size.tiny, fontWeight: 600 }}>
                  {syn.note}
                </span>
              </div>

              {offer.synergyNote && (
                <div style={{
                  fontSize: T.size.micro, color: T.textFaint,
                  marginTop: S.xs, lineHeight: 1.45,
                  maxHeight: hot ? 60 : 0, overflow: 'hidden',
                  transition: `max-height 220ms ${EASE}`,
                }}>
                  {offer.synergyNote}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'radial-gradient(ellipse at center, rgba(16,20,30,0.96) 0%, rgba(6,8,13,0.98) 70%)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  zIndex: 80, padding: S.lg,
};

const title: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.h1, fontWeight: 700,
  color: T.text, margin: `${S.xs}px 0 0`, letterSpacing: -0.4,
};

const subtitle: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.body, color: T.textMuted,
  margin: `${S.sm}px 0 0`,
};

const cardRow: React.CSSProperties = {
  display: 'flex', gap: S.md, flexWrap: 'wrap', justifyContent: 'center',
  maxWidth: 1180,
};

const card: React.CSSProperties = {
  ...panel,
  position: 'relative',
  width: 212, minHeight: 268,
  padding: `${S.md}px ${S.md}px ${S.md}px ${S.md + 3}px`,
  display: 'flex', flexDirection: 'column',
  textAlign: 'left', cursor: 'pointer',
  overflow: 'hidden',
  transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}, border-color 200ms ${EASE}`,
};

const badgeRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};

const typeBadge: React.CSSProperties = {
  ...label, fontSize: 8.5, padding: '2px 6px',
  border: '1px solid', borderRadius: 3,
};

const cardTitle: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.h3, fontWeight: 700,
  color: T.text, margin: `${S.sm + 2}px 0 ${S.sm}px`, lineHeight: 1.18,
  letterSpacing: -0.2,
};

const triggerText: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.small, color: T.textMuted,
  lineHeight: 1.55, margin: 0,
};

const descText: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: T.size.tiny, color: T.textFaint,
  lineHeight: 1.5, margin: `${S.sm}px 0 0`, fontStyle: 'italic',
};

const tagRow: React.CSSProperties = {
  display: 'flex', gap: S.xs, flexWrap: 'wrap', marginTop: S.sm + 2,
};

const tagChip: React.CSSProperties = {
  fontFamily: FONT.ui, fontSize: 8.5, color: T.textMuted,
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.line}`,
  borderRadius: 3, padding: '2px 5px', letterSpacing: 0.3,
};

const synergyRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: S.sm,
  marginTop: S.md, paddingTop: S.sm, borderTop: `1px solid ${T.line}`,
};
