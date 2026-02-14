import type {
  RunState, PlayerEntity, FloorMap, MapNode, NodeType,
  Tag, CombatLogEntry, Entity
} from '../types';
import { xpForLevel } from '../types';
import { SeededRNG } from './SeededRNG';

export function createPlayer(): PlayerEntity {
  return {
    id: 'player',
    type: 'player',
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    radius: 12,
    speed: 4.2 * 32, // tiles/sec * tileSize
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
    maxSkillSlots: 3,
    armor: 0,
    damageScalar: 1.0,
    attackSpeed: 1.0,
    resource: 50,
    maxResource: 50,
    buildTags: new Map(),
  };
}

export function generateFloorMap(floor: number, rng: SeededRNG): FloorMap {
  const nodes: MapNode[] = [];
  const nodeTypes: NodeType[] = [];

  // Fixed distribution per floor: 5 combat, 1 elite, 1 shrine, 1 recovery/event, 1 boss
  // Shrine must appear no later than node 5 on floor 1
  const combatSlots = 5;
  const eliteSlot = 1;
  const shrineSlot = 1;
  const recoverySlot = 1;
  const bossSlot = 1;
  const total = combatSlots + eliteSlot + shrineSlot + recoverySlot + bossSlot;

  // Build ordered types: boss is always last
  const pool: NodeType[] = [];
  for (let i = 0; i < combatSlots; i++) pool.push('combat');
  pool.push('elite');
  pool.push('shrine');
  pool.push('recovery');

  // Shuffle non-boss nodes
  const shuffled = rng.shuffle(pool);

  // Ensure shrine appears in first 5 nodes (index 0-4) for floor 1
  if (floor === 1) {
    const shrineIdx = shuffled.indexOf('shrine');
    if (shrineIdx >= 5) {
      const swapIdx = rng.nextInt(2, 4);
      [shuffled[shrineIdx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[shrineIdx]];
    }
  }

  // Boss always last
  shuffled.push('boss');

  for (let i = 0; i < total; i++) {
    const node: MapNode = {
      id: `f${floor}_n${i}`,
      floor,
      index: i,
      type: shuffled[i],
      completed: false,
      connections: i < total - 1 ? [`f${floor}_n${i + 1}`] : [],
    };
    nodes.push(node);
  }

  return { floor, nodes };
}

export function createRunState(seed: number): RunState {
  const rng = new SeededRNG(seed);
  const maps = [
    generateFloorMap(1, rng),
    generateFloorMap(2, rng),
  ];

  return {
    seed,
    floor: 1,
    currentNodeIndex: 0,
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
  };
}

export function addCombatLog(state: RunState, entry: Omit<CombatLogEntry, 'timestamp'>) {
  state.combatLog.push({ ...entry, timestamp: state.runTime });
  // Keep last 200 entries
  if (state.combatLog.length > 200) state.combatLog.shift();
}

export function getCurrentFloorMap(state: RunState): FloorMap {
  return state.maps[state.floor - 1];
}

export function getCurrentNode(state: RunState): MapNode {
  const map = getCurrentFloorMap(state);
  return map.nodes[state.currentNodeIndex];
}

export function advanceNode(state: RunState): MapNode | null {
  const map = getCurrentFloorMap(state);
  if (state.currentNodeIndex < map.nodes.length - 1) {
    state.currentNodeIndex++;
    return map.nodes[state.currentNodeIndex];
  }
  // Move to next floor
  if (state.floor < 2) {
    state.floor++;
    state.currentNodeIndex = 0;
    return getCurrentNode(state);
  }
  // Run complete (beat floor 2 boss)
  state.runComplete = true;
  state.runWon = true;
  return null;
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
