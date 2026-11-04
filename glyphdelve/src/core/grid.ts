// ============================================================
// Glyphdelve - Tactical Grid
//
// Pure, headless, deterministic. No DOM, no renderer, no timers.
// All coordinates are TILE coordinates (integers). The renderer is
// the only thing that knows about pixels.
// ============================================================

export type Terrain =
  | 'floor'    // open ground
  | 'wall'     // blocks movement, line of fire, and sight
  | 'bramble'  // passable at +1 Beat, blocks line of fire (cover you can hide inside)
  | 'chasm';   // impassable; anything shoved in is destroyed

export interface Tile {
  x: number;
  y: number;
}

export interface TerrainInfo {
  id: Terrain;
  name: string;
  /** Can a walking actor enter this tile at all? */
  passable: boolean;
  /** Extra Beats charged on top of the base move cost. */
  moveCostPenalty: number;
  /** Does this stop projectiles and line of sight? */
  blocksLineOfFire: boolean;
  /** Is falling in here instantly fatal? */
  lethal: boolean;
  description: string;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  floor: {
    id: 'floor',
    name: 'Stone',
    passable: true,
    moveCostPenalty: 0,
    blocksLineOfFire: false,
    lethal: false,
    description: 'Open ground. Nothing to hide behind.',
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    passable: false,
    moveCostPenalty: 0,
    blocksLineOfFire: true,
    lethal: false,
    description: 'Solid rock. Blocks movement and line of fire.',
  },
  bramble: {
    id: 'bramble',
    name: 'Bramble',
    passable: true,
    moveCostPenalty: 1,
    blocksLineOfFire: true,
    lethal: false,
    description: 'Dense thicket. Costs +1 Beat to push through, but nothing can shoot you inside it.',
  },
  chasm: {
    id: 'chasm',
    name: 'Chasm',
    passable: false,
    moveCostPenalty: 0,
    blocksLineOfFire: false,
    lethal: true,
    description: 'A drop into darkness. Anything shoved in is gone for good.',
  },
};

export class Grid {
  readonly w: number;
  readonly h: number;
  private cells: Terrain[];
  /**
   * Bumped on every mutation. Lets caches (the renderer's terrain raster)
   * detect a change in O(1) instead of hashing the whole board each frame.
   */
  private _version = 0;

  constructor(w: number, h: number, fill: Terrain = 'floor') {
    this.w = w;
    this.h = h;
    this.cells = new Array(w * h).fill(fill);
  }

  get version(): number { return this._version; }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) return 'wall';
    return this.cells[y * this.w + x];
  }

  set(x: number, y: number, t: Terrain): void {
    if (!this.inBounds(x, y)) return;
    if (this.cells[y * this.w + x] === t) return;
    this.cells[y * this.w + x] = t;
    this._version++;
  }

  info(x: number, y: number): TerrainInfo {
    return TERRAIN[this.get(x, y)];
  }

  /** Can a walking actor stand here, ignoring other actors? */
  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && TERRAIN[this.get(x, y)].passable;
  }

  blocksLineOfFire(x: number, y: number): boolean {
    return !this.inBounds(x, y) || TERRAIN[this.get(x, y)].blocksLineOfFire;
  }

  isLethal(x: number, y: number): boolean {
    return this.inBounds(x, y) && TERRAIN[this.get(x, y)].lethal;
  }

  /** Extra Beats to step onto this tile. */
  moveCostPenalty(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return TERRAIN[this.get(x, y)].moveCostPenalty;
  }

  forEach(fn: (x: number, y: number, t: Terrain) => void): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        fn(x, y, this.cells[y * this.w + x]);
      }
    }
  }

  clone(): Grid {
    const g = new Grid(this.w, this.h);
    g.cells = [...this.cells];
    g._version = this._version;
    return g;
  }

  /** Serializable snapshot, used by tests and save/debug tooling. */
  toArray(): Terrain[] {
    return [...this.cells];
  }

  static fromArray(w: number, h: number, cells: Terrain[]): Grid {
    const g = new Grid(w, h);
    for (let i = 0; i < Math.min(cells.length, w * h); i++) {
      g.set(i % w, Math.floor(i / w), cells[i]);
    }
    return g;
  }
}

// --- Geometry -------------------------------------------------

