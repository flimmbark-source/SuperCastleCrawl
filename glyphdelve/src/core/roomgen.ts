// ============================================================
// Glyphdelve - Room Generation
//
// Builds the tactical arena for a node. Rooms are small and readable
// on purpose: the player must be able to take in the whole board at a
// glance, because perfect information is a design pillar.
// ============================================================

import { SeededRNG } from '../engine/SeededRNG';
import type { NodeType } from '../types';
import {
  Grid, floodFill, tileKey, tileDist, tilesInRadius,
} from './grid';
import type { Tile, Terrain } from './grid';

export const ROOM_W = 17;
export const ROOM_H = 13;

export interface GeneratedRoom {
  grid: Grid;
  playerSpawn: Tile;
  enemySpawns: Tile[];
  /** Human-readable layout name, surfaced in the HUD so rooms feel authored. */
  layoutName: string;
}

type LayoutId = 'open' | 'pillars' | 'thicket' | 'ravine' | 'crossroads' | 'gauntlet';

const LAYOUT_NAMES: Record<LayoutId, string> = {
  open: 'Open Hall',
  pillars: 'Pillared Vault',
  thicket: 'Overgrown Thicket',
  ravine: 'Cracked Ravine',
  crossroads: 'Collapsed Crossroads',
  gauntlet: 'Narrow Gauntlet',
};

/**
 * Layout weights per node type. Bosses get open-but-structured rooms so their
 * telegraphed attacks stay readable; elites get terrain that rewards using it.
 */
function layoutsFor(nodeType: NodeType): LayoutId[] {
  switch (nodeType) {
    case 'boss':
      return ['pillars', 'ravine', 'open'];
    case 'elite':
      return ['pillars', 'thicket', 'ravine', 'crossroads'];
    default:
      return ['pillars', 'thicket', 'ravine', 'crossroads', 'gauntlet', 'open'];
  }
}

export function generateRoom(
  rng: SeededRNG,
  nodeType: NodeType,
  floor: number,
  enemyCount: number,
): GeneratedRoom {
  const choices = layoutsFor(nodeType);
  // Retry until the room is connected and has room for everyone. Bounded so a
  // pathological seed degrades to a plain room instead of hanging.
  for (let attempt = 0; attempt < 24; attempt++) {
    const layout = rng.pick(choices);
    const room = buildLayout(rng, layout, floor, enemyCount);
    if (room) return room;
  }
  return buildOpenFallback(enemyCount);
}

function blankGrid(): Grid {
  const g = new Grid(ROOM_W, ROOM_H, 'floor');
  for (let x = 0; x < ROOM_W; x++) {
    g.set(x, 0, 'wall');
    g.set(x, ROOM_H - 1, 'wall');
  }
  for (let y = 0; y < ROOM_H; y++) {
    g.set(0, y, 'wall');
    g.set(ROOM_W - 1, y, 'wall');
  }
  return g;
}

