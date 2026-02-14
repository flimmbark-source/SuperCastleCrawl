import type {
  RunState, EnemyEntity, Entity, Vec2, EnemyDef, BossDef,
  ProjectileEntity, HazardEntity, SummonEntity
} from '../types';
import { HARD_CAPS } from '../types';
import { dist, dirTo, findNearestPlayerAlly, processDamage } from './CombatSystem';
import { SeededRNG } from '../engine/SeededRNG';
import { registry } from '../engine/DataRegistry';

let nextEntityId = 1000;
function genId(): string { return `e_${nextEntityId++}`; }

export function updateEnemyAI(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (e.type !== 'enemy' || !e.alive) return;
    const enemy = e as EnemyEntity;

    const target = findNearestPlayerAlly(state, enemy.pos);
    if (!target || !target.alive) return;

    const d = dist(enemy.pos, target.pos);
    const isBoss = enemy.def.id.startsWith('boss_');

    // Update ability cooldowns
    if (enemy.abilityCooldowns) {
      enemy.abilityCooldowns.forEach((v, k) => {
        if (v > 0) enemy.abilityCooldowns.set(k, v - dt);
      });
    }

    // Boss phase management
    if (isBoss) {
      updateBossPhase(enemy, state, dt, target);
      return;
    }

    // Archetype-specific behavior
    switch (enemy.def.archetype) {
      case 'melee_chaser':
        meleeChaseAI(enemy, target, state, dt);
        break;
      case 'ranged_spitter':
        rangedSpitterAI(enemy, target, state, dt);
        break;
      case 'tank':
        tankAI(enemy, target, state, dt);
        break;
      case 'blinker':
        blinkerAI(enemy, target, state, dt);
        break;
      case 'hazard_generator':
        hazardGeneratorAI(enemy, target, state, dt);
        break;
    }

    // Apply elite modifier behavior
    if (enemy.eliteModifier) {
      applyEliteModifier(enemy, state, dt);
    }
  });
}

function meleeChaseAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  if (d > enemy.def.attackRange) {
    // Move toward target
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.rotation = Math.atan2(dir.y, dir.x);
    enemy.animState = 'move';
  } else {
    // Attack
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
      enemy.animState = 'attack';
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: enemy.def.damage,
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    } else {
      enemy.animState = 'idle';
    }
  }

  // Clamp to arena
  clampToArena(enemy);
}

function rangedSpitterAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const preferredRange = enemy.def.attackRange * 0.7;

  // Maintain distance
  if (d < preferredRange * 0.5) {
    const dir = dirTo(target.pos, enemy.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  } else if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  // Fire projectile
  const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
  if (cd <= 0 && d <= enemy.def.attackRange) {
    enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
    enemy.animState = 'attack';

    const dir = dirTo(enemy.pos, target.pos);
    const proj: ProjectileEntity = {
      id: genId(),
      type: 'projectile',
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      vel: { x: dir.x * 200, y: dir.y * 200 },
      hp: 1, maxHp: 1,
      radius: 5,
      speed: 200,
      faction: 'enemy',
      tags: ['Projectile'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: Math.atan2(dir.y, dir.x),
      ownerId: enemy.id,
      damage: enemy.def.damage,
      piercing: false,
      lifetime: 2,
      maxLifetime: 2,
      hitEntities: new Set(),
    };
    state.entities.push(proj);
  }

  clampToArena(enemy);
}

function tankAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  } else {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
      enemy.animState = 'attack';
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: enemy.def.damage,
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    }

    // Ground slam ability
    const slamCd = enemy.abilityCooldowns.get('ground_slam') || 0;
    if (slamCd <= 0 && d < 50) {
      enemy.abilityCooldowns.set('ground_slam', 6);
      // AOE damage around self
      state.entities.forEach(e => {
        if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < 48) {
          processDamage({
            attackerId: enemy.id,
            targetId: e.id,
            baseDamage: 12,
            damageType: 'physical',
            tags: ['Physical', 'AOE'],
            isProjectile: false,
          }, state);
        }
      });
      if (dist(state.player.pos, enemy.pos) < 48) {
        processDamage({
          attackerId: enemy.id,
          targetId: 'player',
          baseDamage: 12,
          damageType: 'physical',
          tags: ['Physical', 'AOE'],
          isProjectile: false,
        }, state);
      }
    }
  }

  clampToArena(enemy);
}

function blinkerAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  // Shadow blink
  const blinkCd = enemy.abilityCooldowns.get('shadow_blink') || 0;
  if (blinkCd <= 0 && d > 80) {
    enemy.abilityCooldowns.set('shadow_blink', 4);
    // Teleport near target
    const angle = Math.random() * Math.PI * 2;
    enemy.pos.x = target.pos.x + Math.cos(angle) * 30;
    enemy.pos.y = target.pos.y + Math.sin(angle) * 30;
  }

  if (d <= enemy.def.attackRange) {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
      enemy.animState = 'attack';
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: enemy.def.damage,
        damageType: 'physical',
        tags: ['Spirit', 'Melee'],
        isProjectile: false,
      }, state);
    }
  } else {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  clampToArena(enemy);
}

function hazardGeneratorAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  // Maintain distance
  if (d < 80) {
    const dir = dirTo(target.pos, enemy.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  // Spawn hazard
  const cd = enemy.abilityCooldowns.get('spawn_gas_cloud') || 0;
  if (cd <= 0) {
    enemy.abilityCooldowns.set('spawn_gas_cloud', 5);
    enemy.animState = 'attack';

    const hazard: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { x: target.pos.x + (Math.random() - 0.5) * 40, y: target.pos.y + (Math.random() - 0.5) * 40 },
      vel: { x: 0, y: 0 },
      hp: 1, maxHp: 1,
      radius: 40,
      speed: 0,
      faction: 'enemy',
      tags: ['Poison', 'AOE', 'DOT'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: enemy.id,
      damage: 4,
      tickRate: 0.5,
      tickTimer: 0.5,
      duration: 5,
      maxDuration: 5,
    };
    state.entities.push(hazard);
  }

  clampToArena(enemy);
}

function applyEliteModifier(enemy: EnemyEntity, state: RunState, dt: number) {
  if (!enemy.eliteModifier) return;

  switch (enemy.eliteModifier.id) {
    case 'elite_frenzied':
      // Speed up below 40% HP
      if (enemy.hp < enemy.maxHp * 0.4) {
        enemy.speed = enemy.def.speed * enemy.eliteModifier.speedMult * 1.5;
      }
      break;
    case 'elite_shielded':
      // Periodic shield (simplified)
      break;
    case 'elite_toxic':
      // Attacks apply poison via processDamage triggers
      break;
  }
}

function updateBossPhase(enemy: EnemyEntity, state: RunState, dt: number, target: Entity) {
  const boss = registry.getBoss(enemy.def.id);
  if (!boss) {
    meleeChaseAI(enemy, target, state, dt);
    return;
  }

  // Determine phase
  const hpRatio = enemy.hp / enemy.maxHp;
  let currentPhase = 0;
  for (let i = boss.phases.length - 1; i >= 0; i--) {
    if (hpRatio <= boss.phases[i].hpThreshold) {
      currentPhase = i;
    }
  }
  enemy.currentPhase = currentPhase;

  const phase = boss.phases[currentPhase];
  const d = dist(enemy.pos, target.pos);

  // Move toward target slowly
  if (d > 60) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  // Use phase abilities
  for (const ability of phase.abilities) {
    const cd = enemy.abilityCooldowns.get(ability.id) || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set(ability.id, ability.cooldown);
      executeBossAbility(enemy, ability, target, state);
      break; // One ability per frame
    }
  }

  // Basic attack
  if (d <= enemy.def.attackRange) {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: enemy.def.damage,
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    }
  }

  clampToArena(enemy);
}

function executeBossAbility(
  enemy: EnemyEntity,
  ability: { id: string; damage?: number; aoeRadius?: number; effect?: string; range: number },
  target: Entity,
  state: RunState
) {
  const effect = ability.effect || '';

  if (effect.includes('projectile') || effect.includes('barrage')) {
    // Multi projectile
    const count = parseInt(effect.split('_').pop() || '3');
    const baseDir = dirTo(enemy.pos, target.pos);
    const spread = 0.3;
    for (let i = 0; i < count; i++) {
      const angle = Math.atan2(baseDir.y, baseDir.x) + (i - (count - 1) / 2) * spread;
      const proj: ProjectileEntity = {
        id: genId(),
        type: 'projectile',
        pos: { x: enemy.pos.x, y: enemy.pos.y },
        vel: { x: Math.cos(angle) * 180, y: Math.sin(angle) * 180 },
        hp: 1, maxHp: 1,
        radius: 6,
        speed: 180,
        faction: 'enemy',
        tags: ['Projectile'],
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: angle,
        ownerId: enemy.id,
        damage: ability.damage || 8,
        piercing: false,
        lifetime: 2.5,
        maxLifetime: 2.5,
        hitEntities: new Set(),
      };
      state.entities.push(proj);
    }
  } else if (effect.includes('cone') || effect.includes('sweep')) {
    // AOE around boss
    const radius = ability.aoeRadius || 60;
    [...state.entities, state.player].forEach(e => {
      if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < radius) {
        processDamage({
          attackerId: enemy.id,
          targetId: e.id,
          baseDamage: ability.damage || 15,
          damageType: 'physical',
          tags: ['Physical', 'AOE'],
          isProjectile: false,
        }, state);
      }
    });
  } else if (effect.includes('rain') || effect.includes('zone')) {
    // Multiple hazard zones
    const count = parseInt(effect.split('_')[0]?.replace('rain', '') || '3') || 3;
    for (let i = 0; i < Math.min(count, HARD_CAPS.maxSpawnedFromEvent); i++) {
      const angle = Math.random() * Math.PI * 2;
      const range = 40 + Math.random() * 100;
      const hazard: HazardEntity = {
        id: genId(),
        type: 'hazard',
        pos: {
          x: target.pos.x + Math.cos(angle) * range,
          y: target.pos.y + Math.sin(angle) * range
        },
        vel: { x: 0, y: 0 },
        hp: 1, maxHp: 1,
        radius: ability.aoeRadius || 40,
        speed: 0,
        faction: 'enemy',
        tags: ['Poison', 'AOE'],
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: 0,
        ownerId: enemy.id,
        damage: ability.damage || 6,
        tickRate: 0.5,
        tickTimer: 0.5,
        duration: 4,
        maxDuration: 4,
      };
      state.entities.push(hazard);
    }
  } else if (effect.includes('summon')) {
    // Boss summons adds
    const count = parseInt(effect.split('_')[1] || '2');
    for (let i = 0; i < Math.min(count, HARD_CAPS.maxSpawnedFromEvent); i++) {
      const angle = Math.random() * Math.PI * 2;
      const spawnDist = 60;
      const add: EnemyEntity = {
        id: genId(),
        type: 'enemy',
        pos: {
          x: enemy.pos.x + Math.cos(angle) * spawnDist,
          y: enemy.pos.y + Math.sin(angle) * spawnDist,
        },
        vel: { x: 0, y: 0 },
        hp: 15,
        maxHp: 15,
        radius: 8,
        speed: 2.5 * 32,
        faction: 'enemy',
        tags: ['Poison', 'Melee'],
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: 0,
        def: {
          id: 'sporeling',
          name: 'Sporeling',
          archetype: 'melee_chaser',
          hp: 15,
          damage: 4,
          speed: 2.5 * 32,
          attackCooldown: 1.5,
          attackRange: 22,
          tags: ['Poison', 'Melee'],
          description: 'Small spore creature',
          floorScaling: { hpMult: 1, damageMult: 1 },
        },
        abilityCooldowns: new Map([['basic_attack', 0]]),
        behaviorState: 'chase',
        poisonStacks: 0,
      };
      state.entities.push(add);
    }
  } else if (effect.includes('ring') || effect.includes('nova')) {
    // Expanding ring - create large hazard
    const hazard: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      vel: { x: 0, y: 0 },
      hp: 1, maxHp: 1,
      radius: ability.aoeRadius || 100,
      speed: 0,
      faction: 'enemy',
      tags: ['Poison', 'AOE'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: enemy.id,
      damage: ability.damage || 14,
      tickRate: 0.3,
      tickTimer: 0.3,
      duration: 1.5,
      maxDuration: 1.5,
    };
    state.entities.push(hazard);
  }
}

