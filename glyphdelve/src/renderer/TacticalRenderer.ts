// ============================================================
// Glyphdelve - Tactical Renderer
//
// Draws the whole room at once, always. Fitting the board to the viewport
// rather than following a camera is a design decision, not a convenience:
// perfect information is a pillar, and a telegraph you have to scroll to see
// cannot be planned around.
//
// Art direction
// -------------
// One light, from the upper left, obeyed by every element: walls take a lit
// cap and throw a shadow down-right, actors sit on a contact shadow and carry
// a rim highlight. Consistent lighting is most of what separates a board that
// reads as a place from a grid of coloured rectangles.
//
// Terrain is static between actions, so it is rasterised once into an
// offscreen canvas and blitted. All the gradients, bevels, shadows and
// speckle below are therefore paid for on room entry, not every frame.
// ============================================================

import type { Grid, Tile } from '../core/grid';
import { tileKey } from '../core/grid';
import type { Actor, HazardZone, Intent, VisualEffect } from '../core/model';
import { STATUSES } from '../core/model';
import type { TacticalSnapshot } from '../core/tactical';

export interface RenderConfig {
  colorblindMode: boolean;
  reducedMotion: boolean;
  screenShake: boolean;
}

export interface RenderOverlay {
  hoverTile: Tile | null;
  previewTiles: Tile[];
  moveOptions: { tile: Tile; cost: number }[];
  attackTargets: Tile[];
  threat: Map<string, { damage: number; sources: string[] }>;
  showMoveHints: boolean;
}

const C = {
  void: '#080a10',
  floorLo: '#232c3f',
  floorHi: '#2d374d',
  floorSpeck: 'rgba(255,255,255,0.06)',
  gridLine: 'rgba(168,186,220,0.11)',

  wallFace: '#414b63',
  wallCap: '#68769a',
  wallDark: '#2b3448',
  wallEdge: '#0c0f16',

  brambleBase: '#1c2a24',
  brambleMid: '#2b4634',
  brambleTip: '#4a7355',

  chasmRim: '#3b4668',
  chasmGlow: 'rgba(124, 92, 212, 0.35)',

  player: '#4fc3f7',
  playerBear: '#f0a44a',
  enemy: '#f2545b',
  elite: '#ff9f43',
  boss: '#c58af9',
  summon: '#5ec47d',

  beat: '#ffcf4d',
  threat: '#f2545b',
  text: '#e8eef9',
  dim: '#8795ab',
} as const;

/** One hue per archetype: a pack's composition reads before shapes resolve. */
const ENEMY_HUE: Record<string, string> = {
  skeleton_chaser: '#f2545b',
  mushroom_spitter: '#c05fd6',
  stone_golem: '#a1795f',
  shadow_imp: '#8b6ef0',
  toxic_shroom: '#8fc45a',
};

const FONT_NUM = "'JetBrains Mono', ui-monospace, monospace";
const FONT_UI = "'Space Grotesk', system-ui, sans-serif";

interface FloatText {
  x: number; y: number; vx: number;
  text: string; colour: string; age: number; life: number; big: boolean;
}

