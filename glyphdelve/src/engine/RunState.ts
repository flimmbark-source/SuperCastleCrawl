import type {
  RunState, PlayerEntity, FloorMap, MapNode, NodeType,
  Tag, CombatLogEntry,
} from '../types';
import { xpForLevel } from '../types';
import { SeededRNG } from './SeededRNG';
import { registry } from './DataRegistry';

export function createPlayer(): PlayerEntity {
  const transformSkill = registry.getSkill('bear_form_transform');

  const player: PlayerEntity = {
    id: 'player',
    type: 'player',
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    radius: 12,
    speed: 1,
    faction: 'player',
    tags: [],
    alive: true,
    invulnMs: 0,
    flashMs: 0,
    deathAnimMs: 0,
    animState: 'idle',
    rotation: 0,
    xp: 0,
    level: 1,
    xpToNext: xpForLevel(2),
    essence: 0,
    skills: [],
    passives: [],
    items: [],
    maxSkillSlots: 4,
    armor: 0,
    damageScalar: 1.0,
    attackSpeed: 1.0,
    resource: 50,
    maxResource: 50,
    buildTags: new Map(),
    inventory: [],
  };

  if (transformSkill) {
    player.skills.push({
      def: transformSkill,
      cooldownRemaining: 0,
      level: 1,
      upgraded: false,
    });
  }

  return player;
}

// ============================================================
// Branching floor maps
//
// The original build drew nine nodes in a straight line and called it a map:
// `connections` existed but drove no choice at all. A delve is now a small
// directed graph, so "do I take the elite for the loot or the spring for the
// health" is a real decision made before the fight, not after it.
// ============================================================

const COLUMNS = 7;

/** Node types eligible in the middle of a floor, with rough weights. */
const MIDDLE_TYPES: { type: NodeType; weight: number }[] = [
  { type: 'combat', weight: 42 },
  { type: 'event', weight: 18 },
  { type: 'elite', weight: 15 },
  { type: 'recovery', weight: 13 },
  { type: 'shrine', weight: 12 },
];

export function generateFloorMap(floor: number, rng: SeededRNG): FloorMap {
  // Column widths: narrow at the mouth, wide in the belly, one boss at the end.
  const widths: number[] = [1];
  for (let c = 1; c < COLUMNS - 1; c++) {
    widths.push(c === 1 || c === COLUMNS - 2 ? 2 : rng.nextInt(2, 3));
  }
  widths.push(1);

  const middleCount = widths.slice(1, COLUMNS - 1).reduce((a, b) => a + b, 0);

  // Build the floor's room list from quotas rather than rolling each node
  // independently. Unconstrained rolling produced floors with five elites and
  // no ordinary fights, which is a difficulty wall rather than a route.
  const quota: NodeType[] = [];
  const elites = floor >= 2 ? 3 : 2;
  const shrines = floor >= 2 ? 1 : 2;
  const springs = floor >= 2 ? 3 : 2;
  for (let i = 0; i < elites; i++) quota.push('elite');
  for (let i = 0; i < shrines; i++) quota.push('shrine');
  for (let i = 0; i < springs; i++) quota.push('recovery');
  while (quota.length < middleCount) {
    quota.push(rng.weightedPick(
      MIDDLE_TYPES.map(m => m.type), MIDDLE_TYPES.map(m => m.weight)));
  }
  const shuffled = rng.shuffle(quota).slice(0, middleCount);

  const nodes: MapNode[] = [];
  const byColumn: MapNode[][] = [];
  let index = 0;
  let middleIdx = 0;

  for (let c = 0; c < COLUMNS; c++) {
    const col: MapNode[] = [];
    for (let r = 0; r < widths[c]; r++) {
      let type: NodeType;
      if (c === 0) type = 'combat';
      else if (c === COLUMNS - 1) type = 'boss';
      else type = shuffled[middleIdx++] ?? 'combat';

      const node: MapNode = {
        id: `f${floor}c${c}r${r}`,
        floor, index: index++, column: c, row: r,
        type, completed: false, connections: [],
      };
      col.push(node);
      nodes.push(node);
    }
    byColumn.push(col);
  }

  // An elite immediately after the opening room is too sharp a spike; push any
  // that landed in column 1 further down the delve.
  nodes.filter(n => n.column === 1 && n.type === 'elite').forEach(n => {
    const swap = nodes.find(o => o.column >= 3 && o.column < COLUMNS - 1 && o.type !== 'elite' && o.type !== 'boss');
    if (swap) { n.type = swap.type; swap.type = 'elite'; }
  });

  void ensureType;

  // Wire the graph: every node reaches forward, every node is reachable.
  for (let c = 0; c < COLUMNS - 1; c++) {
    const from = byColumn[c];
    const to = byColumn[c + 1];

    from.forEach((n, i) => {
      // Map this node's slot onto the next column proportionally, then take
      // that target and optionally a neighbour, so routes fan out and rejoin.
      const centre = to.length === 1 ? 0
        : Math.min(to.length - 1, Math.round((i / Math.max(1, from.length - 1)) * (to.length - 1)));
      const picks = new Set<number>([centre]);
      if (to.length > 1 && rng.chance(0.55)) {
        picks.add(Math.max(0, Math.min(to.length - 1, centre + (rng.chance(0.5) ? 1 : -1))));
      }
      picks.forEach(p => n.connections.push(to[p].id));
    });

    // Anything in the next column nobody points at gets an inbound edge.
    to.forEach((t, j) => {
      if (from.some(n => n.connections.includes(t.id))) return;
      const centre = from.length === 1 ? 0
        : Math.min(from.length - 1, Math.round((j / Math.max(1, to.length - 1)) * (from.length - 1)));
      from[centre].connections.push(t.id);
    });
  }

  return { floor, nodes };
}