const ARENA_SIZE = 13 * 32;
function clampToArena(entity: Entity) {
  entity.pos.x = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, entity.pos.x));
  entity.pos.y = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, entity.pos.y));
}

export function spawnEnemiesForNode(
  state: RunState,
  nodeType: 'combat' | 'elite' | 'boss',
  floor: number,
  rng: SeededRNG
) {
  const allEnemies = registry.getAllEnemies();
  const allEliteMods = registry.getAllEliteModifiers();
  const allBosses = registry.getAllBosses();

  if (nodeType === 'boss') {
    const bossDef = floor === 1 ? allBosses[0] : allBosses[allBosses.length > 1 ? 1 : 0];
    if (bossDef) {
      const enemy = createEnemyFromDef(bossDef, { x: 0, y: -120 }, floor);
      state.entities.push(enemy);
    }
    return;
  }

  const count = nodeType === 'combat' ? rng.nextInt(3, 6) : rng.nextInt(1, 2);
  for (let i = 0; i < count; i++) {
    const def = rng.pick(allEnemies);
    const angle = (Math.PI * 2 / count) * i + rng.nextFloat(0, 0.5);
    const spawnDist = 120 + rng.nextFloat(0, 80);
    const pos = {
      x: Math.cos(angle) * spawnDist,
      y: Math.sin(angle) * spawnDist,
    };

    const enemy = createEnemyFromDef(def, pos, floor);

    // Apply elite modifier
    if (nodeType === 'elite') {
      const mod = rng.pick(allEliteMods);
      enemy.eliteModifier = mod;
      enemy.hp *= mod.hpMult;
      enemy.maxHp = enemy.hp;
      enemy.speed *= mod.speedMult;
    }

    state.entities.push(enemy);
  }
}

function createEnemyFromDef(def: EnemyDef, pos: Vec2, floor: number): EnemyEntity {
  const floorMult = floor === 1 ? 1 : def.floorScaling.hpMult;
  const dmgMult = floor === 1 ? 1 : def.floorScaling.damageMult;

  return {
    id: genId(),
    type: 'enemy',
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    hp: Math.round(def.hp * floorMult),
    maxHp: Math.round(def.hp * floorMult),
    radius: def.archetype === 'tank' ? 16 : 10,
    speed: def.speed,
    faction: 'enemy',
    tags: def.tags,
    alive: true,
    invulnMs: 0,
    flashMs: 0,
    deathAnimMs: 0,
    animState: 'idle',
    rotation: 0,
    def: { ...def, damage: Math.round(def.damage * dmgMult) },
    abilityCooldowns: new Map([['basic_attack', 0], ...((def.abilities || []).map(a => [a.id, a.cooldown * 0.5] as [string, number]))]),
    behaviorState: 'idle',
    poisonStacks: 0,
  };
}
