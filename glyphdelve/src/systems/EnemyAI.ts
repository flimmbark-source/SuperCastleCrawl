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

// Ability timing constants (in seconds)
const ABILITY_TIMING = {
  // Telegraph phase - visual indicator before ability
  BLINK_TELEGRAPH: 0.4,
  CHARGE_TELEGRAPH: 0.5,
  LUNGE_TELEGRAPH: 0.3,
  BURST_FIRE_TELEGRAPH: 0.35,
  RETREAT_TELEGRAPH: 0.25,
  HAZARD_TELEGRAPH: 0.4,
  SLAM_TELEGRAPH: 0.5,

  // Execute phase - ability actually happens
  BLINK_EXECUTE: 0.2,
  CHARGE_EXECUTE: 0.35,
  LUNGE_EXECUTE: 0.2,
  BURST_FIRE_EXECUTE: 0.25,
  RETREAT_EXECUTE: 0.15,
  HAZARD_EXECUTE: 0.15,
  SLAM_EXECUTE: 0.3,

  // Recovery phase - brief pause after ability
  DEFAULT_RECOVERY: 0.2,
};

export function updateEnemyAI(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (e.type !== 'enemy' || !e.alive) return;
    const enemy = e as EnemyEntity;

    // Update active ability if one is running
    if (enemy.activeAbility) {
      updateActiveAbility(enemy, state, dt);
      return; // Don't do normal AI while ability is active
    }

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

function updateActiveAbility(enemy: EnemyEntity, state: RunState, dt: number) {
  if (!enemy.activeAbility) return;

  const ability = enemy.activeAbility;
  ability.timer -= dt;

  // Update windup progress for animations
  if (ability.phase === 'telegraph' && ability.windupProgress !== undefined) {
    const totalTime = ABILITY_TIMING[`${ability.id.toUpperCase()}_TELEGRAPH` as keyof typeof ABILITY_TIMING] || 0.3;
    ability.windupProgress = 1 - (ability.timer / totalTime);
  }

  // Phase transitions
  if (ability.timer <= 0) {
    switch (ability.phase) {
      case 'telegraph':
        executeAbility(enemy, state);
        break;
      case 'execute':
        ability.phase = 'recovery';
        ability.timer = ABILITY_TIMING.DEFAULT_RECOVERY;
        enemy.animState = 'idle';
        break;
      case 'recovery':
        enemy.activeAbility = undefined;
        break;
    }
  }
}

function startAbility(
  enemy: EnemyEntity,
  abilityId: string,
  targetPos?: Vec2,
  startPos?: Vec2
) {
  const telegraphTime = ABILITY_TIMING[`${abilityId.toUpperCase()}_TELEGRAPH` as keyof typeof ABILITY_TIMING] || 0.3;

  enemy.activeAbility = {
    id: abilityId,
    phase: 'telegraph',
    timer: telegraphTime,
    targetPos,
    startPos: startPos || { ...enemy.pos },
    windupProgress: 0,
  };
  enemy.animState = 'attack'; // Wind-up pose
}

function executeAbility(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility) return;

  const ability = enemy.activeAbility;
  const executeTime = ABILITY_TIMING[`${ability.id.toUpperCase()}_EXECUTE` as keyof typeof ABILITY_TIMING] || 0.2;

  ability.phase = 'execute';
  ability.timer = executeTime;

  // Execute the actual ability effect
  switch (ability.id) {
    case 'blink':
      executeBlink(enemy, state);
      break;
    case 'charge':
      executeCharge(enemy, state);
      break;
    case 'lunge':
      executeLunge(enemy, state);
      break;
    case 'burst_fire':
      executeBurstFire(enemy, state);
      break;
    case 'retreat':
      executeRetreat(enemy, state);
      break;
    case 'hazard':
      executeHazardSpawn(enemy, state);
      break;
    case 'slam':
      executeGroundSlam(enemy, state);
      break;
  }
}

// --- Execute functions for each ability ---

