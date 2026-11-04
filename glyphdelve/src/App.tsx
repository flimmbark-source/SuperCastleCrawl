import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './engine/Game';
import type { GamePhase, ActionBarState, TurnOrderEntry } from './engine/Game';
import type { TacticalSnapshot } from './core/tactical';
import type { PlayerActionOption } from './core/model';
import { initializeRegistry } from './data';
import { loadSettings, saveSettings, applyFontScale } from './engine/AccessibilitySettings';
import type { AccessibilitySettings, RunState, LevelUpOffer } from './types';
import { HUD } from './ui/components/HUD';
import { MapView } from './ui/components/MapView';
import { ActionBar } from './ui/components/ActionBar';
import { TurnOrderRail } from './ui/components/TurnOrderRail';
import { TileInspector } from './ui/components/TileInspector';
import { LevelUpModal } from './ui/modals/LevelUpModal';
import { ShrineModal } from './ui/modals/ShrineModal';
import { LootModal } from './ui/modals/LootModal';
import { SettingsPanel } from './ui/panels/SettingsPanel';
import { SidePanel } from './ui/panels/SidePanel';
import { BuildSummary } from './ui/panels/BuildSummary';
import { getCurrentFloorMap } from './engine/RunState';
import { T, panel } from './ui/theme';