/** Deterministic hash, so a tile's speckle never shimmers between frames. */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export class TacticalRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private cfg: RenderConfig;

  private tileSize = 40;
  private originX = 0;
  private originY = 0;

  private shake = 0;
  private floats: FloatText[] = [];
  private seenEffects = new Set<string>();
  private time = 0;

  // Static terrain is rasterised once and blitted thereafter.
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainKey = '';

  // Full-screen gradients only change on resize; rebuilding them per frame
  // was the largest avoidable cost in the render loop.
  private ambientGrad: CanvasGradient | null = null;
  private vignetteGrad: CanvasGradient | null = null;
  private gradKey = '';

  constructor(canvas: HTMLCanvasElement, cfg: RenderConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.cfg = cfg;
  }

  updateConfig(cfg: RenderConfig): void {
    this.cfg = cfg;
    this.terrainKey = ''; // colourblind glyphs live in the cached layer
  }

  bump(amount = 5): void {
    if (!this.cfg.screenShake || this.cfg.reducedMotion) return;
    this.shake = Math.max(this.shake, amount);
  }

  tileAt(px: number, py: number, grid: Grid): Tile | null {
    const x = Math.floor((px - this.originX) / this.tileSize);
    const y = Math.floor((py - this.originY) / this.tileSize);
    if (!grid.inBounds(x, y)) return null;
    return { x, y };
  }

  tileCentre(t: Tile): { x: number; y: number } {
    return {
      x: this.originX + (t.x + 0.5) * this.tileSize,
      y: this.originY + (t.y + 0.5) * this.tileSize,
    };
  }

  private layout(grid: Grid): { cssW: number; cssH: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || 960;
    const cssH = this.canvas.clientHeight || 640;
    if (this.canvas.width !== Math.round(cssW * dpr) ||
        this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Reserve the HUD rails so no tile can hide beneath a panel.
    const narrow = cssW < 1100;
    const insetL = narrow ? 16 : 220;
    const insetR = narrow ? 16 : 236;
    const insetT = 20;
    const insetB = 112;
    const availW = Math.max(120, cssW - insetL - insetR);
    const availH = Math.max(120, cssH - insetT - insetB);
    this.tileSize = Math.max(16, Math.floor(Math.min(availW / grid.w, availH / grid.h)));
    this.originX = Math.round(insetL + (availW - grid.w * this.tileSize) / 2);
    this.originY = Math.round(insetT + (availH - grid.h * this.tileSize) / 2);
    return { cssW, cssH };
  }

  render(snap: TacticalSnapshot, overlay: RenderOverlay, dtMs: number): void {
    const { grid } = snap;
    const { cssW, cssH } = this.layout(grid);
    const ctx = this.ctx;
    this.time += dtMs / 1000;

    this.ensureGradients(cssW, cssH, grid);
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, cssW, cssH);
    this.drawAmbient(cssW, cssH);

    ctx.save();
    if (this.shake > 0) {
      const k = this.shake;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      this.shake = Math.max(0, this.shake - dtMs * 0.035);
    }

    this.blitTerrain(grid);
    this.drawHazards(snap.hazards);
    if (overlay.showMoveHints) this.drawMoveHints(overlay);
    this.drawThreat(overlay.threat, grid);
    this.drawPreview(overlay.previewTiles);
    this.drawIntentArrows(snap.actors);
    this.drawAttackTargets(overlay.attackTargets);
    this.drawHover(overlay.hoverTile, grid);

    this.tweenActors(snap.actors, dtMs);
    // Shadows as one pass first, so nothing is shadowed onto another body.
    snap.actors.forEach(a => { if (a.alive) this.drawContactShadow(a); });
    snap.actors
      .slice()
      .sort((a, b) => (a.alive === b.alive
        ? (a.renderTile?.y ?? 0) - (b.renderTile?.y ?? 0)
        : a.alive ? 1 : -1))
      .forEach(a => this.drawActor(a, snap));

    this.ingestEffects(snap.effects);
    this.drawEffects(snap.effects, dtMs);
    this.drawFloats(dtMs);

    ctx.restore();
    this.drawVignette(cssW, cssH);
  }

  // --- Atmosphere -----------------------------------------------

  private ensureGradients(cssW: number, cssH: number, grid: Grid): void {
    const key = `${cssW}x${cssH}:${this.originX},${this.originY},${this.tileSize},${grid.w},${grid.h}`;
    if (key === this.gradKey && this.ambientGrad && this.vignetteGrad) return;
    this.gradKey = key;
    const ctx = this.ctx;

    const cx = this.originX + (grid.w * this.tileSize) / 2;
    const cy = this.originY + (grid.h * this.tileSize) / 2;
    const r = Math.max(grid.w, grid.h) * this.tileSize * 0.75;
    const a = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    a.addColorStop(0, 'rgba(50, 64, 96, 0.3)');
    a.addColorStop(1, 'rgba(8, 10, 16, 0)');
    this.ambientGrad = a;

    const v = ctx.createRadialGradient(
      cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.34,
      cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.78,
    );
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    this.vignetteGrad = v;
  }

  private drawAmbient(cssW: number, cssH: number): void {
    if (!this.ambientGrad) return;
    this.ctx.fillStyle = this.ambientGrad;
    this.ctx.fillRect(0, 0, cssW, cssH);
  }

  private drawVignette(cssW: number, cssH: number): void {
    if (!this.vignetteGrad) return;
    this.ctx.fillStyle = this.vignetteGrad;
    this.ctx.fillRect(0, 0, cssW, cssH);
  }

  // --- Terrain (cached) -----------------------------------------

  private blitTerrain(grid: Grid): void {
    // O(1) key: the grid versions itself, so this costs nothing per frame.
    const key = `${grid.w}x${grid.h}:${this.tileSize}:${this.cfg.colorblindMode}:${grid.version}`;
    if (key !== this.terrainKey || !this.terrainCanvas) {
      this.terrainKey = key;
      this.terrainCanvas = this.rasterTerrain(grid);
    }
    this.ctx.drawImage(
      this.terrainCanvas, this.originX, this.originY,
      grid.w * this.tileSize, grid.h * this.tileSize,
    );
  }

  private rasterTerrain(grid: Grid): HTMLCanvasElement {
    const s = this.tileSize;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(grid.w * s * dpr);
    cv.height = Math.ceil(grid.h * s * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Pass 1 — floor bed.
    grid.forEach((x, y, t) => {
      if (t === 'wall' || t === 'chasm') return;
      this.paintFloor(ctx, x * s, y * s, s, x, y);
    });

    // Pass 2 — walls cast a soft drop shadow from the shared light. Drawn as
    // one blurred pass so adjacent blocks read as a single mass.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(4, s * 0.34);
    ctx.shadowOffsetX = s * 0.13;
    ctx.shadowOffsetY = s * 0.15;
    ctx.fillStyle = '#000';
    grid.forEach((x, y, t) => {
      if (t !== 'wall') return;
      ctx.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
    });
    ctx.restore();

    // Pass 3 — solids and features.
    grid.forEach((x, y, t) => {
      const px = x * s, py = y * s;
      if (t === 'chasm') this.paintChasm(ctx, px, py, s, grid, x, y);
      else if (t === 'wall') this.paintWall(ctx, px, py, s, grid, x, y);
      else if (t === 'bramble') this.paintBramble(ctx, px, py, s, x, y);
    });

    // Pass 4 — an inset frame so the board reads as a built room.
    ctx.strokeStyle = 'rgba(120,136,173,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, grid.w * s - 2, grid.h * s - 2);

    return cv;
  }

  private paintFloor(
    ctx: CanvasRenderingContext2D, px: number, py: number, s: number, x: number, y: number,
  ): void {
    const g = ctx.createLinearGradient(px, py, px + s, py + s);
    const alt = (x + y) % 2 === 0;
    g.addColorStop(0, alt ? C.floorHi : C.floorLo);
    g.addColorStop(1, alt ? C.floorLo : C.floorHi);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, s, s);

    // Deterministic speckle: stone grain that never shimmers.
    const n = Math.floor(hash2(x, y) * 4);
    ctx.fillStyle = C.floorSpeck;
    for (let i = 0; i < n; i++) {
      const hx = hash2(x * 7 + i, y * 13);
      const hy = hash2(x * 17, y * 5 + i);
      ctx.fillRect(px + hx * (s - 4) + 2, py + hy * (s - 4) + 2, 1.5, 1.5);
    }

    // Inset hairline rather than a full outline: counts distance without noise.
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + s - 0.5);
    ctx.lineTo(px + 0.5, py + 0.5);
    ctx.lineTo(px + s - 0.5, py + 0.5);
    ctx.stroke();
  }

  private paintWall(
    ctx: CanvasRenderingContext2D, px: number, py: number, s: number,
    grid: Grid, x: number, y: number,
  ): void {
    const capH = Math.max(3, s * 0.22);
    const openAbove = grid.get(x, y - 1) !== 'wall';

    const g = ctx.createLinearGradient(px, py, px, py + s);
    g.addColorStop(0, C.wallFace);
    g.addColorStop(1, C.wallDark);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, s, s);

    // Lit cap only where the block is actually exposed to the light.
    if (openAbove) {
      const cg = ctx.createLinearGradient(px, py, px, py + capH);
      cg.addColorStop(0, C.wallCap);
      cg.addColorStop(1, C.wallFace);
      ctx.fillStyle = cg;
      ctx.fillRect(px, py, s, capH);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(px, py, Math.max(1.5, s * 0.05), s);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + s - Math.max(1.5, s * 0.06), py, Math.max(1.5, s * 0.06), s);

    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.75, py + 0.75, s - 1.5, s - 1.5);
  }

  private paintChasm(
    ctx: CanvasRenderingContext2D, px: number, py: number, s: number,
    grid: Grid, x: number, y: number,
  ): void {
    ctx.fillStyle = '#04060b';
    ctx.fillRect(px, py, s, s);

    const g = ctx.createRadialGradient(
      px + s / 2, py + s * 0.62, 1, px + s / 2, py + s / 2, s * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, s, s);

    // The near lip catches a cold light, so the tile reads as an edge.
    if (grid.get(x, y - 1) !== 'chasm') {
      ctx.strokeStyle = C.chasmGlow;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(px + 2, py + 3);
      ctx.lineTo(px + s - 2, py + 3);
      ctx.stroke();
      ctx.strokeStyle = C.chasmRim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 1.5);
      ctx.lineTo(px + s - 1, py + 1.5);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(59,70,104,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

    if (this.cfg.colorblindMode) {
      ctx.fillStyle = 'rgba(190,200,225,0.55)';
      ctx.font = `${Math.round(s * 0.4)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▽', px + s / 2, py + s / 2);
    }
  }

  private paintBramble(
    ctx: CanvasRenderingContext2D, px: number, py: number, s: number, x: number, y: number,
  ): void {
    ctx.fillStyle = C.brambleBase;
    ctx.fillRect(px, py, s, s);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, s, s);
    ctx.clip();

    // An organic tangle rather than a flat swatch: strokes are seeded from the
    // tile position, so each thicket looks grown rather than stamped.
    ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const h1 = hash2(x * 31 + i, y * 17);
      const h2 = hash2(x * 11, y * 23 + i);
      const h3 = hash2(x * 5 + i, y * 41 + i);
      const sx = px + h1 * s;
      const sy = py + h2 * s;
      const len = s * (0.3 + h3 * 0.42);
      const ang = h3 * Math.PI * 2;
      ctx.strokeStyle = i % 3 === 0 ? C.brambleTip : C.brambleMid;
      ctx.lineWidth = i % 3 === 0 ? 1 : 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(
        sx + Math.cos(ang) * len * 0.6 + 3, sy + Math.sin(ang) * len * 0.6,
        sx + Math.cos(ang) * len, sy + Math.sin(ang) * len,
      );
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(74,115,85,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  }

  // --- Hazards --------------------------------------------------

  private drawHazards(hazards: HazardZone[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    hazards.forEach(h => {
      const px = this.originX + h.tile.x * s;
      const py = this.originY + h.tile.y * s;
      const pulse = this.cfg.reducedMotion ? 0.2
        : 0.16 + 0.09 * Math.sin(this.time * 2.6 + h.tile.x * 1.3 + h.tile.y);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = h.colour;
      ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = h.colour;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = this.cfg.reducedMotion ? 0 : -this.time * 12;
      ctx.strokeRect(px + 2.5, py + 2.5, s - 5, s - 5);
      ctx.restore();
    });
  }

  // --- Overlays -------------------------------------------------

  private drawMoveHints(o: RenderOverlay): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    o.moveOptions.forEach(({ tile, cost }) => {
      const px = this.originX + tile.x * s;
      const py = this.originY + tile.y * s;
      ctx.fillStyle = 'rgba(79,195,247,0.1)';
      ctx.fillRect(px + 3, py + 3, s - 6, s - 6);

      // Corner ticks rather than a full outline: present but quiet.
      ctx.strokeStyle = 'rgba(79,195,247,0.55)';
      ctx.lineWidth = 1.5;
      const t = s * 0.22;
      ([[3, 3, 1, 1], [s - 3, 3, -1, 1], [s - 3, s - 3, -1, -1], [3, s - 3, 1, -1]] as const)
        .forEach(([ox, oy, dx, dy]) => {
          ctx.beginPath();
          ctx.moveTo(px + ox + dx * t, py + oy);
          ctx.lineTo(px + ox, py + oy);
          ctx.lineTo(px + ox, py + oy + dy * t);
          ctx.stroke();
        });

      if (s >= 26) {
        ctx.font = `600 ${Math.round(s * 0.27)}px ${FONT_NUM}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(79,195,247,0.9)';
        ctx.fillText(`${cost}`, px + s - 5, py + s - 4);
      }
    });
  }

  private drawThreat(
    threat: Map<string, { damage: number; sources: string[] }>, grid: Grid,
  ): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    const breathe = this.cfg.reducedMotion ? 0 : Math.sin(this.time * 2.2) * 0.04;

    threat.forEach((info, key) => {
      const [x, y] = key.split(',').map(Number);
      if (!grid.inBounds(x, y)) return;
      const px = this.originX + x * s;
      const py = this.originY + y * s;

      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 1, py + 1, s - 2, s - 2);
      ctx.clip();
      ctx.fillStyle = `rgba(242,84,91,${0.17 + breathe})`;
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      // Diagonal hatch: the threat reads without relying on hue alone.
      ctx.strokeStyle = 'rgba(242,84,91,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -s; i < s; i += 8) {
        ctx.moveTo(px + i, py);
        ctx.lineTo(px + i + s, py + s);
      }
      ctx.stroke();
      ctx.restore();

      // Marching ants: motion draws the eye to live danger.
      ctx.save();
      ctx.strokeStyle = 'rgba(242,84,91,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = this.cfg.reducedMotion ? 0 : -this.time * 18;
      ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
      ctx.restore();

      if (s >= 24) {
        // Damage in a chip, so it reads as a value rather than decoration.
        const txt = `${info.damage}`;
        ctx.font = `700 ${Math.round(s * 0.3)}px ${FONT_NUM}`;
        const w = ctx.measureText(txt).width + 10;
        const h = Math.round(s * 0.36);
        const bx = px + s / 2 - w / 2;
        const by = py + s / 2 - h / 2;
        ctx.fillStyle = 'rgba(12,8,10,0.82)';
        this.roundRect(ctx, bx, by, w, h, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(242,84,91,0.7)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, bx, by, w, h, 3);
        ctx.stroke();
        ctx.fillStyle = '#ffd9db';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, px + s / 2, by + h / 2 + 0.5);
      }
    });
  }

  private drawPreview(tiles: Tile[]): void {
    if (!tiles.length) return;
    const ctx = this.ctx;
    const s = this.tileSize;
    tiles.forEach(t => {
      const px = this.originX + t.x * s;
      const py = this.originY + t.y * s;
      ctx.fillStyle = 'rgba(255,207,77,0.2)';
      ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,207,77,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.lineDashOffset = this.cfg.reducedMotion ? 0 : this.time * 16;
      ctx.strokeRect(px + 2.5, py + 2.5, s - 5, s - 5);
      ctx.restore();
    });
  }

  private drawAttackTargets(tiles: Tile[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    const pulse = this.cfg.reducedMotion ? 1 : 1 + Math.sin(this.time * 3.4) * 0.045;
    tiles.forEach(t => {
      const { x, y } = this.tileCentre(t);
      const r = s * 0.46 * pulse;
      ctx.strokeStyle = 'rgba(255,207,77,0.9)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const arm = r * 0.42;
      ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.moveTo(x + cx * r, y + cy * r - cy * arm);
        ctx.lineTo(x + cx * r, y + cy * r);
        ctx.lineTo(x + cx * r - cx * arm, y + cy * r);
        ctx.stroke();
      });
      ctx.lineCap = 'butt';
    });
  }

  private drawHover(t: Tile | null, grid: Grid): void {
    if (!t || !grid.inBounds(t.x, t.y)) return;
    const ctx = this.ctx;
    const s = this.tileSize;
    const px = this.originX + t.x * s;
    const py = this.originY + t.y * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, px + 1, py + 1, s - 2, s - 2, 3);
    ctx.stroke();
  }

  private drawIntentArrows(actors: Actor[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    actors.forEach(a => {
      if (!a.alive || a.faction !== 'enemy' || !a.intent) return;
      const i: Intent = a.intent;
      if (i.kind !== 'move') return;
      const from = this.tileCentre(a.renderTile ?? a.tile);
      const to = this.tileCentre(i.to);
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const inset = s * 0.26;
      const ex = to.x - Math.cos(ang) * inset;
      const ey = to.y - Math.sin(ang) * inset;

      ctx.save();
      ctx.strokeStyle = 'rgba(240,164,74,0.75)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = this.cfg.reducedMotion ? 0 : -this.time * 14;
      ctx.beginPath();
      ctx.moveTo(from.x + Math.cos(ang) * s * 0.3, from.y + Math.sin(ang) * s * 0.3);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();

      // Tapered head.
      const head = s * 0.21;
      ctx.fillStyle = 'rgba(240,164,74,0.95)';
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * head, ey + Math.sin(ang) * head);
      ctx.lineTo(ex - Math.cos(ang - 0.5) * head, ey - Math.sin(ang - 0.5) * head);
      ctx.lineTo(ex - Math.cos(ang) * head * 0.3, ey - Math.sin(ang) * head * 0.3);
      ctx.lineTo(ex - Math.cos(ang + 0.5) * head, ey - Math.sin(ang + 0.5) * head);
      ctx.closePath();
      ctx.fill();
    });
  }

  // --- Actors ---------------------------------------------------

  private tweenActors(actors: Actor[], dtMs: number): void {
    actors.forEach(a => {
      if (!a.renderTile) { a.renderTile = { ...a.tile }; a.renderT = 1; return; }
      const dx = a.tile.x - a.renderTile.x;
      const dy = a.tile.y - a.renderTile.y;
      if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) {
        a.renderTile.x = a.tile.x;
        a.renderTile.y = a.tile.y;
      } else if (this.cfg.reducedMotion) {
        a.renderTile.x = a.tile.x;
        a.renderTile.y = a.tile.y;
      } else {
        // Framerate-independent eased approach, not a linear lerp.
        const k = 1 - Math.pow(0.0016, dtMs / 1000);
        a.renderTile.x += dx * k;
        a.renderTile.y += dy * k;
      }
      if (a.flashMs > 0) a.flashMs = Math.max(0, a.flashMs - dtMs);
      if (!a.alive && a.deathAnimMs > 0) a.deathAnimMs = Math.max(0, a.deathAnimMs - dtMs);
    });
  }

  private actorColour(a: Actor, snap: TacticalSnapshot): string {
    if (a.kind === 'player') return snap.form === 'bear' ? C.playerBear : C.player;
    if (a.kind === 'summon') return C.summon;
    if (a.flags.isBoss) return C.boss;
    if (a.flags.isElite) return C.elite;
    return ENEMY_HUE[a.defId ?? ''] ?? C.enemy;
  }

  /** A soft ellipse under every body: the cheapest cue that it is really there. */
  private drawContactShadow(a: Actor): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    const rt = a.renderTile ?? a.tile;
    const cx = this.originX + (rt.x + 0.5) * s;
    const cy = this.originY + (rt.y + 0.5) * s;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.05, cy + s * 0.26, s * 0.3, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawActor(a: Actor, snap: TacticalSnapshot): void {
    if (!a.alive && a.deathAnimMs <= 0) return;
    const ctx = this.ctx;
    const s = this.tileSize;
    const rt = a.renderTile ?? a.tile;
    const cx = this.originX + (rt.x + 0.5) * s;
    const cy = this.originY + (rt.y + 0.5) * s;
    const dying = !a.alive;
    const t = dying ? 1 - a.deathAnimMs / 420 : 0;
    const alpha = dying ? 1 - easeOutCubic(t) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (dying) {
      const k = 1 + easeOutQuint(t) * 0.55;
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }

    const base = this.actorColour(a, snap);
    const hit = a.flashMs > 0;
    const r = s * 0.33;

    if (a.kind === 'player') {
      // A soft aura keeps the player findable on a crowded board.
      ctx.save();
      const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.1);
      halo.addColorStop(0, `${base}44`);
      halo.addColorStop(1, `${base}00`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    if (a.kind === 'player') {
      if (snap.form === 'bear') this.polygonPath(cx, cy, r * 1.3, 6, Math.PI / 6);
      else this.polygonPath(cx, cy, r * 1.22, 4, Math.PI / 4);
    } else if (a.kind === 'summon') {
      this.polygonPath(cx, cy, r * 0.92, 3, -Math.PI / 2);
    } else {
      this.enemyPath(a, cx, cy, r);
    }

    // Lit from the upper left, like everything else on the board.
    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    if (hit) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#ffd9dc');
    } else {
      grad.addColorStop(0, shadeHex(base, 0.26));
      grad.addColorStop(0.55, base);
      grad.addColorStop(1, shadeHex(base, -0.34));
    }
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = 'rgba(6,8,13,0.75)';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.stroke();

    // Rim light along the lit edge.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = Math.max(1.5, s * 0.055);
    ctx.beginPath();
    ctx.arc(cx - r * 0.18, cy - r * 0.18, r * 1.05, Math.PI * 0.75, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();

    if (a.alive && (a.facing.x !== 0 || a.facing.y !== 0)) {
      const fl = Math.hypot(a.facing.x, a.facing.y) || 1;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(
        cx + (a.facing.x / fl) * r * 1.08,
        cy + (a.facing.y / fl) * r * 1.08,
        Math.max(1.6, s * 0.05), 0, Math.PI * 2,
      );
      ctx.fill();
    }

    if (a.alive) {
      this.drawHealth(a, cx, cy, s);
      this.drawStatusPips(a, cx, cy, s);
      if (a.flags.isBoss || a.flags.isElite) this.drawRank(a, cx, cy, s);
    }

    ctx.restore();
  }

  private polygonPath(cx: number, cy: number, r: number, sides: number, rot: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** One silhouette per archetype: threat type reads by shape alone. */
  private enemyPath(a: Actor, cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    switch (a.defId) {
      case 'skeleton_chaser':
        this.polygonPath(cx, cy, r, 3, -Math.PI / 2);
        break;
      case 'mushroom_spitter':
        ctx.arc(cx, cy - r * 0.12, r * 0.95, Math.PI, 0);
        ctx.lineTo(cx + r * 0.38, cy + r * 0.82);
        ctx.lineTo(cx - r * 0.38, cy + r * 0.82);
        ctx.closePath();
        break;
      case 'stone_golem': {
        const k = r * 0.96;
        this.roundRectPath(ctx, cx - k, cy - k, k * 2, k * 2, r * 0.22);
        break;
      }
      case 'shadow_imp':
        this.polygonPath(cx, cy, r, 4, 0);
        break;
      case 'toxic_shroom':
        this.polygonPath(cx, cy, r, 5, -Math.PI / 2);
        break;
      default:
        this.polygonPath(cx, cy, r * 1.18, 6, 0);
    }
  }

  private drawHealth(a: Actor, cx: number, cy: number, s: number): void {
    const ctx = this.ctx;
    const w = s * 0.7;
    const h = Math.max(3, s * 0.08);
    const x = cx - w / 2;
    const y = cy + s * 0.37;
    const frac = Math.max(0, Math.min(1, a.hp / a.maxHp));
    const full = frac >= 0.999;

    ctx.save();
    // An untouched enemy needs less ink than a wounded one.
    ctx.globalAlpha = full ? 0.4 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this.roundRect(ctx, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2);
    ctx.fill();
    ctx.fillStyle = a.faction === 'player'
      ? (frac < 0.35 ? '#f2545b' : '#5ec47d')
      : (frac < 0.35 ? '#ffb3a7' : '#f2545b');
    this.roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2);
    ctx.fill();
    ctx.restore();

    const shield = Number(a.flags.shieldHp ?? 0);
    if (shield > 0) {
      ctx.fillStyle = '#64b5f6';
      this.roundRect(ctx, x, y - h - 2, Math.min(w, (shield / a.maxHp) * w), h * 0.75, h / 3);
      ctx.fill();
    }

    // The exact number: "can I kill this in one hit" should not be estimated.
    if (a.faction === 'enemy' && s >= 26) {
      const n = `${Math.ceil(a.hp)}`;
      ctx.font = `700 ${Math.round(s * 0.25)}px ${FONT_NUM}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(n, cx, y + h + 3);
      ctx.fillStyle = frac < 0.35 ? '#ffb3a7' : C.dim;
      ctx.fillText(n, cx, y + h + 3);
    }
  }

  private drawStatusPips(a: Actor, cx: number, cy: number, s: number): void {
    const ids = (Object.keys(a.statuses) as (keyof typeof STATUSES)[])
      .filter(id => (a.statuses[id]?.stacks ?? 0) > 0);
    if (!ids.length) return;
    const ctx = this.ctx;
    const d = Math.max(9, s * 0.21);
    let x = cx - (ids.length * (d + 2) - 2) / 2;
    const y = cy - s * 0.46;

    ids.forEach(id => {
      const st = a.statuses[id]!;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.arc(x + d / 2, y, d * 0.5 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = STATUSES[id].colour;
      ctx.beginPath();
      ctx.arc(x + d / 2, y, d * 0.44, 0, Math.PI * 2);
      ctx.fill();
      if (st.stacks > 1 && d >= 10) {
        ctx.fillStyle = '#0b0e14';
        ctx.font = `700 ${Math.round(d * 0.6)}px ${FONT_NUM}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${st.stacks}`, x + d / 2, y + 0.5);
      }
      x += d + 2;
    });
  }

  private drawRank(a: Actor, cx: number, cy: number, s: number): void {
    const ctx = this.ctx;
    const txt = a.flags.isBoss ? 'BOSS' : 'ELITE';
    ctx.font = `700 ${Math.round(s * 0.21)}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(txt).width + 8;
    const h = Math.round(s * 0.26);
    const y = cy - s * 0.56;
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    this.roundRect(ctx, cx - w / 2, y - h, w, h, 2);
    ctx.fill();
    ctx.fillStyle = a.flags.isBoss ? C.boss : C.elite;
    ctx.fillText(txt, cx, y - h * 0.18);
  }

  // --- Effects --------------------------------------------------

  private ingestEffects(effects: VisualEffect[]): void {
    effects.forEach(e => {
      if (this.seenEffects.has(e.id)) return;
      this.seenEffects.add(e.id);
      if (e.kind === 'text' && e.tile && e.text) {
        const c = this.tileCentre(e.tile);
        const big = /^\d+$/.test(e.text) && parseInt(e.text, 10) >= 15;
        this.floats.push({
          x: c.x + (Math.random() - 0.5) * this.tileSize * 0.35,
          y: c.y - this.tileSize * 0.2,
          vx: (Math.random() - 0.5) * 14,
          text: e.text, colour: e.colour, age: 0, life: e.lifeMs, big,
        });
      }
      if (e.kind === 'burst') this.bump(6);
      else if (e.kind === 'slash') this.bump(4);
    });
    if (this.seenEffects.size > 800) this.seenEffects.clear();
  }

  private drawEffects(effects: VisualEffect[], dtMs: number): void {
    const ctx = this.ctx;
    const s = this.tileSize;

    effects.forEach(e => {
      e.ageMs += dtMs;
      const raw = Math.min(1, e.ageMs / e.lifeMs);
      if (raw >= 1) return;
      const t = easeOutCubic(raw);
      const fade = 1 - raw * raw;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = e.colour;
      ctx.fillStyle = e.colour;
      ctx.lineCap = 'round';

      if ((e.kind === 'tracer' || e.kind === 'shove') && e.from && e.to) {
        const a = this.tileCentre(e.from);
        const b = this.tileCentre(e.to);
        const hx = a.x + (b.x - a.x) * Math.min(1, t * 1.8);
        const hy = a.y + (b.y - a.y) * Math.min(1, t * 1.8);
        // Tapered streak with a bright head.
        const g = ctx.createLinearGradient(a.x, a.y, hx, hy);
        g.addColorStop(0, `${e.colour}00`);
        g.addColorStop(1, e.colour);
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(2, s * 0.08);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = fade * 0.9;
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(1.5, s * 0.05), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'ring' && e.tile) {
        const c = this.tileCentre(e.tile);
        const rad = s * (0.3 + (e.radius ?? 1) * t);
        ctx.lineWidth = Math.max(2, s * 0.08) * (1 - raw * 0.6);
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = fade * 0.16;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'burst' && e.tile) {
        const c = this.tileCentre(e.tile);
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + (e.id.length % 7) * 0.2;
          const d = s * (0.12 + t * 0.62);
          const rr = Math.max(1, s * 0.06 * (1 - raw));
          ctx.beginPath();
          ctx.arc(c.x + Math.cos(ang) * d, c.y + Math.sin(ang) * d, rr, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.kind === 'slash' && e.tile) {
        const c = this.tileCentre(e.tile);
        ctx.lineWidth = Math.max(3, s * 0.12) * (1 - raw);
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.46, -1.1 + t * 2.4, 0.4 + t * 2.4);
        ctx.stroke();
      }
      ctx.restore();
    });

    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i].ageMs >= effects[i].lifeMs) effects.splice(i, 1);
    }
  }

  private drawFloats(dtMs: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += dtMs;
      const t = f.age / f.life;
      if (t >= 1) { this.floats.splice(i, 1); continue; }
      const rise = easeOutQuint(t) * this.tileSize * 0.85;
      const x = f.x + f.vx * t;
      const y = f.y - rise;
      // A brief overshoot on arrival gives the number some impact.
      const pop = t < 0.14 ? 1 + (0.14 - t) * 2.2 : 1;
      const size = Math.round(this.tileSize * (f.big ? 0.42 : 0.34) * pop);

      ctx.globalAlpha = Math.min(1, (1 - t) * 1.6);
      ctx.font = `700 ${size}px ${FONT_NUM}`;
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.colour;
      ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  // --- Primitives -----------------------------------------------

  private roundRect(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  ): void {
    ctx.beginPath();
    this.roundRectPath(ctx, x, y, w, h, r);
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

/** Lighten or darken a #rrggbb colour. Local, so the renderer stands alone. */
function shadeHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${ch.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export { tileKey };