function executeBlink(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility?.targetPos) return;

  // Fade effect handled by renderer checking activeAbility phase
  enemy.pos = { ...enemy.activeAbility.targetPos };
  clampToArena(enemy);

  // Backstab damage to target
  const target = findNearestPlayerAlly(state, enemy.pos);
  if (target && dist(enemy.pos, target.pos) < 50) {
    processDamage({
      attackerId: enemy.id,
      targetId: target.id,
      baseDamage: Math.round(enemy.def.damage * 1.5),
      damageType: 'physical',
      tags: ['Spirit', 'Melee'],
      isProjectile: false,
    }, state);
  }
}

function executeCharge(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility?.targetPos || !enemy.activeAbility.startPos) return;

  // Lerp to target position during execute phase
  const progress = 1 - (enemy.activeAbility.timer / ABILITY_TIMING.CHARGE_EXECUTE);
  const start = enemy.activeAbility.startPos;
  const end = enemy.activeAbility.targetPos;

  enemy.pos.x = start.x + (end.x - start.x) * progress;
  enemy.pos.y = start.y + (end.y - start.y) * progress;
  clampToArena(enemy);

  // Damage on completion
  if (progress >= 0.95) {
    [...state.entities, state.player].forEach(e => {
      if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < 36) {
        processDamage({
          attackerId: enemy.id,
          targetId: e.id,
          baseDamage: 10,
          damageType: 'physical',
          tags: ['Physical', 'AOE'],
          isProjectile: false,
        }, state);
      }
    });
  }
}

function executeLunge(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility?.targetPos || !enemy.activeAbility.startPos) return;

  const progress = 1 - (enemy.activeAbility.timer / ABILITY_TIMING.LUNGE_EXECUTE);
  const start = enemy.activeAbility.startPos;
  const end = enemy.activeAbility.targetPos;

  enemy.pos.x = start.x + (end.x - start.x) * progress;
  enemy.pos.y = start.y + (end.y - start.y) * progress;
  clampToArena(enemy);

  if (progress >= 0.9) {
    const target = findNearestPlayerAlly(state, enemy.pos);
    if (target && dist(enemy.pos, target.pos) < 30) {
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: Math.round(enemy.def.damage * 1.3),
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    }
  }
}

function executeBurstFire(enemy: EnemyEntity, state: RunState) {
  const target = findNearestPlayerAlly(state, enemy.pos);
  if (!target) return;

  const baseDir = dirTo(enemy.pos, target.pos);
  const baseAngle = Math.atan2(baseDir.y, baseDir.x);

  for (let i = -1; i <= 1; i++) {
    const angle = baseAngle + i * 0.15;
    const proj: ProjectileEntity = {
      id: genId(),
      type: 'projectile',
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      vel: { x: Math.cos(angle) * 190, y: Math.sin(angle) * 190 },
      hp: 1, maxHp: 1,
      radius: 4,
      speed: 190,
      faction: 'enemy',
      tags: ['Projectile', 'Poison'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: angle,
      ownerId: enemy.id,
      damage: Math.round(enemy.def.damage * 0.6),
      piercing: false,
      lifetime: 2,
      maxLifetime: 2,
      hitEntities: new Set(),
    };
    state.entities.push(proj);
  }
}

function executeRetreat(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility?.targetPos || !enemy.activeAbility.startPos) return;

  const progress = 1 - (enemy.activeAbility.timer / ABILITY_TIMING.RETREAT_EXECUTE);
  const start = enemy.activeAbility.startPos;
  const end = enemy.activeAbility.targetPos;

  enemy.pos.x = start.x + (end.x - start.x) * progress;
  enemy.pos.y = start.y + (end.y - start.y) * progress;
  clampToArena(enemy);

  // Drop mine at start position on completion
  if (progress >= 0.95) {
    const mine: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { ...start },
      vel: { x: 0, y: 0 },
      hp: 1, maxHp: 1,
      radius: 28,
      speed: 0,
      faction: 'enemy',
      tags: ['Poison', 'AOE'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: enemy.id,
      damage: 5,
      tickRate: 0.5,
      tickTimer: 0.5,
      duration: 3,
      maxDuration: 3,
    };
    state.entities.push(mine);
  }
}