function buildLayout(
  rng: SeededRNG,
  layout: LayoutId,
  floor: number,
  enemyCount: number,
): GeneratedRoom | null {
  const g = blankGrid();
  // Floor 2 rooms get denser terrain, so later fights ask harder spatial questions.
  const density = floor >= 2 ? 1.25 : 1.0;

  switch (layout) {
    case 'open':
      scatter(g, rng, 'bramble', Math.round(4 * density));
      break;

    case 'pillars': {
      // Regular grid of 1x1 and 2x1 blocks: lots of corners to break line of fire.
      for (let py = 2; py < ROOM_H - 2; py += 3) {
        for (let px = 3; px < ROOM_W - 2; px += 4) {
          const ox = rng.nextInt(-1, 1);
          g.set(px + ox, py, 'wall');
          if (rng.chance(0.45)) g.set(px + ox, py + 1, 'wall');
        }
      }
      scatter(g, rng, 'bramble', Math.round(3 * density));
      break;
    }

    case 'thicket': {
      // Big bramble clumps: sightlines are short, melee pressure is high.
      const clumps = Math.round(rng.nextInt(4, 6) * density);
      for (let i = 0; i < clumps; i++) {
        blob(g, rng, 'bramble', rng.nextInt(3, 6));
      }
      scatter(g, rng, 'wall', 3);
      break;
    }

    case 'ravine': {
      // A chasm band across the room, with crossings. Shove kills live here.
      const vertical = rng.chance(0.5);
      const at = vertical ? rng.nextInt(5, ROOM_W - 6) : rng.nextInt(4, ROOM_H - 5);
      const len = vertical ? ROOM_H : ROOM_W;
      const bridges = new Set<number>();
      const bridgeCount = rng.nextInt(2, 3);
      for (let i = 0; i < bridgeCount; i++) bridges.add(rng.nextInt(2, len - 3));
      for (let i = 1; i < len - 1; i++) {
        if (bridges.has(i) || bridges.has(i - 1)) continue;
        if (vertical) g.set(at, i, 'chasm');
        else g.set(i, at, 'chasm');
        if (rng.chance(0.35)) {
          if (vertical) g.set(at + 1, i, 'chasm');
          else g.set(i, at + 1, 'chasm');
        }
      }
      scatter(g, rng, 'bramble', Math.round(3 * density));
      break;
    }

    case 'crossroads': {
      // Two wall bands with gaps: distinct lanes you can be cut off in.
      const midY = Math.floor(ROOM_H / 2);
      const midX = Math.floor(ROOM_W / 2);
      for (let x = 2; x < ROOM_W - 2; x++) {
        if (Math.abs(x - midX) <= 1 || rng.chance(0.18)) continue;
        g.set(x, midY, 'wall');
      }
      for (let y = 2; y < ROOM_H - 2; y++) {
        if (Math.abs(y - midY) <= 1 || rng.chance(0.18)) continue;
        g.set(midX, y, 'wall');
      }
      scatter(g, rng, 'bramble', Math.round(5 * density));
      scatter(g, rng, 'chasm', Math.round(2 * density));
      break;
    }

    case 'gauntlet': {
      // Staggered barriers forcing lateral movement across the room.
      for (let i = 0; i < 3; i++) {
        const x = 4 + i * 4;
        const gapY = rng.nextInt(2, ROOM_H - 3);
        for (let y = 1; y < ROOM_H - 1; y++) {
          if (Math.abs(y - gapY) <= 1) continue;
          g.set(x, y, rng.chance(0.75) ? 'wall' : 'bramble');
        }
      }
      scatter(g, rng, 'chasm', Math.round(2 * density));
      break;
    }
  }

  // Player enters from the left edge; enemies hold the far side. This replaces
  // the old ring-spawn that dropped the player in the middle, surrounded.
  const playerSpawn = findOpenTile(g, rng, 1, 3, 1, ROOM_H - 2);
  if (!playerSpawn) return null;
  g.set(playerSpawn.x, playerSpawn.y, 'floor');

  const reach = floodFill(g, playerSpawn);

  const enemySpawns: Tile[] = [];
  const used = new Set<string>([tileKey(playerSpawn)]);
  const candidates: Tile[] = [];
  g.forEach((x, y) => {
    const t = { x, y };
    if (!g.isPassable(x, y)) return;
    if (!reach.has(tileKey(t))) return;
    // Far enough that the player gets a turn before anything reaches them.
    if (tileDist(t, playerSpawn) < 5) return;
    candidates.push(t);
  });

  if (candidates.length < enemyCount) return null;

  const shuffled = rng.shuffle(candidates);
  for (const c of shuffled) {
    if (enemySpawns.length >= enemyCount) break;
    const k = tileKey(c);
    if (used.has(k)) continue;
    // Spread enemies out so they arrive in waves rather than as one blob.
    if (enemySpawns.some(e => tileDist(e, c) < 2)) continue;
    used.add(k);
    enemySpawns.push(c);
  }

  if (enemySpawns.length < enemyCount) return null;

  // Every enemy must actually be able to reach the player, or the room stalls.
  for (const e of enemySpawns) {
    if (!reach.has(tileKey(e))) return null;
  }

  return { grid: g, playerSpawn, enemySpawns, layoutName: LAYOUT_NAMES[layout] };
}

function scatter(g: Grid, rng: SeededRNG, terrain: Terrain, count: number) {
  for (let i = 0; i < count; i++) {
    const x = rng.nextInt(2, ROOM_W - 3);
    const y = rng.nextInt(1, ROOM_H - 2);
    if (g.get(x, y) === 'floor') g.set(x, y, terrain);
  }
}

function blob(g: Grid, rng: SeededRNG, terrain: Terrain, size: number) {
  const cx = rng.nextInt(3, ROOM_W - 4);
  const cy = rng.nextInt(2, ROOM_H - 3);
  const cells = rng.shuffle(tilesInRadius(g, { x: cx, y: cy }, 2));
  for (let i = 0; i < Math.min(size, cells.length); i++) {
    const t = cells[i];
    if (t.x <= 0 || t.y <= 0 || t.x >= ROOM_W - 1 || t.y >= ROOM_H - 1) continue;
    if (g.get(t.x, t.y) === 'floor') g.set(t.x, t.y, terrain);
  }
}

function findOpenTile(
  g: Grid, rng: SeededRNG,
  x0: number, x1: number, y0: number, y1: number,
): Tile | null {
  const opts: Tile[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (g.isPassable(x, y)) opts.push({ x, y });
    }
  }
  if (!opts.length) return null;
  return rng.pick(opts);
}

/** Guaranteed-valid plain room, used only if generation keeps failing. */
function buildOpenFallback(enemyCount: number): GeneratedRoom {
  const g = blankGrid();
  const playerSpawn = { x: 2, y: Math.floor(ROOM_H / 2) };
  const enemySpawns: Tile[] = [];
  let x = ROOM_W - 3;
  let y = 2;
  while (enemySpawns.length < enemyCount) {
    enemySpawns.push({ x, y });
    y += 2;
    if (y >= ROOM_H - 2) { y = 2; x -= 2; }
    if (x <= 4) break;
  }
  return { grid: g, playerSpawn, enemySpawns, layoutName: LAYOUT_NAMES.open };
}
