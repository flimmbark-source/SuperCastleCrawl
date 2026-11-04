// ============================================================
// Glyphdelve - Tactical Renderer
//
// Draws the whole room at once, always. Fitting the board to the viewport
// rather than following a camera is a design decision, not a convenience:
// perfect information is a pillar, and you cannot plan around a telegraph
// you have to scroll to see.
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

/** What the UI wants highlighted this frame. */
export interface RenderOverlay {
  hoverTile: Tile | null;
  /** Tiles the pending action would affect. */
  previewTiles: Tile[];
  /** Legal move destinations, with their Beat cost. */
  moveOptions: { tile: Tile; cost: number }[];
  /** Enemy tiles the player can hit right now. */
  attackTargets: Tile[];
  /** Threatened tiles, keyed by "x,y". */
  threat: Map<string, { damage: number; sources: string[] }>;
  showMoveHints: boolean;
}

const C = {
  bg: '#0b0e14',
  floorA: '#1c2331',
  floorB: '#212a3b',
  grid: 'rgba(255,255,255,0.055)',
  wall: '#4a5570',
  wallTop: '#6b7a9c',
  bramble: '#27412a',
  brambleLine: '#4e8054',
  chasm: '#04060a',
  chasmRim: '#2a3147',
  player: '#4fc3f7',
  playerBear: '#ffb74d',
  enemy: '#ef5350',
  elite: '#ff8a65',
  boss: '#ce93d8',
  summon: '#81c784',
  threat: 'rgba(239,83,80,0.22)',
  threatEdge: 'rgba(239,83,80,0.75)',
  moveHint: 'rgba(79,195,247,0.14)',
  moveEdge: 'rgba(79,195,247,0.45)',
  preview: 'rgba(255,213,79,0.26)',
  previewEdge: 'rgba(255,213,79,0.85)',
  hp: '#66bb6a',
  hpLow: '#ef5350',
  text: '#dfe6f2',
  dim: '#7c8699',
};

/**
 * One hue per archetype. Shape already distinguishes them; hue lets the player
 * read the composition of a pack at a glance without counting silhouettes.
 */
const ENEMY_HUE: Record<string, string> = {
  skeleton_chaser: '#ef5350',   // fast melee
  mushroom_spitter: '#ba68c8',  // ranged
  stone_golem: '#8d6e63',       // heavy
  shadow_imp: '#7e57c2',        // very fast
  toxic_shroom: '#9ccc65',      // hazards
};

