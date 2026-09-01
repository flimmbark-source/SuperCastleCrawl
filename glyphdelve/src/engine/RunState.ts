import type {
  RunState, PlayerEntity, FloorMap, MapNode, NodeType,
  Tag, CombatLogEntry, Entity
} from '../types';
import { xpForLevel } from '../types';
import { SeededRNG } from './SeededRNG';
import { registry } from './DataRegistry';

export function createPlayer(): PlayerEntity {
  // Get the Transform skill from registry
  const transformSkill = registry.getSkill('bear_form_transform');

  const player: PlayerEntity = {
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
    inventory: [],
  };

  // Add Transform as starting skill
  if (transformSkill) {
    player.skills.push({
      def: transformSkill,
      cooldownRemaining: 0,
      level: 1,
      upgraded: false,
    });
  }

  // Track form state (default to Caster form)
  (player as any)._bearForm = false;

  return player;
}

export function generateFloorMap(floor: number, rng: SeededRNG): FloorMap {
  const floorOneNodes: NodeType[] = [
    'combat',
    'combat',
    'shrine',
    'recovery',
    'elite',
    'combat',
    'event',
    'combat',
    'boss',
  ];

  const floorTwoNodes: NodeType[] = [
    'combat',
    'elite',
    'combat',
    'event',
    'combat',
    'elite',
    'combat',
    'event',
    'boss',
  ];

  const ordered = floor === 1 ? floorOneNodes : floorTwoNodes;

  const nodes: MapNode[] = ordered.map((type, i) => ({
    id: `f${floor}_n${i}`,
    floor,
    index: i,
    type,
    completed: false,
    connections: i < ordered.length - 1 ? [`f${floor}_n${i + 1}`] : [],
  }));

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
    encounterLoot: [],
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