function executeHazardSpawn(enemy: EnemyEntity, state: RunState) {
  if (!enemy.activeAbility?.targetPos) return;

  const hazard: HazardEntity = {
    id: genId(),
    type: 'hazard',
    pos: { ...enemy.activeAbility.targetPos },
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

function executeGroundSlam(enemy: EnemyEntity, state: RunState) {
  const slamRadius = 48;
  [...state.entities, state.player].forEach(e => {
    if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < slamRadius) {
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
}

// --- Helper: count nearby allies for pack behavior ---
function countNearbyAllies(state: RunState, enemy: EnemyEntity, radius: number): number {
  let count = 0;
  state.entities.forEach(e => {
    if (e.type === 'enemy' && e.alive && e.id !== enemy.id && dist(e.pos, enemy.pos) < radius) {
      count++;
    }
  });
  return count;
}

// =====================================================
// MELEE CHASER - Skeleton Chaser
// =====================================================
function meleeChaseAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const hpRatio = enemy.hp / enemy.maxHp;
  const frenzied = hpRatio < 0.3;
  const speedMult = frenzied ? 1.4 : 1.0;
  const attackCdMult = frenzied ? 0.6 : 1.0;

  // Lunge attack: charge forward when at medium range
  const lungeCd = enemy.abilityCooldowns.get('lunge') || 0;
  if (lungeCd <= 0 && d > 40 && d < 90) {
    enemy.abilityCooldowns.set('lunge', 5);
    const dir = dirTo(enemy.pos, target.pos);
    const lungeDistance = Math.min(d - 15, 60);
    const targetPos = {
      x: enemy.pos.x + dir.x * lungeDistance,
      y: enemy.pos.y + dir.y * lungeDistance,
    };
    startAbility(enemy, 'lunge', targetPos);
    return;
  }

  // Pack flanking and movement
  const nearbyAllies = countNearbyAllies(state, enemy, 120);
  const shouldFlank = nearbyAllies >= 1 && d > enemy.def.attackRange && d < 120;
  const idNum = parseInt(enemy.id.replace(/\D/g, '')) || 0;
  const flankSide = idNum % 2 === 0 ? 1 : -1;

  if (d > enemy.def.attackRange) {
    let dir: Vec2;
    if (shouldFlank) {
      const angle = Math.atan2(target.pos.y - enemy.pos.y, target.pos.x - enemy.pos.x) + flankSide * (Math.PI * 0.3);
      dir = { x: Math.cos(angle), y: Math.sin(angle) };
    } else {
      dir = dirTo(enemy.pos, target.pos);
    }
    enemy.pos.x += dir.x * enemy.speed * speedMult * dt;
    enemy.pos.y += dir.y * enemy.speed * speedMult * dt;
    enemy.rotation = Math.atan2(dir.y, dir.x);
    enemy.animState = 'move';
  } else {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown * attackCdMult);
      enemy.animState = 'attack';
      const packBonus = Math.min(nearbyAllies * 0.15, 0.45);
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: Math.round(enemy.def.damage * (1 + packBonus)),
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    } else if (d < enemy.def.attackRange * 0.8) {
      const strafeAngle = Math.atan2(target.pos.y - enemy.pos.y, target.pos.x - enemy.pos.x) + flankSide * (Math.PI * 0.3);
      const strafeDir = { x: Math.cos(strafeAngle), y: Math.sin(strafeAngle) };
      enemy.pos.x += strafeDir.x * enemy.speed * 0.4 * dt;
      enemy.pos.y += strafeDir.y * enemy.speed * 0.4 * dt;
    }
  }

  clampToArena(enemy);
}

// =====================================================
// RANGED SPITTER - Mushroom Spitter
// =====================================================
function rangedSpitterAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const preferredRange = enemy.def.attackRange * 0.7;

  // Retreat dash: if player gets too close, jump backwards
  const retreatCd = enemy.abilityCooldowns.get('retreat_dash') || 0;
  if (retreatCd <= 0 && d < preferredRange * 0.35) {
    enemy.abilityCooldowns.set('retreat_dash', 6);
    const awayDir = dirTo(target.pos, enemy.pos);
    const retreatPos = {
      x: enemy.pos.x + awayDir.x * 70,
      y: enemy.pos.y + awayDir.y * 70,
    };
    startAbility(enemy, 'retreat', retreatPos);
    return;
  }

  // Maintain distance
  if (d < preferredRange * 0.5) {
    const dir = dirTo(target.pos, enemy.pos);
    enemy.pos.x += dir.x * enemy.speed * 1.3 * dt;
    enemy.pos.y += dir.y * enemy.speed * 1.3 * dt;
    enemy.animState = 'move';
  } else if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  // Burst fire: fire 3 projectiles
  const burstCd = enemy.abilityCooldowns.get('burst_fire') || 0;
  if (burstCd <= 0 && d <= enemy.def.attackRange && d > preferredRange * 0.3) {
    enemy.abilityCooldowns.set('burst_fire', 7);
    startAbility(enemy, 'burst_fire');
    return;
  }

  // Normal shot with leading
  const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
  if (cd <= 0 && d <= enemy.def.attackRange) {
    enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
    enemy.animState = 'attack';

    const projSpeed = 200;
    const travelTime = d / projSpeed;
    const predictedPos = {
      x: target.pos.x + target.vel.x * travelTime * 0.5,
      y: target.pos.y + target.vel.y * travelTime * 0.5,
    };
    const dir = dirTo(enemy.pos, predictedPos);

    const proj: ProjectileEntity = {
      id: genId(),
      type: 'projectile',
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      vel: { x: dir.x * projSpeed, y: dir.y * projSpeed },
      hp: 1, maxHp: 1,
      radius: 5,
      speed: projSpeed,
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

// =====================================================
// TANK - Stone Golem
// =====================================================
function tankAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const hpRatio = enemy.hp / enemy.maxHp;
  const enraged = hpRatio < 0.25;
  const damageMult = enraged ? 1.5 : 1.0;

  // Charge attack
  const chargeCd = enemy.abilityCooldowns.get('charge') || 0;
  if (chargeCd <= 0 && d > 80 && d < 200) {
    enemy.abilityCooldowns.set('charge', 8);
    const dir = dirTo(enemy.pos, target.pos);
    const chargeDist = Math.min(d - 20, 100);
    const chargeTarget = {
      x: enemy.pos.x + dir.x * chargeDist,
      y: enemy.pos.y + dir.y * chargeDist,
    };
    startAbility(enemy, 'charge', chargeTarget);
    return;
  }

  // Ground slam
  const slamCd = enemy.abilityCooldowns.get('ground_slam') || 0;
  if (slamCd <= 0 && d < 50) {
    enemy.abilityCooldowns.set('ground_slam', enraged ? 4 : 6);
    startAbility(enemy, 'slam');
    return;
  }

  // Movement
  if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  } else {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      const attackCd = enraged ? enemy.def.attackCooldown * 0.6 : enemy.def.attackCooldown;
      enemy.abilityCooldowns.set('basic_attack', attackCd);
      enemy.animState = 'attack';
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: Math.round(enemy.def.damage * damageMult),
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    }
  }

  clampToArena(enemy);
}