initializeRegistry();

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings());
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [state, setState] = useState<RunState | null>(null);
  const [snap, setSnap] = useState<TacticalSnapshot | null>(null);
  const [bar, setBar] = useState<ActionBarState | null>(null);
  const [order, setOrder] = useState<TurnOrderEntry[]>([]);
  const [inspect, setInspect] = useState<{ title: string; lines: string[] } | null>(null);
  const [levelUpOffers, setLevelUpOffers] = useState<LevelUpOffer[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [seed, setSeed] = useState<number>(() => Date.now() % 1_000_000);
  const [pendingCost, setPendingCost] = useState<number | null>(null);

  useEffect(() => { applyFontScale(settings.fontScale); }, [settings.fontScale]);

  const refresh = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    setBar(g.actionBar());
    setOrder(g.turnOrder());
  }, []);

  // The board is static between actions, but the inspector follows the
  // pointer, so poll it on a light interval rather than on every frame.
  useEffect(() => {
    if (phase !== 'combat') return;
    const id = setInterval(() => {
      const g = gameRef.current;
      if (!g) return;
      setInspect(g.inspect());
    }, 90);
    return () => clearInterval(id);
  }, [phase]);

  const startNewRun = useCallback((runSeed?: number) => {
    const useSeed = runSeed ?? Date.now() % 1_000_000;
    setSeed(useSeed);
    gameRef.current?.stop();

    const game = new Game(useSeed, {
      onPhaseChange: p => { setPhase(p); refresh(); },
      onLevelUp: setLevelUpOffers,
      onStateUpdate: s => { setState({ ...s }); refresh(); },
      onTacticalUpdate: s => { setSnap(s ? { ...s } : null); refresh(); },
      onRunEnd: () => {},
    }, settings);

    gameRef.current = game;
    if (canvasRef.current) game.attachCanvas(canvasRef.current);
    game.start();
    setState({ ...game.state });
  }, [settings, refresh]);

  // Attach the canvas as soon as it exists after leaving the menu.
  useEffect(() => {
    if (phase === 'menu' || !gameRef.current || !canvasRef.current) return;
    gameRef.current.attachCanvas(canvasRef.current);
  }, [phase]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'F5') { e.preventDefault(); startNewRun(seed); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [seed, startNewRun]);

  useEffect(() => () => { gameRef.current?.stop(); }, []);

  const handleSettingsSave = useCallback((s: AccessibilitySettings) => {
    setSettings(s);
    saveSettings(s);
    gameRef.current?.updateSettings(s);
  }, []);

  const onAction = useCallback((a: PlayerActionOption) => {
    const g = gameRef.current;
    if (!g) return;
    if (a.kind === 'wait') g.performWait();
    else if (a.kind === 'skill') g.useSkill(a.id);
    else if (a.kind === 'attack') g.selectAction('attack');
    refresh();
  }, [refresh]);

  // --- Menu ---------------------------------------------------

  if (phase === 'menu') {
    return (
      <div style={menuWrap}>
        <div style={menuInner}>
          <h1 style={title}>GLYPHDELVE</h1>
          <p style={tagline}>A tactical delve where every action costs Beats</p>

          <div style={pitch}>
            <Pitch n="1" text="Every action costs Beats. Beats are exactly what the enemies get to spend." />
            <Pitch n="2" text="Enemies show you what they will do before they do it. Attacks are committed — step aside and they miss." />
            <Pitch n="3" text="Walls, bramble and chasms are weapons. Shove something into the dark and it is gone." />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <label style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>Seed</label>
            <input
              style={seedInput}
              type="number"
              value={seed}
              onChange={e => setSeed(parseInt(e.target.value) || 0)}
            />
            <button style={smallBtn} onClick={() => setSeed(Date.now() % 1_000_000)}>Random</button>
          </div>

          <button style={startBtn} onClick={() => startNewRun(seed)}>Begin Delve</button>
          <button style={smallBtn} onClick={() => setShowSettings(true)}>Settings</button>

          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textFaint, marginTop: 10, textAlign: 'center', lineHeight: 1.7 }}>
            WASD / QEZC — step &nbsp;·&nbsp; Click — move or strike &nbsp;·&nbsp; Space — wait one Beat<br />
            1–9 — skills &nbsp;·&nbsp; Tab — step hints &nbsp;·&nbsp; F5 — restart this seed
          </div>
        </div>
        {showSettings && (
          <SettingsPanel settings={settings} onSave={handleSettingsSave} onClose={() => setShowSettings(false)} />
        )}
      </div>
    );
  }

  // --- In-run ---------------------------------------------------

  const inCombat = phase === 'combat' || phase === 'levelup';
  const playerActor = snap?.actors.find(a => a.kind === 'player');

  return (
    <div style={gameWrap}>
      <canvas ref={canvasRef} style={canvasStyle} />

      {state && inCombat && snap && (
        <>
          <HUD
            player={state.player}
            state={state}
            roomHp={playerActor?.hp}
            roomMaxHp={playerActor?.maxHp}
            shield={Number(playerActor?.flags.shieldHp ?? 0)}
            beats={snap.clock}
            layoutName={snap.layoutName}
          />
          <TurnOrderRail
            entries={order}
            pendingCost={pendingCost}
            pressure={snap.pressure}
            beatsToPressure={snap.beatsToPressure}
          />
          <TileInspector info={inspect} />
          <SidePanel state={state} snapshot={snap} onUseInventoryItem={id => gameRef.current?.useInventoryItem(id)} />
        </>
      )}

      {bar && phase === 'combat' && (
        <div
          onMouseLeave={() => setPendingCost(null)}
          onMouseOver={e => {
            const el = (e.target as HTMLElement).closest('button');
            const lbl = el?.getAttribute('aria-label') ?? '';
            const m = /, (\d+) beats/.exec(lbl);
            setPendingCost(m ? parseInt(m[1], 10) : null);
          }}
        >
          <ActionBar
            actions={bar.actions}
            selectedId={bar.selectedId}
            form={bar.form}
            onAction={onAction}
          />
        </div>
      )}

      <button style={gearBtn} onClick={() => setShowSettings(true)} aria-label="Settings">⚙</button>

      {phase === 'map' && state && (
        <MapView
          map={getCurrentFloorMap(state)}
          currentNodeId={state.currentNodeId}
          availableNodeIds={state.availableNodeIds}
          floor={state.floor}
          onTravel={id => gameRef.current?.travel(id)}
          onShowBuildSummary={() => gameRef.current?.showBuildSummary()}
        />
      )}

      {phase === 'levelup' && (
        <LevelUpModal
          offers={levelUpOffers}
          playerLevel={state?.player.level ?? 1}
          onChoose={id => gameRef.current?.chooseLevelUp(id)}
          tooltipMode={settings.tooltipMode}
        />
      )}

      {phase === 'shrine' && state && (
        <ShrineModal
          state={state}
          onComplete={() => gameRef.current?.completeNode()}
          onStateChange={() => setState({ ...state })}
        />
      )}

      {phase === 'loot' && state && (
        <LootModal
          loot={state.encounterLoot}
          onContinue={() => gameRef.current?.confirmEncounterLoot()}
        />
      )}

      {phase === 'recovery' && state && (
        <Overlay>
          <h2 style={cardTitle}>✚ Recovery Spring</h2>
          <p style={cardBody}>Still water in a quiet alcove. Recover 35% of your vitality.</p>
          <p style={{ ...cardBody, color: T.good }}>
            {Math.ceil(state.player.hp)} / {state.player.maxHp} HP
          </p>
          <button style={startBtn} onClick={() => gameRef.current?.applyRecovery()}>Rest</button>
        </Overlay>
      )}

      {phase === 'event' && state && (
        <Overlay>
          <h2 style={cardTitle}>◌ Wandering Spirit</h2>
          <p style={cardBody}>It offers one gift, and asks nothing in return.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button style={choiceBtn} onClick={() => gameRef.current?.applyEvent(0)}>
              <strong style={{ color: T.essence }}>◆ 25 Essence</strong>
              <span style={choiceSub}>Toward a meld at the next shrine</span>
            </button>
            <button style={choiceBtn} onClick={() => gameRef.current?.applyEvent(1)}>
              <strong style={{ color: T.good }}>+12 Max HP</strong>
              <span style={choiceSub}>Permanent, and healed immediately</span>
            </button>
            <button style={choiceBtn} onClick={() => gameRef.current?.applyEvent(2)}>
              <strong style={{ color: T.info }}>+1 Armour</strong>
              <span style={choiceSub}>Blunts every physical hit you take</span>
            </button>
          </div>
        </Overlay>
      )}

      {phase === 'build_summary' && state && (
        <BuildSummary player={state.player} state={state} onClose={() => gameRef.current?.setPhase('map')} />
      )}

      {phase === 'victory' && state && (
        <EndScreen
          title="DELVE COMPLETE"
          colour={T.beat}
          subtitle="You walked back out of the glyphdelve."
          state={state}
          onPrimary={() => startNewRun()}
          primaryLabel="New Delve"
          onSecondary={() => { gameRef.current?.stop(); setPhase('menu'); }}
        />
      )}

      {phase === 'defeat' && state && (
        <EndScreen
          title="YOU FELL"
          colour={T.threat}
          subtitle="The delve keeps what it takes."
          state={state}
          onPrimary={() => startNewRun(seed)}
          primaryLabel="Retry This Seed"
          onSecondary={() => { gameRef.current?.stop(); setPhase('menu'); }}
        />
      )}

      {showSettings && (
        <SettingsPanel settings={settings} onSave={handleSettingsSave} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
};

// --- Small presentational pieces --------------------------------

const Pitch: React.FC<{ n: string; text: string }> = ({ n, text }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: 440 }}>
    <span style={{
      fontFamily: T.mono, fontSize: 10, color: T.beat, border: '1px solid rgba(255,213,79,0.4)',
      borderRadius: 10, width: 18, height: 18, display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
    }}>{n}</span>
    <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.textMuted, lineHeight: 1.55 }}>{text}</span>
  </div>
);

const Overlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={overlayStyle}>
    <div style={{ ...panel, padding: 28, maxWidth: 480, textAlign: 'center' }}>{children}</div>
  </div>
);

const EndScreen: React.FC<{
  title: string; colour: string; subtitle: string; state: RunState;
  onPrimary: () => void; primaryLabel: string; onSecondary: () => void;
}> = ({ title, colour, subtitle, state, onPrimary, primaryLabel, onSecondary }) => (
  <div style={{ ...overlayStyle, flexDirection: 'column', gap: 14 }}>
    <h1 style={{ fontSize: 38, color: colour, fontFamily: T.mono, letterSpacing: 6, margin: 0 }}>{title}</h1>
    <p style={{ color: T.textMuted, fontFamily: T.mono, fontSize: 13, margin: 0 }}>{subtitle}</p>
    <div style={{ ...panel, padding: '14px 22px', fontSize: 12, lineHeight: 1.9, color: T.textMuted }}>
      <div>Level {state.player.level} · {state.killCount} slain · {state.meldHistory.length} melds</div>
      <div>Floor {state.floor} · Seed {state.seed}</div>
      <div style={{ color: T.textFaint, marginTop: 4 }}>
        Skills {state.player.skills.length} · Passives {state.player.passives.length} · Items {state.player.items.length}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <button style={startBtn} onClick={onPrimary}>{primaryLabel}</button>
      <button style={smallBtn} onClick={onSecondary}>Menu</button>
    </div>
  </div>
);

