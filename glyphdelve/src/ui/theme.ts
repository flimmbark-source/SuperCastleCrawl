// ============================================================
// Glyphdelve - Design System
//
// One source of truth for the interface's visual language: palette, type
// scale, spacing, elevation and the shared chrome every panel is built from.
//
// Two faces, two jobs. Space Grotesk carries language; JetBrains Mono carries
// number — Beat costs, damage and HP are compared as columns, so they need
// tabular figures. Mixing the two arbitrarily is what made the original UI
// read as a debug overlay.
// ============================================================

import type React from 'react';
import type { Rarity } from '../types';

export const FONT = {
  ui: "'Space Grotesk', system-ui, sans-serif",
  num: "'JetBrains Mono', ui-monospace, monospace",
} as const;

/** 4px base. Every gap, pad and inset is a multiple, so rhythm stays even. */
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const;

export const T = {
  // --- Surfaces, deepest first -------------------------------
  bg: '#080a10',
  bgRaised: '#0e121b',
  surface: '#141a26',
  surfaceRaised: '#1b2231',
  surfaceHover: '#232c3e',
  line: '#283244',
  lineStrong: '#3a475f',

  // --- Ink ---------------------------------------------------
  text: '#e8eef9',
  textMuted: '#9aa6bd',
  textFaint: '#5d6879',

  // --- Semantics ---------------------------------------------
  beat: '#ffcf4d',      // the Beat economy — always this gold, nothing else
  beatDim: 'rgba(255, 207, 77, 0.14)',
  threat: '#f2545b',    // incoming damage
  threatDim: 'rgba(242, 84, 91, 0.16)',
  good: '#5ec47d',
  info: '#4fc3f7',
  bear: '#f0a44a',
  essence: '#c58af9',
  warn: '#ff9f43',

  // --- Type scale (1.25 ratio, rounded to whole px) ----------
  size: {
    micro: 9,
    tiny: 10,
    small: 11,
    body: 12.5,
    lead: 14,
    h3: 17,
    h2: 21,
    h1: 30,
    display: 46,
  },

  radius: 6,
  radiusLg: 10,

  /**
   * Legacy alias. Prefer FONT.ui for language and FONT.num for figures;
   * this points at the numeric face so older call sites stay correct.
   */
  mono: "'JetBrains Mono', ui-monospace, monospace",

  // --- Elevation ---------------------------------------------
  shadowSm: '0 1px 2px rgba(0,0,0,0.4)',
  shadowMd: '0 4px 14px rgba(0,0,0,0.45)',
  shadowLg: '0 12px 40px rgba(0,0,0,0.6)',
} as const;

export const RARITY: Record<Rarity, string> = {
  Common: '#9aa6bd',
  Uncommon: '#5ec47d',
  Rare: '#4fc3f7',
  Relic: '#c58af9',
};

export const RARITY_GLOW: Record<Rarity, string> = {
  Common: 'rgba(154,166,189,0.18)',
  Uncommon: 'rgba(94,196,125,0.2)',
  Rare: 'rgba(79,195,247,0.22)',
  Relic: 'rgba(197,138,249,0.26)',
};

/** Shared chrome for every floating surface. */
export const panel: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(27,34,49,0.95) 0%, rgba(18,23,34,0.96) 100%)',
  border: `1px solid ${T.line}`,
  borderRadius: T.radiusLg,
  boxShadow: T.shadowMd,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  fontFamily: FONT.ui,
  color: T.text,
};

/** Small uppercase section heading. */
export const label: React.CSSProperties = {
  fontFamily: FONT.ui,
  fontSize: T.size.micro,
  fontWeight: 500,
  letterSpacing: 1.6,
  textTransform: 'uppercase',
  color: T.textFaint,
};

/** Any figure the player compares against another figure. */
export const num: React.CSSProperties = {
  fontFamily: FONT.num,
  fontVariantNumeric: 'tabular-nums',
};

export const barTrack: React.CSSProperties = {
  background: 'rgba(0,0,0,0.5)',
  borderRadius: 4,
  overflow: 'hidden',
  border: `1px solid ${T.line}`,
  position: 'relative',
};

export function bar(frac: number, colour: string, height = 6): React.CSSProperties {
  return {
    height,
    borderRadius: height / 2,
    background: `linear-gradient(180deg, ${colour} 0%, ${shade(colour, -0.22)} 100%)`,
    width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
    transition: 'width 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    boxShadow: `0 0 10px ${colour}44`,
  };
}

/** The Beat price chip, used everywhere a cost is shown. */
export function beatChip(cost: number, dimmed = false): React.CSSProperties {
  return {
    ...num,
    fontSize: T.size.small,
    fontWeight: 700,
    color: dimmed ? T.textFaint : T.beat,
    background: dimmed ? 'rgba(255,255,255,0.04)' : T.beatDim,
    border: `1px solid ${dimmed ? T.line : 'rgba(255,207,77,0.38)'}`,
    borderRadius: 4,
    padding: '1px 6px',
    whiteSpace: 'nowrap',
    lineHeight: 1.5,
  };
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${ch.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Standard easing for anything that moves in the interface. */
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