interface FloatText { x: number; y: number; text: string; colour: string; age: number; life: number }

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
  private pulse = 0;

  constructor(canvas: HTMLCanvasElement, cfg: RenderConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.cfg = cfg;
  }

  updateConfig(cfg: RenderConfig): void { this.cfg = cfg; }

  bump(amount = 5): void {
    if (!this.cfg.screenShake || this.cfg.reducedMotion) return;
    this.shake = Math.max(this.shake, amount);
  }

  /** Convert a pointer position to a tile, or null if outside the board. */
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

  private resize(grid: Grid): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || 960;
    const cssH = this.canvas.clientHeight || 640;
    if (this.canvas.width !== Math.round(cssW * dpr) ||
        this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Reserve the HUD rails. The board is centred in what is left rather than
    // in the window, so no tile can ever hide beneath a panel.
    const narrow = cssW < 1100;
    const insetL = narrow ? 16 : 216;
    const insetR = narrow ? 16 : 232;
    const insetT = 16;
    const insetB = 108; // action bar
    const availW = Math.max(120, cssW - insetL - insetR);
    const availH = Math.max(120, cssH - insetT - insetB);
    this.tileSize = Math.max(16, Math.floor(Math.min(availW / grid.w, availH / grid.h)));
    this.originX = Math.round(insetL + (availW - grid.w * this.tileSize) / 2);
    this.originY = Math.round(insetT + (availH - grid.h * this.tileSize) / 2);
  }

  render(snap: TacticalSnapshot, overlay: RenderOverlay, dtMs: number): void {
    const { grid } = snap;
    this.resize(grid);
    const ctx = this.ctx;
    const cssW = this.canvas.clientWidth || 960;
    const cssH = this.canvas.clientHeight || 640;

    this.pulse += dtMs / 1000;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dtMs * 0.03);
    }

    this.drawTerrain(grid);
    this.drawHazards(snap.hazards);
    if (overlay.showMoveHints) this.drawMoveHints(overlay);
    this.drawThreat(overlay.threat, grid);
    this.drawPreview(overlay.previewTiles);
    this.drawIntentArrows(snap.actors);
    this.drawHover(overlay.hoverTile, grid);
    this.drawAttackTargets(overlay.attackTargets);

    this.tweenActors(snap.actors, dtMs);
    snap.actors
      .slice()
      .sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? 1 : -1))
      .forEach(a => this.drawActor(a, snap));

    this.ingestEffects(snap.effects);
    this.drawEffects(snap.effects, dtMs);
    this.drawFloats(dtMs);

    ctx.restore();
  }

  // --- Terrain --------------------------------------------------

  private drawTerrain(grid: Grid): void {
    const ctx = this.ctx;
    const s = this.tileSize;

    grid.forEach((x, y, t) => {
      const px = this.originX + x * s;
      const py = this.originY + y * s;

      if (t === 'chasm') {
        ctx.fillStyle = C.chasm;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = C.chasmRim;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
        // Lit top lip, so the tile reads as an edge you could fall over.
        ctx.strokeStyle = 'rgba(126,87,194,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + 2, py + 2);
        ctx.lineTo(px + s - 2, py + 2);
        ctx.stroke();
        // Inner void gradient reads as depth without costing readability.
        const g = ctx.createRadialGradient(px + s / 2, py + s / 2, 1, px + s / 2, py + s / 2, s * 0.6);
        g.addColorStop(0, 'rgba(0,0,0,0.9)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px, py, s, s);
        if (this.cfg.colorblindMode) this.glyph(px, py, s, '▽', 'rgba(180,190,210,0.5)');
        return;
      }

      if (t === 'wall') {
        // Drawn as a raised block: lit top face, shadowed base, hard outline.
        ctx.fillStyle = C.wall;
        ctx.fillRect(px, py, s, s);
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(px, py, s, Math.max(3, s * 0.2));
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px, py + s - Math.max(2, s * 0.12), s, Math.max(2, s * 0.12));
        ctx.strokeStyle = 'rgba(8,10,16,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
        return;
      }

      // Floor: subtle checker so distances are countable at a glance.
      ctx.fillStyle = (x + y) % 2 === 0 ? C.floorA : C.floorB;
      ctx.fillRect(px, py, s, s);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

      if (t === 'bramble') {
        ctx.fillStyle = C.bramble;
        ctx.fillRect(px, py, s, s);
        // Cross-hatch, so bramble is distinct by texture and not hue alone.
        // Clip first, then build the hatch path: starting a new path after
        // building it discards it, which is why this used to render flat.
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, s, s);
        ctx.clip();
        ctx.strokeStyle = C.brambleLine;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = -s; i < s; i += Math.max(5, s / 4.5)) {
          ctx.moveTo(px + i, py);
          ctx.lineTo(px + i + s, py + s);
          ctx.moveTo(px + i + s, py);
          ctx.lineTo(px + i, py + s);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = 'rgba(78,128,84,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
      }
    });
  }

  private glyph(px: number, py: number, s: number, ch: string, colour: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = colour;
    ctx.font = `${Math.round(s * 0.42)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, px + s / 2, py + s / 2);
  }

  private drawHazards(hazards: HazardZone[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    hazards.forEach(h => {
      const px = this.originX + h.tile.x * s;
      const py = this.originY + h.tile.y * s;
      const a = 0.18 + 0.08 * Math.sin(this.pulse * 3 + h.tile.x);
      ctx.fillStyle = h.colour;
      ctx.globalAlpha = this.cfg.reducedMotion ? 0.22 : a;
      ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = h.colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(px + 2.5, py + 2.5, s - 5, s - 5);
      ctx.setLineDash([]);
    });
  }

  // --- Overlays -------------------------------------------------

  private drawMoveHints(o: RenderOverlay): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    o.moveOptions.forEach(({ tile, cost }) => {
      const px = this.originX + tile.x * s;
      const py = this.originY + tile.y * s;
      ctx.fillStyle = C.moveHint;
      ctx.fillRect(px + 3, py + 3, s - 6, s - 6);
      ctx.strokeStyle = C.moveEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 3.5, py + 3.5, s - 7, s - 7);
      if (s >= 26) {
        // The Beat price is written on the tile: the cost is never hidden.
        ctx.fillStyle = 'rgba(79,195,247,0.85)';
        ctx.font = `${Math.round(s * 0.26)}px monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${cost}`, px + s - 4, py + s - 3);
      }
    });
  }

  private drawThreat(threat: Map<string, { damage: number; sources: string[] }>, grid: Grid): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    threat.forEach((info, key) => {
      const [x, y] = key.split(',').map(Number);
      if (!grid.inBounds(x, y)) return;
      const px = this.originX + x * s;
      const py = this.originY + y * s;

      ctx.fillStyle = C.threat;
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

      // Hatching so the threat reads without relying on hue alone.
      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 1, py + 1, s - 2, s - 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(239,83,80,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -s; i < s; i += 7) {
        ctx.moveTo(px + i, py);
        ctx.lineTo(px + i + s, py + s);
      }
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = C.threatEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);

      if (s >= 24) {
        // Exact incoming damage, printed on the tile.
        const label = `${info.damage}`;
        ctx.font = `bold ${Math.round(s * 0.32)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, px + s / 2, py + s / 2);
        ctx.fillStyle = '#ffcdd2';
        ctx.fillText(label, px + s / 2, py + s / 2);
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
      ctx.fillStyle = C.preview;
      ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
      ctx.strokeStyle = C.previewEdge;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(px + 2.5, py + 2.5, s - 5, s - 5);
      ctx.setLineDash([]);
    });
  }

  private drawAttackTargets(tiles: Tile[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    tiles.forEach(t => {
      const { x, y } = this.tileCentre(t);
      const r = s * 0.44;
      ctx.strokeStyle = 'rgba(255,213,79,0.8)';
      ctx.lineWidth = 2;
      // Reticle corners: reads as "targetable" without filling the tile.
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.moveTo(x + cx * r, y + cy * r - cy * r * 0.45);
        ctx.lineTo(x + cx * r, y + cy * r);
        ctx.lineTo(x + cx * r - cx * r * 0.45, y + cy * r);
        ctx.stroke();
      });
    });
  }

  private drawHover(t: Tile | null, grid: Grid): void {
    if (!t || !grid.inBounds(t.x, t.y)) return;
    const ctx = this.ctx;
    const s = this.tileSize;
    const px = this.originX + t.x * s;
    const py = this.originY + t.y * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
  }

  /** Movement intents get an arrow; the player can see where things are going. */
  private drawIntentArrows(actors: Actor[]): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    actors.forEach(a => {
      if (!a.alive || a.faction !== 'enemy' || !a.intent) return;
      const i: Intent = a.intent;
      if (i.kind !== 'move') return;
      const from = this.tileCentre(a.tile);
      const to = this.tileCentre(i.to);
      ctx.strokeStyle = 'rgba(255,183,77,0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const head = s * 0.2;
      ctx.fillStyle = 'rgba(255,183,77,0.9)';
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - Math.cos(ang - 0.4) * head, to.y - Math.sin(ang - 0.4) * head);
      ctx.lineTo(to.x - Math.cos(ang + 0.4) * head, to.y - Math.sin(ang + 0.4) * head);
      ctx.closePath();
      ctx.fill();
    });
  }

  // --- Actors ---------------------------------------------------

  private tweenActors(actors: Actor[], dtMs: number): void {
    const rate = this.cfg.reducedMotion ? 1 : Math.min(1, dtMs / 90);
    actors.forEach(a => {
      if (!a.renderTile) { a.renderTile = { ...a.tile }; return; }
      a.renderTile.x += (a.tile.x - a.renderTile.x) * rate;
      a.renderTile.y += (a.tile.y - a.renderTile.y) * rate;
      if (Math.abs(a.renderTile.x - a.tile.x) < 0.01) a.renderTile.x = a.tile.x;
      if (Math.abs(a.renderTile.y - a.tile.y) < 0.01) a.renderTile.y = a.tile.y;
      if (a.flashMs > 0) a.flashMs = Math.max(0, a.flashMs - dtMs);
      if (!a.alive && a.deathAnimMs > 0) a.deathAnimMs = Math.max(0, a.deathAnimMs - dtMs);
    });
  }

  private drawActor(a: Actor, snap: TacticalSnapshot): void {
    if (!a.alive && a.deathAnimMs <= 0) return;
    const ctx = this.ctx;
    const s = this.tileSize;
    const rt = a.renderTile ?? a.tile;
    const cx = this.originX + (rt.x + 0.5) * s;
    const cy = this.originY + (rt.y + 0.5) * s;
    const dying = !a.alive;
    const alpha = dying ? Math.max(0, a.deathAnimMs / 420) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (dying) {
      ctx.translate(cx, cy);
      ctx.scale(1 + (1 - alpha) * 0.5, 1 + (1 - alpha) * 0.5);
      ctx.translate(-cx, -cy);
    }

    let colour = C.enemy;
    if (a.kind === 'player') colour = snap.form === 'bear' ? C.playerBear : C.player;
    else if (a.kind === 'summon') colour = C.summon;
    else if (a.flags.isBoss) colour = C.boss;
    else if (a.flags.isElite) colour = C.elite;
    else colour = ENEMY_HUE[a.defId ?? ''] ?? C.enemy;

    if (a.flashMs > 0) colour = '#ffffff';

    const r = s * 0.33;
    ctx.fillStyle = colour;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;

    if (a.kind === 'player') {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (snap.form === 'bear') this.polygon(cx, cy, r * 1.3, 6, Math.PI / 6);
      else this.polygon(cx, cy, r * 1.2, 4, Math.PI / 4);
    } else if (a.kind === 'summon') {
      this.polygon(cx, cy, r * 0.85, 3, -Math.PI / 2);
    } else {
      this.enemyShape(a, cx, cy, r);
    }
    ctx.fill();
    ctx.stroke();

    // Facing nub: tiny, but it tells you which way a cleave will land.
    if (a.alive && (a.facing.x !== 0 || a.facing.y !== 0)) {
      const fl = Math.hypot(a.facing.x, a.facing.y) || 1;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(cx + (a.facing.x / fl) * r * 1.05, cy + (a.facing.y / fl) * r * 1.05, Math.max(1.5, s * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }

    if (a.alive) {
      this.drawHealthBar(a, cx, cy, s);
      this.drawStatusPips(a, cx, cy, s);
      if (a.flags.isBoss || a.flags.isElite) this.drawRank(a, cx, cy, s);
    }

    ctx.restore();
  }

  private polygon(cx: number, cy: number, r: number, sides: number, rot: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** One silhouette per archetype, so threat type is readable by shape alone. */
  private enemyShape(a: Actor, cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    switch (a.defId) {
      case 'skeleton_chaser': this.polygon(cx, cy, r, 3, -Math.PI / 2); break;
      case 'mushroom_spitter': {
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.15, r * 0.9, Math.PI, 0);
        ctx.lineTo(cx + r * 0.35, cy + r * 0.8);
        ctx.lineTo(cx - r * 0.35, cy + r * 0.8);
        ctx.closePath();
        break;
      }
      case 'stone_golem': {
        ctx.beginPath();
        ctx.rect(cx - r * 0.95, cy - r * 0.95, r * 1.9, r * 1.9);
        ctx.closePath();
        break;
      }
      case 'shadow_imp': this.polygon(cx, cy, r, 4, 0); break;
      case 'toxic_shroom': this.polygon(cx, cy, r, 5, -Math.PI / 2); break;
      default: this.polygon(cx, cy, r * 1.15, 6, 0);
    }
  }

  private drawHealthBar(a: Actor, cx: number, cy: number, s: number): void {
    const ctx = this.ctx;
    const w = s * 0.72;
    const h = Math.max(3, s * 0.085);
    const x = cx - w / 2;
    const y = cy + s * 0.38;
    const frac = Math.max(0, Math.min(1, a.hp / a.maxHp));
    const full = frac >= 0.999;

    ctx.save();
    // An untouched enemy needs less ink than a wounded one.
    ctx.globalAlpha = full ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = a.faction === 'player' ? (frac < 0.35 ? C.hpLow : C.hp)
      : (frac < 0.35 ? '#ffab91' : C.enemy);
    ctx.fillRect(x, y, w * frac, h);
    ctx.restore();

    const shield = Number(a.flags.shieldHp ?? 0);
    if (shield > 0) {
      ctx.fillStyle = '#64b5f6';
      ctx.fillRect(x, y - h - 1, Math.min(w, (shield / a.maxHp) * w), h * 0.7);
    }

    // The exact number, so the player can work out lethality instead of
    // estimating it from a bar.
    if (a.faction === 'enemy' && s >= 26) {
      const n = `${Math.ceil(a.hp)}`;
      ctx.font = `bold ${Math.round(s * 0.26)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(n, cx, y + h + 2);
      ctx.fillStyle = frac < 0.35 ? '#ffab91' : C.dim;
      ctx.fillText(n, cx, y + h + 2);
    }
  }

  private drawStatusPips(a: Actor, cx: number, cy: number, s: number): void {
    const ids = Object.keys(a.statuses) as (keyof typeof STATUSES)[];
    if (!ids.length) return;
    const ctx = this.ctx;
    const size = Math.max(7, s * 0.2);
    let x = cx - (ids.length * size) / 2;
    const y = cy - s * 0.5;
    ids.forEach(id => {
      const st = a.statuses[id];
      if (!st) return;
      ctx.fillStyle = STATUSES[id].colour;
      ctx.beginPath();
      ctx.arc(x + size / 2, y, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      if (st.stacks > 1 && size >= 9) {
        ctx.fillStyle = '#0b0e14';
        ctx.font = `bold ${Math.round(size * 0.62)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${st.stacks}`, x + size / 2, y + 0.5);
      }
      x += size;
    });
  }

  private drawRank(a: Actor, cx: number, cy: number, s: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = a.flags.isBoss ? C.boss : C.elite;
    ctx.font = `bold ${Math.round(s * 0.24)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(a.flags.isBoss ? 'BOSS' : 'ELITE', cx, cy - s * 0.58);
  }

  // --- Effects --------------------------------------------------

  private ingestEffects(effects: VisualEffect[]): void {
    effects.forEach(e => {
      if (this.seenEffects.has(e.id)) return;
      this.seenEffects.add(e.id);
      if (e.kind === 'text' && e.tile && e.text) {
        const c = this.tileCentre(e.tile);
        this.floats.push({
          x: c.x + (Math.random() - 0.5) * this.tileSize * 0.4,
          y: c.y - this.tileSize * 0.15,
          text: e.text, colour: e.colour, age: 0, life: e.lifeMs,
        });
      }
      if (e.kind === 'burst' || e.kind === 'slash') this.bump(4);
    });
    if (this.seenEffects.size > 600) this.seenEffects.clear();
  }

  private drawEffects(effects: VisualEffect[], dtMs: number): void {
    const ctx = this.ctx;
    const s = this.tileSize;
    effects.forEach(e => {
      e.ageMs += dtMs;
      const t = Math.min(1, e.ageMs / e.lifeMs);
      if (t >= 1) return;
      const fade = 1 - t;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = e.colour;
      ctx.fillStyle = e.colour;
      ctx.lineWidth = 2.5;

      if ((e.kind === 'tracer' || e.kind === 'shove') && e.from && e.to) {
        const a = this.tileCentre(e.from);
        const b = this.tileCentre(e.to);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * Math.min(1, t * 2.4), a.y + (b.y - a.y) * Math.min(1, t * 2.4));
        ctx.stroke();
      } else if (e.kind === 'ring' && e.tile) {
        const c = this.tileCentre(e.tile);
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * (0.35 + (e.radius ?? 1) * t), 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'burst' && e.tile) {
        const c = this.tileCentre(e.tile);
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2;
          const d = s * (0.2 + t * 0.55);
          ctx.beginPath();
          ctx.arc(c.x + Math.cos(ang) * d, c.y + Math.sin(ang) * d, Math.max(1, s * 0.055 * fade), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.kind === 'slash' && e.tile) {
        const c = this.tileCentre(e.tile);
        ctx.lineWidth = 4 * fade;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.45, -0.9 + t * 2.2, 0.5 + t * 2.2);
        ctx.stroke();
      }
      ctx.restore();
    });

    // Drop finished effects so the array cannot grow without bound.
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
      const y = f.y - t * this.tileSize * 0.75;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `bold ${Math.round(this.tileSize * 0.36)}px monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.colour;
      ctx.fillText(f.text, f.x, y);
      ctx.globalAlpha = 1;
    }
  }
}

export { tileKey };
