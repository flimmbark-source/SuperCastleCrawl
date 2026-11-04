// ============================================================
// Glyphdelve - Build & Log Panel
//
// Collapsed by default during a fight: the board and the telegraphs are what
// matter moment to moment, and a permanently-expanded panel was covering the
// play area in the original build.
// ============================================================

import React, { useState } from 'react';
import type { RunState } from '../../types';
import type { TacticalSnapshot } from '../../core/tactical';
import { T, panel, label, RARITY } from '../theme';
import { inventoryItemIcon } from '../itemPresentation';

interface Props {
  state: RunState;
  snapshot?: TacticalSnapshot | null;
  onUseInventoryItem: (itemId: string) => void;
}

type Tab = 'build' | 'tags' | 'log';

export const SidePanel: React.FC<Props> = ({ state, snapshot, onUseInventoryItem }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('build');
  const p = state.player;

  if (!open) {
    return (
      <button style={tabBtn} onClick={() => setOpen(true)} aria-label="Open build panel">
        ◀ BUILD
      </button>
    );
  }

  return (
    <div style={wrap}>
      <div style={header}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['build', 'tags', 'log'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...tabChip,
                background: tab === t ? 'rgba(255,213,79,0.14)' : 'transparent',
                color: tab === t ? T.beat : T.textMuted,
                borderColor: tab === t ? 'rgba(255,213,79,0.4)' : 'transparent',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <button style={closeBtn} onClick={() => setOpen(false)} aria-label="Close panel">▶</button>
      </div>

      <div style={body}>
        {tab === 'build' && (
          <>
            <Section title={`Skills ${p.skills.length}/${p.maxSkillSlots}`}>
              {p.skills.map((s, i) => (
                <Row
                  key={s.def.id}
                  left={`${i + 1}. ${s.def.name}`}
                  right={s.def.tags.slice(0, 2).join(' ')}
                  hint={s.def.triggerSentence}
                />
              ))}
            </Section>

            <Section title={`Passives ${p.passives.length}`} empty="None yet.">
              {p.passives.map(x => (
                <Row key={x.def.id} left={x.def.name} right="" hint={x.def.triggerSentence} />
              ))}
            </Section>

            <Section title={`Items ${p.items.length}`} empty="Nothing equipped.">
              {p.items.map((x, i) => (
                <Row
                  key={`${x.def.id}_${i}`}
                  left={x.def.name}
                  right={x.def.rarity}
                  rightColour={RARITY[x.def.rarity]}
                  hint={x.def.triggerSentence}
                />
              ))}
            </Section>

            <Section title={`Pack ${p.inventory.length}`} empty="No consumables.">
              {p.inventory.map(it => (
                <button
                  key={it.id}
                  style={useBtn}
                  onClick={() => onUseInventoryItem(it.id)}
                  title={it.description}
                >
                  <span>{inventoryItemIcon(it)} {it.name}</span>
                  <span style={{ color: T.textFaint }}>×{it.charges}</span>
                </button>
              ))}
            </Section>
          </>
        )}

        {tab === 'tags' && (
          <Section title="Build affinity" empty="Pick something to start shaping a build.">
            {[...p.buildTags.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => (
                <div key={t} style={{ marginBottom: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: T.text }}>{t}</span>
                    <span style={{ color: T.textFaint }}>{n}</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(0,0,0,0.4)', borderRadius: 2, marginTop: 2 }}>
                    <div style={{
                      height: 3, borderRadius: 2, background: T.info,
                      width: `${Math.min(100, n * 20)}%`,
                    }} />
                  </div>
                </div>
              ))}
            <div style={{ ...label, marginTop: 8, lineHeight: 1.6, textTransform: 'none', letterSpacing: 0 }}>
              Level-up offers lean toward the tags you already have.
            </div>
          </Section>
        )}

        {tab === 'log' && (
          <Section title="Room log" empty="Nothing has happened yet.">
            {(snapshot?.log ?? []).slice(-60).reverse().map((l, i) => (
              <div
                key={i}
                style={{
                  fontSize: 10.5, lineHeight: 1.5, marginBottom: 2,
                  color: l.important ? T.beat
                    : l.kind === 'damage' ? T.textMuted
                    : l.kind === 'kill' ? T.threat
                    : l.kind === 'heal' ? T.good
                    : T.textFaint,
                }}
              >
                <span style={{ color: T.textFaint }}>{l.beat}▸ </span>{l.text}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; empty?: string; children?: React.ReactNode }> = ({
  title, empty, children,
}) => {
  const has = React.Children.count(children) > 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ ...label, marginBottom: 4 }}>{title}</div>
      {has ? children : <div style={{ fontSize: 10.5, color: T.textFaint }}>{empty}</div>}
    </div>
  );
};

const Row: React.FC<{
  left: string; right: string; hint?: string; rightColour?: string;
}> = ({ left, right, hint, rightColour }) => (
  <div style={row} title={hint}>
    <span style={{ color: T.text, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {left}
    </span>
    <span style={{ color: rightColour ?? T.textFaint, fontSize: 9, flexShrink: 0 }}>{right}</span>
  </div>
);

const wrap: React.CSSProperties = {
  ...panel, position: 'absolute', top: 12, right: 228,
  width: 236, maxHeight: 'calc(100vh - 120px)',
  display: 'flex', flexDirection: 'column', zIndex: 19,
};

const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '7px 8px', borderBottom: `1px solid ${T.line}`,
};

const body: React.CSSProperties = { padding: '9px 10px', overflowY: 'auto' };

const tabChip: React.CSSProperties = {
  padding: '3px 9px', border: '1px solid transparent', borderRadius: 4,
  fontFamily: T.mono, fontSize: 10, cursor: 'pointer', textTransform: 'uppercase',
  letterSpacing: 0.8, background: 'transparent',
};

const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: T.textFaint,
  cursor: 'pointer', fontSize: 11, fontFamily: T.mono,
};

const tabBtn: React.CSSProperties = {
  position: 'absolute', top: 12, right: 228,
  ...panel, padding: '6px 10px', fontSize: 10, letterSpacing: 1,
  color: T.textMuted, cursor: 'pointer', zIndex: 19,
};

const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 6, padding: '3px 5px', marginBottom: 2,
  background: 'rgba(255,255,255,0.03)', borderRadius: 3,
  fontFamily: T.mono,
};

const useBtn: React.CSSProperties = {
  ...row, width: '100%', border: `1px solid ${T.line}`,
  cursor: 'pointer', color: T.text, fontSize: 11,
};
