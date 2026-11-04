// ============================================================
// Glyphdelve - Design Tokens
//
// One source of truth for the interface's visual language. Every panel reads
// from here so that colour, spacing and type stay consistent as the UI grows.
// ============================================================

import type React from 'react';
import type { Rarity } from '../types';

export const T = {
  // Surfaces, from deepest to nearest.
  bg: '#0b0e14',
  surface: '#141924',
  surfaceRaised: '#1b2231',
  surfaceHover: '#232c3e',
  line: '#2b3447',
  lineStrong: '#3c4862',

  // Text, by role rather than by shade.
  text: '#e4eaf5',
  textMuted: '#97a2b8',
  textFaint: '#5f6b80',

  // Semantics.
  beat: '#ffd54f',      // the Beat economy: always this gold
  threat: '#ef5350',    // incoming damage
  good: '#66bb6a',
  info: '#4fc3f7',
  bear: '#ffb74d',
  essence: '#ce93d8',
  warn: '#ffa726',

  // Type.
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",

  radius: 6,
  radiusLg: 10,
} as const;

export const RARITY: Record<Rarity, string> = {
  Common: '#9aa6bf',
  Uncommon: '#66bb6a',
  Rare: '#4fc3f7',
  Relic: '#ce93d8',
};

/** Panel chrome shared by every floating surface. */
export const panel: React.CSSProperties = {
  background: 'rgba(20, 25, 36, 0.94)',
  border: `1px solid ${T.line}`,
  borderRadius: T.radiusLg,
  backdropFilter: 'blur(6px)',
  fontFamily: T.mono,
  color: T.text,
};

export const label: React.CSSProperties = {
  fontFamily: T.mono,
  fontSize: 10,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  color: T.textFaint,
};

export function bar(frac: number, colour: string, height = 6): React.CSSProperties {
  return {
    height,
    borderRadius: height / 2,
    background: colour,
    width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
    transition: 'width 180ms ease-out',
  };
}

export const barTrack: React.CSSProperties = {
  background: 'rgba(0,0,0,0.45)',
  borderRadius: 4,
  overflow: 'hidden',
  border: `1px solid ${T.line}`,
};

/** The Beat cost chip. Used everywhere a price is shown, so it reads instantly. */
export function beatChip(cost: number, dimmed = false): React.CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    fontWeight: 700,
    color: dimmed ? T.textFaint : T.beat,
    background: dimmed ? 'rgba(255,255,255,0.04)' : 'rgba(255,213,79,0.12)',
    border: `1px solid ${dimmed ? T.line : 'rgba(255,213,79,0.4)'}`,
    borderRadius: 4,
    padding: '1px 5px',
    whiteSpace: 'nowrap',
  };
}

void 0;