export function tileEquals(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

export function tileKey(t: Tile): string {
  return `${t.x},${t.y}`;
}

/**
 * Chebyshev distance. The grid is 8-directional, so this is the number of
 * steps between two tiles and is what every "range" value in the game means.
 */
export function tileDist(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Straight-line distance; used only for tie-breaking and visuals. */
export function euclidDist(a: Tile, b: Tile): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const DIRECTIONS_8: Tile[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

export const DIRECTIONS_4: Tile[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
];

export function neighbors8(t: Tile): Tile[] {
  return DIRECTIONS_8.map(d => ({ x: t.x + d.x, y: t.y + d.y }));
}

/** Unit step (each component in -1..1) pointing from `from` toward `to`. */
export function stepToward(from: Tile, to: Tile): Tile {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

/**
 * Bresenham line between two tiles, inclusive of both endpoints.
 * Deterministic, which matters because line of fire feeds enemy intent.
 */
export function line(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  // Bounded so a malformed call can never hang the game loop.
  for (let guard = 0; guard < 512; guard++) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/**
 * Is there a clear line of fire from `from` to `to`?
 * Endpoints are exempt: standing in bramble does not stop you shooting out of
 * it, but it does stop anyone shooting into it (the target tile is checked by
 * the caller when it matters).
 */
export function hasLineOfFire(grid: Grid, from: Tile, to: Tile): boolean {
  const pts = line(from, to);
  for (let i = 1; i < pts.length - 1; i++) {
    if (grid.blocksLineOfFire(pts[i].x, pts[i].y)) return false;
  }
  return true;
}

/**
 * Can `from` shoot `to`? Adds the rule that bramble protects whoever is
 * standing in it, which is what makes bramble worth running to.
 */
export function canTarget(grid: Grid, from: Tile, to: Tile): boolean {
  if (grid.get(to.x, to.y) === 'bramble' && tileDist(from, to) > 1) return false;
  return hasLineOfFire(grid, from, to);
}

// --- Pathfinding ---------------------------------------------

export interface PathOptions {
  /** Tiles that are blocked by other actors. */
  occupied?: Set<string>;
  /** Treat the destination as reachable even if occupied (for melee approach). */
  ignoreOccupiedAtGoal?: boolean;
  maxNodes?: number;
}

/**
 * A* over the 8-way grid, weighted by Beat cost so enemies route around
 * bramble when it is not worth the time.
 * Returns the full path including the start tile, or null.
 */
export function findPath(
  grid: Grid,
  start: Tile,
  goal: Tile,
  opts: PathOptions = {},
): Tile[] | null {
  const occupied = opts.occupied ?? new Set<string>();
  const maxNodes = opts.maxNodes ?? 2000;
  const startKey = tileKey(start);
  const goalKey = tileKey(goal);

  if (tileEquals(start, goal)) return [start];

  const open: { key: string; t: Tile; f: number }[] = [
    { key: startKey, t: start, f: tileDist(start, goal) },
  ];
  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, Tile>();
  const closed = new Set<string>();
  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    // Small maps, so a linear scan beats the constant factor of a heap.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    if (closed.has(current.key)) continue;
    closed.add(current.key);
    expanded++;

    if (current.key === goalKey) {
      const path: Tile[] = [current.t];
      let k = current.key;
      while (cameFrom.has(k)) {
        const prev = cameFrom.get(k)!;
        path.push(prev);
        k = tileKey(prev);
      }
      return path.reverse();
    }

    for (const n of neighbors8(current.t)) {
      if (!grid.isPassable(n.x, n.y)) continue;
      const nKey = tileKey(n);
      if (closed.has(nKey)) continue;

      const isGoal = nKey === goalKey;
      if (occupied.has(nKey) && !(isGoal && opts.ignoreOccupiedAtGoal)) continue;

      // Diagonal moves may not cut a corner between two blocked tiles.
      const dx = n.x - current.t.x;
      const dy = n.y - current.t.y;
      if (dx !== 0 && dy !== 0) {
        if (!grid.isPassable(current.t.x + dx, current.t.y) &&
            !grid.isPassable(current.t.x, current.t.y + dy)) continue;
      }

      const tentative = (gScore.get(current.key) ?? Infinity) + 1 + grid.moveCostPenalty(n.x, n.y);
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentative);
        cameFrom.set(nKey, current.t);
        open.push({ key: nKey, t: n, f: tentative + tileDist(n, goal) });
      }
    }
  }
  return null;
}

/** All tiles reachable from `start` across passable terrain. Used to validate rooms. */
export function floodFill(grid: Grid, start: Tile): Set<string> {
  const seen = new Set<string>();
  if (!grid.isPassable(start.x, start.y)) return seen;
  const stack: Tile[] = [start];
  seen.add(tileKey(start));
  while (stack.length) {
    const t = stack.pop()!;
    for (const n of neighbors8(t)) {
      const k = tileKey(n);
      if (seen.has(k)) continue;
      if (!grid.isPassable(n.x, n.y)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen;
}

/** Tiles within `radius` (Chebyshev) of `center` that exist on the grid. */
export function tilesInRadius(grid: Grid, center: Tile, radius: number): Tile[] {
  const out: Tile[] = [];
  for (let y = center.y - radius; y <= center.y + radius; y++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      if (!grid.inBounds(x, y)) continue;
      if (tileDist(center, { x, y }) > radius) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** Tiles in a cone of `radius` opening in direction `dir` from `origin`. */
export function tilesInCone(grid: Grid, origin: Tile, dir: Tile, radius: number): Tile[] {
  const out: Tile[] = [];
  const dlen = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / dlen;
  const uy = dir.y / dlen;
  for (const t of tilesInRadius(grid, origin, radius)) {
    if (tileEquals(t, origin)) continue;
    const vx = t.x - origin.x;
    const vy = t.y - origin.y;
    const vlen = Math.hypot(vx, vy) || 1;
    // ~90 degree cone.
    if ((vx * ux + vy * uy) / vlen < 0.45) continue;
    if (!hasLineOfFire(grid, origin, t)) continue;
    out.push(t);
  }
  return out;
}
