// ============================================================
// Glyphdelve - Loot Reveal
//
// Loot is the payoff beat of a cleared room, so it states plainly what each
// piece actually does. The old panel showed a name and a rarity tag and left
// the player to guess.
// ============================================================

import React from 'react';
import type { EncounterLootEntry } from '../../types';
import { T, panel, RARITY, label } from '../theme';
import { encounterLootIcon } from '../itemPresentation';

interface Props {
  loot: EncounterLootEntry[];
  onContinue: () => void;
}

export const LootModal: React.FC<Props> = ({ loot, onContinue }) => (
  <div style={overlay}>
    <div style={{ ...panel, padding: 24, width: 540, maxWidth: '92vw' }}>
      <div style={{ ...label, color: T.good }}>Room cleared</div>
      <h2 style={title}>
        {loot.length} {loot.length === 1 ? 'find' : 'finds'}
      </h2>

      <div style={list}>
        {loot.map((item, i) => (
          <div key={`${item.id}_${i}`} style={{ ...card, borderLeft: `3px solid ${RARITY[item.rarity]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <span style={{ color: T.text, fontSize: 13, fontFamily: T.mono }}>
                {encounterLootIcon(item)} {item.name}
              </span>
              <span style={{ color: RARITY[item.rarity], fontSize: 10, fontFamily: T.mono }}>
                {item.rarity}
              </span>
            </div>
            {item.effectSummary && (
              <div style={{ color: T.info, fontSize: 11, fontFamily: T.mono, marginTop: 5, lineHeight: 1.5 }}>
                {item.effectSummary}
              </div>
            )}
            {item.description && (
              <div style={{ color: T.textFaint, fontSize: 10.5, fontFamily: T.mono, marginTop: 3, lineHeight: 1.45 }}>
                {item.description}
              </div>
            )}
          </div>
        ))}
      </div>

      <button style={btn} onClick={onContinue} autoFocus>Continue the delve</button>
    </div>
  </div>
);

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(7,9,14,0.92)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70,
};

const title: React.CSSProperties = {
  fontFamily: T.mono, fontSize: 20, color: T.text, margin: '4px 0 14px', letterSpacing: 1,
};

const list: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  maxHeight: '46vh', overflowY: 'auto', marginBottom: 16,
};

const card: React.CSSProperties = {
  background: T.surfaceRaised, border: `1px solid ${T.line}`,
  borderRadius: T.radius, padding: '9px 11px',
};

const btn: React.CSSProperties = {
  width: '100%', padding: '11px 0', background: '#2e7d4f', color: '#fff',
  border: 'none', borderRadius: T.radius, fontFamily: T.mono,
  fontSize: 13, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer',
};
