// ============================================================
// Glyphdelve - Orchestrator
//
// Binds the pure tactical core to the browser: input, rendering, and the
// run-scale phases around a room. It holds no combat rules of its own.
//
// Note there is no simulation loop. The game is turn-based, so logic runs
// only when the player acts; the animation frame is purely visual.
// ============================================================

import type {
  RunState, AccessibilitySettings, LevelUpOffer, EncounterLootEntry, NodeType,
} from '../types';
import { SeededRNG } from './SeededRNG';
import { InputManager } from './InputManager';
import { TacticalRenderer } from '../renderer/TacticalRenderer';
import type { RenderOverlay } from '../renderer/TacticalRenderer';
import {
  createRunState, getCurrentNode, completeCurrentNode, travelTo,
  addCombatLog, updateBuildTags, getAvailableNodes,
} from './RunState';
import { TacticalEngine } from '../core/tactical';
import type { TacticalSnapshot } from '../core/tactical';
import type { Tile } from '../core/grid';
import { tileKey, tileDist } from '../core/grid';
import type { Actor, PlayerActionOption } from '../core/model';
import { awardXP, XP_REWARDS, generateLevelUpOffers, applyLevelUpChoice } from '../systems/LevelSystem';
import { rollDrops, applyDrops, createGuaranteedEncounterDrop } from '../systems/DropSystem';
import { registry } from './DataRegistry';

export type GamePhase =
  | 'menu' | 'map' | 'combat' | 'levelup' | 'shrine' | 'recovery'
  | 'event' | 'loot' | 'victory' | 'defeat' | 'build_summary';

export interface GameCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onLevelUp: (offers: LevelUpOffer[]) => void;
  onStateUpdate: (state: RunState) => void;
  onTacticalUpdate: (snap: TacticalSnapshot | null) => void;
  onRunEnd: (won: boolean) => void;
}

/** What the action bar needs to draw itself. */
export interface ActionBarState {
  actions: PlayerActionOption[];
  selectedId: string | null;
  form: 'caster' | 'bear';
}

/** Upcoming activations, so the player can see who acts and when. */
export interface TurnOrderEntry {
  id: string;
  name: string;
  inBeats: number;
  isPlayer: boolean;
  intentLabel: string;
  dangerous: boolean;
  hp: number;
  maxHp: number;
}

const FLOOR_ENEMY_POOL: Record<number, string[]> = {
  1: ['skeleton_chaser', 'mushroom_spitter', 'shadow_imp', 'toxic_shroom'],
  2: ['skeleton_chaser', 'mushroom_spitter', 'stone_golem', 'shadow_imp', 'toxic_shroom'],
};

export class Game {
  state: RunState;
  phase: GamePhase = 'menu';
  engine: TacticalEngine | null = null;

  private rng: SeededRNG;
  private callbacks: GameCallbacks;
  private input: InputManager;
  private renderer: TacticalRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private settings: AccessibilitySettings;

  private rafId = 0;
  private lastFrame = 0;
  private running = false;

  private pendingLevelUps = 0;
  private hoverTile: Tile | null = null;
  private selectedActionId: string | null = null;
  private showMoveHints = true;

  constructor(seed: number, callbacks: GameCallbacks, settings: AccessibilitySettings) {
    this.rng = new SeededRNG(seed);
    this.state = createRunState(seed);
    this.callbacks = callbacks;
    this.settings = settings;
    this.input = new InputManager(settings.keyBindings as never);
  }

  // --- Lifecycle -----------------------------------------------

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new TacticalRenderer(canvas, {
      colorblindMode: this.settings.colorblindMode,
      reducedMotion: this.settings.reducedMotion,
      screenShake: this.settings.screenShake,
    });
    this.input.attach(canvas);
    canvas.addEventListener('mousemove', this.onPointerMove);
    canvas.addEventListener('click', this.onCanvasClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  updateSettings(settings: AccessibilitySettings): void {
    this.settings = settings;
    this.renderer?.updateConfig({
      colorblindMode: settings.colorblindMode,
      reducedMotion: settings.reducedMotion,
      screenShake: settings.screenShake,
    });
    this.input.setBindings(settings.keyBindings as never);
  }

  start(): void {
    this.setPhase('map');
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    this.push();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.input.detach();
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.onPointerMove);
      this.canvas.removeEventListener('click', this.onCanvasClick);
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    window.removeEventListener('keydown', this.onKeyDown);
  }

  setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.callbacks.onPhaseChange(phase);
  }

  // --- Render loop (visual only) -------------------------------

  private frame = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;

    if (this.phase === 'combat' && this.engine && this.renderer) {
      this.renderer.render(this.engine.snapshot(), this.buildOverlay(), dt);
    } else if (this.renderer && this.engine && this.phase === 'levelup') {
      this.renderer.render(this.engine.snapshot(), this.buildOverlay(), dt);
    }
  };

  private buildOverlay(): RenderOverlay {
    const e = this.engine!;
    const sel = this.selectedActionId;
    let preview: Tile[] = [];

    if (this.hoverTile) {
      if (sel === 'attack' || sel === null) {
        if (e.canAttack(this.hoverTile).ok) preview = e.attackPreview(this.hoverTile);
      }
    }

    return {
      hoverTile: this.hoverTile,
      previewTiles: preview,
      moveOptions: this.showMoveHints ? e.moveOptions() : [],
      attackTargets: e.attackableTiles(),
      threat: e.threatenedTiles(),
      showMoveHints: this.showMoveHints,
    };
  }

  // --- Input ----------------------------------------------------

  private onPointerMove = (ev: MouseEvent) => {
    if (!this.renderer || !this.engine || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.hoverTile = this.renderer.tileAt(
      ev.clientX - rect.left, ev.clientY - rect.top, this.engine.ctx.grid);
  };

  private onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    this.selectedActionId = null;
  };

  private onCanvasClick = (ev: MouseEvent) => {
    if (this.phase !== 'combat' || !this.engine || !this.renderer || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const tile = this.renderer.tileAt(ev.clientX - rect.left, ev.clientY - rect.top, this.engine.ctx.grid);
    if (!tile) return;
    this.clickTile(tile);
  };

  /**
   * One click does the obvious thing: an enemy in reach is attacked, an empty
   * tile in step range is moved to. No mode switching for the common case.
   */
  clickTile(tile: Tile): void {
    const e = this.engine;
    if (!e || this.phase !== 'combat') return;

    if (this.selectedActionId && this.selectedActionId !== 'attack') {
      const id = this.selectedActionId;
      this.selectedActionId = null;
      this.apply(e.performSkill(id, tile));
      return;
    }

    const occupant = e.ctx.actors.find(a =>
      a.alive && a.tile.x === tile.x && a.tile.y === tile.y);

    if (occupant && occupant.faction === 'enemy' && e.canAttack(tile).ok) {
      this.apply(e.performAttack(tile));
      return;
    }
    if (e.canMoveTo(tile).ok) {
      this.apply(e.performMove(tile));
      return;
    }
    // Clicking a far tile steps one square along the route toward it.
    const step = this.stepToward(tile);
    if (step) this.apply(e.performMove(step));
  }

  private stepToward(goal: Tile): Tile | null {
    const e = this.engine!;
    const opts = e.moveOptions();
    if (!opts.length) return null;
    let best = opts[0];
    let bd = tileDist(best.tile, goal);
    for (const o of opts) {
      const d = tileDist(o.tile, goal);
      if (d < bd || (d === bd && o.cost < best.cost)) { best = o; bd = d; }
    }
    return tileDist(e.player.tile, goal) > bd ? best.tile : null;
  }

  private onKeyDown = (ev: KeyboardEvent) => {
    if (this.phase !== 'combat' || !this.engine) return;
    const e = this.engine;
    const p = e.player.tile;

    const dirs: Record<string, Tile> = {
      KeyW: { x: 0, y: -1 }, ArrowUp: { x: 0, y: -1 },
      KeyS: { x: 0, y: 1 }, ArrowDown: { x: 0, y: 1 },
      KeyA: { x: -1, y: 0 }, ArrowLeft: { x: -1, y: 0 },
      KeyD: { x: 1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      KeyQ: { x: -1, y: -1 }, KeyE: { x: 1, y: -1 },
      KeyZ: { x: -1, y: 1 }, KeyC: { x: 1, y: 1 },
    };

    if (dirs[ev.code]) {
      ev.preventDefault();
      const to = { x: p.x + dirs[ev.code].x, y: p.y + dirs[ev.code].y };
      // Walking into an enemy attacks it, as in any roguelike.
      const occupant = e.ctx.actors.find(a => a.alive && a.tile.x === to.x && a.tile.y === to.y);
      if (occupant && occupant.faction === 'enemy' && e.canAttack(to).ok) {
        this.apply(e.performAttack(to));
      } else {
        this.apply(e.performMove(to));
      }
      return;
    }

    if (ev.code === 'Space' || ev.code === 'Period' || ev.code === 'Numpad5') {
      ev.preventDefault();
      this.apply(e.performWait());
      return;
    }

    if (ev.code === 'Tab') {
      ev.preventDefault();
      this.showMoveHints = !this.showMoveHints;
      return;
    }

    const digit = /^Digit([1-9])$/.exec(ev.code);
    if (digit) {
      ev.preventDefault();
      const idx = parseInt(digit[1], 10) - 1;
      const skill = e.skills[idx];
      if (skill) this.useSkill(skill.id);
    }
  };

  /** Called by the action bar and by number keys. */
  useSkill(skillId: string): void {
    const e = this.engine;
    if (!e || this.phase !== 'combat') return;
    const s = e.skills.find(x => x.id === skillId);
    if (!s || s.cooldownRemaining > 0) return;
    // Self-targeted skills resolve immediately; aimed ones wait for a click.
    const needsAim = ['entangling_vines', 'spore_bolt', 'wild_charge'].includes(skillId);
    if (needsAim) {
      this.selectedActionId = this.selectedActionId === skillId ? null : skillId;
      this.push();
      return;
    }
    this.selectedActionId = null;
    this.apply(e.performSkill(skillId));
  }

  selectAction(id: string): void {
    this.selectedActionId = this.selectedActionId === id ? null : id;
    this.push();
  }

  performWait(): void {
    if (this.engine && this.phase === 'combat') this.apply(this.engine.performWait());
  }

  toggleMoveHints(): void {
    this.showMoveHints = !this.showMoveHints;
    this.push();
  }

  // --- Turn resolution -----------------------------------------

  private apply(result: { ok: boolean; killed: Actor[]; outcome: string }): void {
    if (!result.ok) { this.push(); return; }

    result.killed.forEach(k => this.awardKill(k));
    this.renderer?.bump(result.killed.length ? 7 : 3);

    if (result.outcome === 'defeat') {
      this.state.runComplete = true;
      this.state.runWon = false;
      this.setPhase('defeat');
      this.callbacks.onRunEnd(false);
      this.push();
      return;
    }

    if (result.outcome === 'cleared') {
      this.onRoomCleared();
      return;
    }

    this.push();
  }

  private awardKill(enemy: Actor): void {
    const isBoss = Boolean(enemy.flags.isBoss);
    const isElite = Boolean(enemy.flags.isElite);
    const kind = isBoss ? 'boss' : isElite ? 'elite' : 'normal';

    this.state.killCount++;
    if (awardXP(this.state, XP_REWARDS[kind])) this.pendingLevelUps++;

    const drops = rollDrops(this.state, kind, this.rng);
    if (drops.items.length) this.collectLoot(drops.items);
    applyDrops(this.state, drops);
  }

  private collectLoot(items: { id: string; name: string; rarity: string; description?: string }[]): void {
    items.forEach(i => {
      const def = registry.getItem(i.id);
      const entry: EncounterLootEntry = {
        id: i.id,
        name: i.name,
        rarity: (i.rarity ?? 'Common') as EncounterLootEntry['rarity'],
        description: def?.description ?? i.description ?? '',
        effectSummary: def?.triggerSentence ?? '',
      };
      this.state.encounterLoot.push(entry);
    });
  }

  private onRoomCleared(): void {
    const node = getCurrentNode(this.state);
    this.state.combatActive = false;

    if (awardXP(this.state, XP_REWARDS.roomClear)) this.pendingLevelUps++;

    // Every encounter yields something, so a cleared room always reads as progress.
    if (this.state.encounterLoot.length === 0) {
      const kind = node.type === 'boss' ? 'boss' : node.type === 'elite' ? 'elite' : 'normal';
      const guaranteed = createGuaranteedEncounterDrop(this.state, this.rng, kind);
      this.collectLoot(guaranteed.items);
      applyDrops(this.state, guaranteed);
    }

    updateBuildTags(this.state.player);
    this.push();

    if (this.state.encounterLoot.length > 0) { this.setPhase('loot'); return; }
    if (this.pendingLevelUps > 0) { this.showLevelUp(); return; }
    this.finishNode();
  }

  // --- Run-scale flow -------------------------------------------

  enterNode(): void {
    const node = getCurrentNode(this.state);
    this.state.encounterLoot = [];

    switch (node.type) {
      case 'combat': case 'elite': case 'boss':
        this.startRoom(node.type);
        break;
      case 'shrine': this.setPhase('shrine'); break;
      case 'recovery': this.setPhase('recovery'); break;
      case 'event': this.setPhase('event'); break;
    }
    this.push();
  }

  travel(nodeId: string): void {
    if (!travelTo(this.state, nodeId)) return;
    this.enterNode();
  }

  private startRoom(type: NodeType): void {
    const floor = this.state.floor;
    const pool = FLOOR_ENEMY_POOL[floor] ?? FLOOR_ENEMY_POOL[1];

    let ids: string[];
    if (type === 'boss') {
      ids = [floor >= 2 ? 'boss_spore_queen' : 'boss_elder_treant'];
      // The boss brings a small escort so the room is a fight, not a duel.
      for (let i = 0; i < 2; i++) ids.push(this.rng.pick(pool));
    } else if (type === 'elite') {
      const count = floor >= 2 ? 4 : 3;
      ids = Array.from({ length: count }, () => this.rng.pick(pool));
    } else {
      const count = floor >= 2 ? this.rng.nextInt(4, 5) : this.rng.nextInt(3, 4);
      ids = Array.from({ length: count }, () => this.rng.pick(pool));
    }

    if (!this.engine) this.engine = new TacticalEngine(this.rng, this.state.player);
    this.engine.startRoom(type, floor, ids, type === 'elite' || type === 'boss');
    this.state.combatActive = true;
    this.selectedActionId = null;
    this.setPhase('combat');

    addCombatLog(this.state, {
      type: 'trigger', source: 'system',
      details: `Entered ${type} — ${this.engine.layoutName}`,
    });
  }

  showLevelUp(): void {
    this.pendingLevelUps--;
    const offers = generateLevelUpOffers(this.state, this.rng);
    this.state.offeredHistory.push({ level: this.state.player.level, offered: offers, chosen: '' });
    this.setPhase('levelup');
    this.callbacks.onLevelUp(offers);
  }

  chooseLevelUp(offerId: string): void {
    applyLevelUpChoice(this.state, offerId);
    const last = this.state.offeredHistory[this.state.offeredHistory.length - 1];
    if (last) last.chosen = offerId;
    updateBuildTags(this.state.player);
    this.engine?.rebuildSkills();

    if (this.pendingLevelUps > 0) { this.showLevelUp(); return; }
    if (this.state.combatActive) { this.setPhase('combat'); this.push(); return; }
    this.finishNode();
  }

  confirmEncounterLoot(): void {
    this.state.encounterLoot = [];
    this.engine?.rebuildSkills();
    if (this.pendingLevelUps > 0) { this.showLevelUp(); return; }
    this.finishNode();
  }

  applyRecovery(): void {
    const p = this.state.player;
    p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.35));
    this.finishNode();
  }

  applyEvent(choice: number): void {
    const p = this.state.player;
    if (choice === 0) p.essence += 25;
    else if (choice === 1) { p.maxHp += 12; p.hp += 12; }
    else { p.armor += 1; }
    this.finishNode();
  }

  completeNode(): void { this.finishNode(); }

  private finishNode(): void {
    completeCurrentNode(this.state);
    this.state.combatActive = false;

    if (this.state.runComplete) {
      this.setPhase(this.state.runWon ? 'victory' : 'defeat');
      this.callbacks.onRunEnd(this.state.runWon);
      this.push();
      return;
    }
    this.setPhase('map');
    this.push();
  }

  showBuildSummary(): void { this.setPhase('build_summary'); }

  useInventoryItem(itemId: string): void {
    const inv = this.state.player.inventory;
    const idx = inv.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item = inv[idx];
    const p = this.state.player;

    if (item.effect === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + item.value);
      if (this.engine) {
        this.engine.player.hp = Math.min(this.engine.player.maxHp, this.engine.player.hp + item.value);
      }
    } else if (item.effect === 'resource') {
      p.resource = Math.min(p.maxResource, p.resource + item.value);
    }

    item.charges -= 1;
    if (item.charges <= 0) inv.splice(idx, 1);
    this.push();
  }

  // --- UI queries -----------------------------------------------

  actionBar(): ActionBarState | null {
    if (!this.engine) return null;
    return {
      actions: this.engine.availableActions(),
      selectedId: this.selectedActionId,
      form: this.engine.form,
    };
  }

  /** Who acts next, and how soon, in Beats. The player's planning aid. */
  turnOrder(limit = 6): TurnOrderEntry[] {
    const e = this.engine;
    if (!e) return [];
    const clock = e.ctx.clock;
    return e.ctx.actors
      .filter(a => a.alive && a.id !== 'player')
      .map(a => ({
        id: a.id,
        name: a.name,
        inBeats: Math.max(0, Math.round(a.nextActAt - clock)),
        isPlayer: false,
        intentLabel: a.intent?.label ?? 'Idle',
        dangerous: a.intent?.kind === 'attack' || a.intent?.kind === 'hazard',
        hp: Math.ceil(a.hp),
        maxHp: a.maxHp,
      }))
      .sort((a, b) => a.inBeats - b.inBeats)
      .slice(0, limit);
  }

  /** Description of whatever the pointer is over, for the inspector panel. */
  inspect(): { title: string; lines: string[] } | null {
    const e = this.engine;
    if (!e || !this.hoverTile) return null;
    const t = this.hoverTile;
    const lines: string[] = [];

    const actor = e.ctx.actors.find(a => a.alive && a.tile.x === t.x && a.tile.y === t.y);
    const terrain = e.ctx.grid.info(t.x, t.y);
    const threat = e.threatenedTiles().get(tileKey(t));

    if (actor) {
      lines.push(`${Math.ceil(actor.hp)} / ${actor.maxHp} HP`);
      if (actor.faction === 'enemy') {
        lines.push(`Acts every ${actor.actSpeed} Beats`);
        if (actor.intent) lines.push(`Next: ${actor.intent.label}`);
      }
      const st = Object.keys(actor.statuses);
      if (st.length) lines.push(`Afflicted: ${st.join(', ')}`);
    }

    lines.push(terrain.description);
    if (threat) lines.push(`Incoming here: ${threat.damage} damage (${threat.sources.join(', ')})`);
    if (!actor && e.canMoveTo(t).ok) lines.push(`Step here: ${e.moveCost(t)} Beats`);

    return { title: actor ? actor.name : terrain.name, lines };
  }

  availableNodes() { return getAvailableNodes(this.state); }

  private push(): void {
    this.callbacks.onStateUpdate(this.state);
    this.callbacks.onTacticalUpdate(this.engine ? this.engine.snapshot() : null);
  }
}
