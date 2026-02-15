import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './engine/Game';
import type { GamePhase } from './engine/Game';
import { initializeRegistry } from './data';
import { loadSettings, saveSettings, applyFontScale } from './engine/AccessibilitySettings';
import type { AccessibilitySettings, RunState, LevelUpOffer } from './types';
import { HUD } from './ui/components/HUD';
import { MapView } from './ui/components/MapView';
import { LevelUpModal } from './ui/modals/LevelUpModal';
import { LootScreen } from './ui/modals/LootScreen';
import { ShrineModal } from './ui/modals/ShrineModal';
import { SettingsPanel } from './ui/panels/SettingsPanel';
import { SidePanel } from './ui/panels/SidePanel';
import { BuildSummary } from './ui/panels/BuildSummary';
import { DebugOverlay } from './ui/panels/DebugOverlay';

initializeRegistry();

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const canvasAttachedRef = useRef(false);

  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings());
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [state, setState] = useState<RunState | null>(null);
  const [levelUpOffers, setLevelUpOffers] = useState<LevelUpOffer[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fps, setFps] = useState(60);
  const [debugToggles, setDebugToggles] = useState({ hitboxes: false, triggers: false, caps: true });
  const [seed, setSeed] = useState<number>(Date.now());
  const [stateVersion, setStateVersion] = useState(0);

  useEffect(() => {
    let frames = 0;
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      setFps(Math.round(frames / ((now - lastTime) / 1000)));
      frames = 0;
      lastTime = now;
    }, 1000);
    const countFrame = () => { frames++; requestAnimationFrame(countFrame); };
    requestAnimationFrame(countFrame);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { applyFontScale(settings.fontScale); }, [settings.fontScale]);

  useEffect(() => {
    if (phase === 'menu') return;
    if (!gameRef.current || !canvasRef.current || canvasAttachedRef.current) return;
    gameRef.current.attachCanvas(canvasRef.current);
    canvasAttachedRef.current = true;
  }, [phase]);

  const startNewRun = useCallback((runSeed?: number) => {
    const useSeed = runSeed ?? Date.now();
    setSeed(useSeed);
    if (gameRef.current) gameRef.current.stop();

    const game = new Game(useSeed, {
      onPhaseChange: (p) => setPhase(p),
      onLevelUp: (offers) => setLevelUpOffers(offers),
      onStateUpdate: (s) => setState({ ...s }),
      onNodeComplete: () => {},
      onRunEnd: () => {},
    }, settings);

    gameRef.current = game;
    canvasAttachedRef.current = false;
    if (canvasRef.current) {
      game.attachCanvas(canvasRef.current);
      canvasAttachedRef.current = true;
    }
    game.start();
    setState(game.state);
  }, [settings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'F5') { e.preventDefault(); startNewRun(seed); }
      if (e.code === 'F3') { e.preventDefault(); setShowDebug(d => !d); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [seed, startNewRun]);

  const handleSettingsSave = useCallback((s: AccessibilitySettings) => {
    setSettings(s); saveSettings(s);
    if (gameRef.current) gameRef.current.updateSettings(s);
  }, []);

  if (phase === 'menu') {
    return (
      <div style={menuStyles.container}>
        <div style={menuStyles.content}>
          <h1 style={menuStyles.title}>GLYPHDELVE</h1>
          <p style={menuStyles.tagline}>A Minimalist Systemic Dungeon Crawler</p>
          <p style={menuStyles.classLabel}>Class: Druid</p>
          <div style={menuStyles.seedRow}>
            <label style={menuStyles.seedLabel}>Seed:</label>
            <input style={menuStyles.seedInput} type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value) || 0)} />
            <button style={menuStyles.randomBtn} onClick={() => setSeed(Date.now())}>Random</button>
          </div>
          <button style={menuStyles.startBtn} onClick={() => startNewRun(seed)}>Begin Delve</button>
          <button style={menuStyles.settingsBtn} onClick={() => setShowSettings(true)}>Settings</button>
          <div style={menuStyles.controls}>
            <p style={menuStyles.controlLine}>WASD — Move | 1/2/3 — Skills | Mouse — Aim & Attack</p>
            <p style={menuStyles.controlLine}>ESC — Pause | F3 — Debug | F5 — Restart Same Seed</p>
          </div>
        </div>
        {showSettings && <SettingsPanel settings={settings} onSave={handleSettingsSave} onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  return (
    <div style={gameStyles.container}>
      <canvas ref={canvasRef} style={gameStyles.canvas} />

      {state && (phase === 'combat' || phase === 'levelup') && (
        <>
          <HUD player={state.player} state={state} floor={state.floor} nodeIndex={state.currentNodeIndex} />
          <SidePanel state={state} onUseInventoryItem={(itemId) => gameRef.current?.useInventoryItem(itemId)} />
        </>
      )}

      <button style={gameStyles.pauseBtn} onClick={() => gameRef.current?.togglePause()}>
        {state?.paused ? '▶' : '❚❚'}
      </button>
      <button style={gameStyles.gearBtn} onClick={() => setShowSettings(true)}>⚙</button>

      {phase === 'map' && state && (
        <MapView
          maps={state.maps}
          currentFloor={state.floor}
          currentNodeIndex={state.currentNodeIndex}
          onEnterNode={() => gameRef.current?.enterNode()}
          onShowBuildSummary={() => gameRef.current?.showBuildSummary()}
        />
      )}

      {phase === 'levelup' && state && (
        <LevelUpModal offers={levelUpOffers} playerLevel={state.player.level} onChoose={(id) => gameRef.current?.chooseLevelUp(id)} tooltipMode={settings.tooltipMode} />
      )}

      {phase === 'shrine' && state && (
        <ShrineModal state={state} onComplete={() => gameRef.current?.completeNode()} onStateChange={() => setStateVersion(v => v + 1)} />
      )}

      {phase === 'recovery' && state && (
        <div style={gameStyles.eventOverlay}>
          <div style={gameStyles.eventCard}>
            <h2 style={gameStyles.eventTitle}>♥ Recovery Spring</h2>
            <p style={gameStyles.eventDesc}>Heal 30% of max HP and restore resource.</p>
            <p style={{ ...gameStyles.eventDesc, color: '#4caf50' }}>HP: {Math.ceil(state.player.hp)}/{state.player.maxHp}</p>
            <button style={gameStyles.eventBtn} onClick={() => gameRef.current?.applyRecovery()}>Rest & Heal</button>
          </div>
        </div>
      )}

      {phase === 'event' && state && (
        <div style={gameStyles.eventOverlay}>
          <div style={gameStyles.eventCard}>
            <h2 style={gameStyles.eventTitle}>? Mysterious Encounter</h2>
            <p style={gameStyles.eventDesc}>A wandering spirit offers a choice:</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
              <button style={gameStyles.eventBtn} onClick={() => gameRef.current?.applyEvent(0)}>Claim 20 Essence</button>
              <button style={gameStyles.eventBtn} onClick={() => gameRef.current?.applyEvent(1)}>Gain +10 Max HP</button>
            </div>
          </div>
        </div>
      )}


      {phase === 'loot' && state && (
        <LootScreen items={state.encounterLoot} onContinue={() => gameRef.current?.confirmEncounterLoot()} />
      )}

      {phase === 'build_summary' && state && (
        <BuildSummary player={state.player} state={state} onClose={() => gameRef.current?.setPhase('map')} />
      )}

      {phase === 'victory' && state && (
        <div style={gameStyles.endOverlay}>
          <h1 style={{ fontSize: 36, color: '#ffd54f', fontFamily: 'monospace', letterSpacing: 4 }}>VICTORY!</h1>
          <p style={{ color: '#888', fontFamily: 'monospace' }}>You conquered the dungeon!</p>
          <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 }}>
            <p>Level: {state.player.level} · Kills: {state.killCount} · Melds: {state.meldHistory.length}</p>
            <p>Time: {Math.floor(state.runTime / 60)}m {Math.floor(state.runTime % 60)}s · Seed: {state.seed}</p>
          </div>
          <button style={menuStyles.startBtn} onClick={() => { gameRef.current?.stop(); setPhase('menu'); }}>Return to Menu</button>
        </div>
      )}

      {phase === 'defeat' && state && (
        <div style={gameStyles.endOverlay}>
          <h1 style={{ fontSize: 36, color: '#ef5350', fontFamily: 'monospace', letterSpacing: 4 }}>DEFEATED</h1>
          <p style={{ color: '#888', fontFamily: 'monospace' }}>The dungeon claims another soul.</p>
          <div style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 }}>
            <p>Level: {state.player.level} · Floor: {state.floor} · Kills: {state.killCount}</p>
            <p>Time: {Math.floor(state.runTime / 60)}m {Math.floor(state.runTime % 60)}s · Seed: {state.seed}</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={menuStyles.startBtn} onClick={() => startNewRun(seed)}>Retry Same Seed</button>
            <button style={menuStyles.settingsBtn} onClick={() => { gameRef.current?.stop(); setPhase('menu'); }}>Menu</button>
          </div>
        </div>
      )}

      {state?.paused && phase === 'combat' && (
        <div style={gameStyles.pauseOverlay}>
          <h2 style={{ fontSize: 36, color: '#e0e0e0', fontFamily: 'monospace', letterSpacing: 8 }}>PAUSED</h2>
          <p style={{ fontSize: 13, color: '#666', fontFamily: 'monospace' }}>Press ESC to resume</p>
        </div>
      )}

      {showDebug && state && (
        <DebugOverlay
          state={state} fps={fps}
          showHitboxes={debugToggles.hitboxes}
          showTriggerChains={debugToggles.triggers}
          showCaps={debugToggles.caps}
          onToggle={(key) => setDebugToggles(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
        />
      )}

      {showSettings && <SettingsPanel settings={settings} onSave={handleSettingsSave} onClose={() => setShowSettings(false)} />}
    </div>
  );
};