// --- Styles ------------------------------------------------------

const menuWrap: React.CSSProperties = {
  width: '100vw', height: '100vh', background: T.bg,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const menuInner: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, padding: 20,
};
const title: React.CSSProperties = {
  fontSize: 46, color: T.text, fontFamily: T.mono, letterSpacing: 10,
  margin: 0, textShadow: '0 0 28px rgba(79,195,247,0.25)',
};
const tagline: React.CSSProperties = {
  fontSize: 12, color: T.textMuted, fontFamily: T.mono, margin: 0, letterSpacing: 1,
};
const pitch: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0 2px',
};
const seedInput: React.CSSProperties = {
  width: 120, padding: '5px 8px', background: T.surface,
  border: `1px solid ${T.line}`, borderRadius: 4, color: T.text,
  fontFamily: T.mono, fontSize: 12,
};
const startBtn: React.CSSProperties = {
  padding: '12px 40px', background: '#2e7d4f', color: '#fff', border: 'none',
  borderRadius: T.radius, fontSize: 15, fontWeight: 700, cursor: 'pointer',
  fontFamily: T.mono, letterSpacing: 2,
};
const smallBtn: React.CSSProperties = {
  padding: '7px 18px', background: T.surfaceRaised, color: T.textMuted,
  border: `1px solid ${T.line}`, borderRadius: 4, fontSize: 11,
  cursor: 'pointer', fontFamily: T.mono,
};
const choiceBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
  padding: '12px 16px', width: 134, background: T.surfaceRaised,
  border: `1px solid ${T.lineStrong}`, borderRadius: T.radius,
  cursor: 'pointer', fontFamily: T.mono, fontSize: 12, color: T.text,
};
const choiceSub: React.CSSProperties = { fontSize: 9.5, color: T.textFaint, lineHeight: 1.4 };
const gameWrap: React.CSSProperties = {
  width: '100vw', height: '100vh', background: T.bg, position: 'relative', overflow: 'hidden',
};
const canvasStyle: React.CSSProperties = { width: '100%', height: '100%', display: 'block' };
const gearBtn: React.CSSProperties = {
  position: 'absolute', bottom: 12, right: 12, background: 'rgba(20,25,36,0.9)',
  border: `1px solid ${T.line}`, borderRadius: 4, color: T.textMuted,
  cursor: 'pointer', fontSize: 14, padding: '5px 9px', zIndex: 25,
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(7,9,14,0.9)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70,
};
const cardTitle: React.CSSProperties = {
  fontSize: 21, color: T.text, fontFamily: T.mono, margin: '0 0 10px',
};
const cardBody: React.CSSProperties = {
  fontSize: 12.5, color: T.textMuted, fontFamily: T.mono, margin: '0 0 6px', lineHeight: 1.6,
};

export default App;