// =====================================================
// BLINKER - Shadow Imp
// =====================================================
function blinkerAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const attacksSinceBlink = enemy.abilityCooldowns.get('attacks_since_blink') || 0;

  // Shadow blink: teleport behind target
  const blinkCd = enemy.abilityCooldowns.get('shadow_blink') || 0;
  if (blinkCd <= 0 && (d > 60 || attacksSinceBlink >= 2)) {
    enemy.abilityCooldowns.set('shadow_blink', 3.5);
    enemy.abilityCooldowns.set('attacks_since_blink', 0);

    const behindAngle = target.rotation + Math.PI;
    const offset = 25 + Math.random() * 10;
    const blinkTarget = {
      x: target.pos.x + Math.cos(behindAngle) * offset,
      y: target.pos.y + Math.sin(behindAngle) * offset,
    };
    startAbility(enemy, 'blink', blinkTarget);
    return;
  }

  // Normal movement with zigzag
  if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    const zigzag = Math.sin(Date.now() * 0.005 + parseInt(enemy.id.replace(/\D/g, '')) * 1.7) * 0.6;
    const moveAngle = Math.atan2(dir.y, dir.x) + zigzag;
    enemy.pos.x += Math.cos(moveAngle) * enemy.speed * dt;
    enemy.pos.y += Math.sin(moveAngle) * enemy.speed * dt;
    enemy.animState = 'move';
  } else {
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
      enemy.abilityCooldowns.set('attacks_since_blink', attacksSinceBlink + 1);
      enemy.animState = 'attack';
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: enemy.def.damage,
        damageType: 'physical',
        tags: ['Spirit', 'Melee'],
        isProjectile: false,
      }, state);

      const awayDir = dirTo(target.pos, enemy.pos);
      enemy.pos.x += awayDir.x * 15;
      enemy.pos.y += awayDir.y * 15;
    }
  }

  enemy.rotation = Math.atan2(target.pos.y - enemy.pos.y, target.pos.x - enemy.pos.x);
  clampToArena(enemy);
}