function ensureType(
  nodes: MapNode[], byColumn: MapNode[][], rng: SeededRNG,
  type: NodeType, minCol: number, maxCol: number,
): void {
  if (nodes.some(n => n.type === type)) return;
  const candidates = nodes.filter(n =>
    n.column >= minCol && n.column <= maxCol && n.type === 'combat');
  const pool = candidates.length ? candidates
    : nodes.filter(n => n.column >= minCol && n.column <= maxCol);
  if (pool.length) rng.pick(pool).type = type;
  void byColumn;
}

export function createRunState(seed: number): RunState {
  const rng = new SeededRNG(seed);
  const maps = [
    generateFloorMap(1, rng),
    generateFloorMap(2, rng),
  ];

  const start = maps[0].nodes[0];

  return {
    seed,
    floor: 1,
    currentNodeIndex: 0,
    currentNodeId: start.id,
    availableNodeIds: [start.id],
    maps,
    player: createPlayer(),
    entities: [],
    combatActive: false,
    paused: false,
    gameSpeed: 1.0,
    runComplete: false,
    runWon: false,
    runTime: 0,
    killCount: 0,
    normalKillsSinceItem: 0,
    levelsWithoutHighSynergy: 0,
    combatLog: [],
    offeredHistory: [],
    tagDistribution: new Map(),
    triggerChainDepths: [],
    meldHistory: [],
    deathCauseTaxonomy: new Map(),
    encounterLoot: [],
  };
}

export function addCombatLog(state: RunState, entry: Omit<CombatLogEntry, 'timestamp'>) {
  state.combatLog.push({ ...entry, timestamp: state.runTime });
  if (state.combatLog.length > 200) state.combatLog.shift();
}

export function getCurrentFloorMap(state: RunState): FloorMap {
  return state.maps[state.floor - 1];
}

export function findNode(state: RunState, id: string): MapNode | undefined {
  return getCurrentFloorMap(state).nodes.find(n => n.id === id);
}

export function getCurrentNode(state: RunState): MapNode {
  return findNode(state, state.currentNodeId) ?? getCurrentFloorMap(state).nodes[0];
}

/** Nodes the player may choose next. Empty once the floor boss is pending. */
export function getAvailableNodes(state: RunState): MapNode[] {
  return state.availableNodeIds
    .map(id => findNode(state, id))
    .filter((n): n is MapNode => !!n);
}

/** Move to a chosen node. Returns false if it is not currently reachable. */
export function travelTo(state: RunState, nodeId: string): boolean {
  if (!state.availableNodeIds.includes(nodeId)) return false;
  state.currentNodeId = nodeId;
  const node = findNode(state, nodeId);
  state.currentNodeIndex = node?.column ?? 0;
  state.availableNodeIds = [];
  return true;
}

/**
 * Mark the current node done and open its outgoing edges. When a floor's boss
 * falls, step to the next floor or finish the run.
 */
export function completeCurrentNode(state: RunState): void {
  const node = getCurrentNode(state);
  node.completed = true;

  if (node.type === 'boss') {
    if (state.floor < state.maps.length) {
      state.floor++;
      const next = getCurrentFloorMap(state).nodes[0];
      state.currentNodeId = next.id;
      state.currentNodeIndex = 0;
      state.availableNodeIds = [next.id];
    } else {
      state.runComplete = true;
      state.runWon = true;
      state.availableNodeIds = [];
    }
    return;
  }

  state.availableNodeIds = [...node.connections];
}

export function updateBuildTags(player: PlayerEntity) {
  player.buildTags.clear();
  const addTags = (tags: Tag[]) => {
    tags.forEach(t => {
      player.buildTags.set(t, (player.buildTags.get(t) || 0) + 1);
    });
  };
  player.skills.forEach(s => addTags(s.def.tags));
  player.passives.forEach(p => addTags(p.def.tags));
  player.items.forEach(i => addTags(i.def.tags));
}