const menuStyles: Record<string, React.CSSProperties> = {
  container: { width: '100vw', height: '100vh', backgroundColor: '#0d0d1a', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  content: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  title: { fontSize: 48, color: '#e0e0e0', fontFamily: 'monospace', letterSpacing: 8, margin: 0, textShadow: '0 0 20px rgba(79,195,247,0.3)' },
  tagline: { fontSize: 13, color: '#666', fontFamily: 'monospace', margin: 0 },
  classLabel: { fontSize: 14, color: '#4caf50', fontFamily: 'monospace', margin: 0 },
  seedRow: { display: 'flex', gap: 8, alignItems: 'center' },
  seedLabel: { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  seedInput: { width: 140, padding: '4px 8px', backgroundColor: '#1a1a2e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', fontFamily: 'monospace', fontSize: 12 },
  randomBtn: { padding: '4px 10px', backgroundColor: '#333', color: '#aaa', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  startBtn: { padding: '12px 40px', backgroundColor: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 'bold', cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 2 },
  settingsBtn: { padding: '8px 20px', backgroundColor: '#333', color: '#aaa', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' },
  controls: { marginTop: 16 },
  controlLine: { fontSize: 11, color: '#555', fontFamily: 'monospace', margin: '4px 0' },
};

const gameStyles: Record<string, React.CSSProperties> = {
  container: { width: '100vw', height: '100vh', backgroundColor: '#0d0d1a', position: 'relative', overflow: 'hidden' },
  canvas: { width: '100%', height: '100%', display: 'block' },
  pauseBtn: { position: 'absolute', top: 8, right: 240, backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid #444', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 14, padding: '4px 8px', zIndex: 15 },
  gearBtn: { position: 'absolute', top: 8, right: 280, backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid #444', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 14, padding: '4px 8px', zIndex: 15 },
  eventOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  eventCard: { maxWidth: 400, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 32, textAlign: 'center', border: '2px solid #444' },
  eventTitle: { fontSize: 22, color: '#e0e0e0', fontFamily: 'monospace', margin: '0 0 12px' },
  eventDesc: { fontSize: 13, color: '#bbb', fontFamily: 'monospace', margin: '0 0 8px' },
  eventBtn: { padding: '10px 24px', backgroundColor: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'monospace', margin: '4px' },
  endOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 100 },
  pauseOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 90 },
};

export default App;