// =====================================================
// HAZARD GENERATOR - Toxic Shroom
// =====================================================
function hazardGeneratorAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const ownHazardCount = state.entities.filter(
    e => e.type === 'hazard' && e.alive && (e as HazardEntity).ownerId === enemy.id
  ).length;

  // Main hazard spawn
  const cd = enemy.abilityCooldowns.get('spawn_gas_cloud') || 0;
  if (cd <= 0 && ownHazardCount < 5) {
    enemy.abilityCooldowns.set('spawn_gas_cloud', 4.5);

    let hazardX = target.pos.x;
    let hazardY = target.pos.y;
    const isMoving = Math.abs(target.vel.x) > 10 || Math.abs(target.vel.y) > 10;
    if (isMoving) {
      hazardX += target.vel.x * 0.4;
      hazardY += target.vel.y * 0.4;
    }
    hazardX += (Math.random() - 0.5) * 30;
    hazardY += (Math.random() - 0.5) * 30;

    startAbility(enemy, 'hazard', { x: hazardX, y: hazardY });
    return;
  }

  // Maintain distance
  if (d < 80) {
    const dir = dirTo(target.pos, enemy.pos);
    const fleeSpeed = d < 40 ? enemy.speed * 1.5 : enemy.speed;
    enemy.pos.x += dir.x * fleeSpeed * dt;
    enemy.pos.y += dir.y * fleeSpeed * dt;
    enemy.animState = 'move';
  } else if (d > 160) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * 0.5 * dt;
    enemy.pos.y += dir.y * enemy.speed * 0.5 * dt;
    enemy.animState = 'move';
  }

  clampToArena(enemy);
}

function applyEliteModifier(enemy: EnemyEntity, state: RunState, dt: number) {
  if (!enemy.eliteModifier) return;

  switch (enemy.eliteModifier.id) {
    case 'elite_frenzied':
      if (enemy.hp < enemy.maxHp * 0.4) {
        enemy.speed = enemy.def.speed * enemy.eliteModifier.speedMult * 1.5;
      }
      break;
  }
}

function updateBossPhase(enemy: EnemyEntity, state: RunState, dt: number, target: Entity) {
  const boss = registry.getBoss(enemy.def.id);
  if (!boss) {
    meleeChaseAI(enemy, target, state, dt);
    return;
  }

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

  if (d > 60) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  for (const ability of phase.abilities) {
    const cd = enemy.abilityCooldowns.get(ability.id) || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set(ability.id, ability.cooldown);
      executeBossAbility(enemy, ability, target, state);
      break;
    }
  }

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
