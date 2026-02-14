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

// --- Helper: get perpendicular flanking direction ---
function getFlankDir(enemy: EnemyEntity, target: Entity, side: number): Vec2 {
  const dir = dirTo(enemy.pos, target.pos);
  // Rotate 45-70 degrees to one side for flanking
  const angle = Math.atan2(dir.y, dir.x) + side * (Math.PI * 0.3);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// =====================================================
// MELEE CHASER - Skeleton Chaser
// Behaviors: Pack flanking, lunge attack, wounded frenzy,
// circling before attack
// =====================================================
function meleeChaseAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const hpRatio = enemy.hp / enemy.maxHp;

  // Determine flanking side based on entity ID (consistent per enemy)
  const idNum = parseInt(enemy.id.replace(/\D/g, '')) || 0;
  const flankSide = idNum % 2 === 0 ? 1 : -1;

  // Wounded frenzy: below 30% HP, move faster and attack more aggressively
  const frenzied = hpRatio < 0.3;
  const speedMult = frenzied ? 1.4 : 1.0;
  const attackCdMult = frenzied ? 0.6 : 1.0;

  // Lunge attack: charge forward when at medium range
  const lungeCd = enemy.abilityCooldowns.get('lunge') || 0;
  if (lungeCd <= 0 && d > 40 && d < 90) {
    enemy.abilityCooldowns.set('lunge', 5);
    // Dash toward target
    const dir = dirTo(enemy.pos, target.pos);
    const lungeDistance = Math.min(d - 15, 60);
    enemy.pos.x += dir.x * lungeDistance;
    enemy.pos.y += dir.y * lungeDistance;
    enemy.animState = 'attack';
    // Deal lunge damage
    processDamage({
      attackerId: enemy.id,
      targetId: target.id,
      baseDamage: Math.round(enemy.def.damage * 1.3),
      damageType: 'physical',
      tags: ['Physical', 'Melee'],
      isProjectile: false,
    }, state);
    clampToArena(enemy);
    return;
  }

  // Pack flanking: if 2+ allies nearby, circle around to attack from side
  const nearbyAllies = countNearbyAllies(state, enemy, 120);
  const shouldFlank = nearbyAllies >= 1 && d > enemy.def.attackRange && d < 120;

  if (d > enemy.def.attackRange) {
    let dir: Vec2;
    if (shouldFlank) {
      dir = getFlankDir(enemy, target, flankSide);
    } else {
      dir = dirTo(enemy.pos, target.pos);
    }
    enemy.pos.x += dir.x * enemy.speed * speedMult * dt;
    enemy.pos.y += dir.y * enemy.speed * speedMult * dt;
    enemy.rotation = Math.atan2(dir.y, dir.x);
    enemy.animState = 'move';
  } else {
    // Attack
    const cd = enemy.abilityCooldowns.get('basic_attack') || 0;
    if (cd <= 0) {
      enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown * attackCdMult);
      enemy.animState = 'attack';
      // Pack bonus: +15% damage per nearby ally (max +45%)
      const packBonus = Math.min(nearbyAllies * 0.15, 0.45);
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: Math.round(enemy.def.damage * (1 + packBonus)),
        damageType: 'physical',
        tags: ['Physical', 'Melee'],
        isProjectile: false,
      }, state);
    } else {
      // Circle strafe while waiting for attack cooldown
      if (d < enemy.def.attackRange * 0.8) {
        const strafeDir = getFlankDir(enemy, target, flankSide);
        enemy.pos.x += strafeDir.x * enemy.speed * 0.4 * dt;
        enemy.pos.y += strafeDir.y * enemy.speed * 0.4 * dt;
      }
      enemy.animState = 'idle';
    }
  }

  clampToArena(enemy);
}

// =====================================================
// RANGED SPITTER - Mushroom Spitter
// Behaviors: Burst fire, leading shots, retreat dash,
// spore mine placement, sniper stance
// =====================================================
function rangedSpitterAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const preferredRange = enemy.def.attackRange * 0.7;

  // Retreat dash: if player gets too close, jump backwards
  const retreatCd = enemy.abilityCooldowns.get('retreat_dash') || 0;
  if (retreatCd <= 0 && d < preferredRange * 0.35) {
    enemy.abilityCooldowns.set('retreat_dash', 6);
    const awayDir = dirTo(target.pos, enemy.pos);
    enemy.pos.x += awayDir.x * 70;
    enemy.pos.y += awayDir.y * 70;

    // Drop a spore mine at old position during retreat
    const mine: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { x: enemy.pos.x - awayDir.x * 70, y: enemy.pos.y - awayDir.y * 70 },
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
    clampToArena(enemy);
    return;
  }

  // Maintain distance
  if (d < preferredRange * 0.5) {
    const dir = dirTo(target.pos, enemy.pos);
    enemy.pos.x += dir.x * enemy.speed * 1.3 * dt; // Faster retreat
    enemy.pos.y += dir.y * enemy.speed * 1.3 * dt;
    enemy.animState = 'move';
  } else if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * dt;
    enemy.pos.y += dir.y * enemy.speed * dt;
    enemy.animState = 'move';
  }

  // Burst fire: fire 3 projectiles in quick succession every 6 seconds
  const burstCd = enemy.abilityCooldowns.get('burst_fire') || 0;
  const cd = enemy.abilityCooldowns.get('basic_attack') || 0;

  if (burstCd <= 0 && d <= enemy.def.attackRange && d > preferredRange * 0.3) {
    enemy.abilityCooldowns.set('burst_fire', 7);
    enemy.animState = 'attack';

    // Fire a spread of 3 projectiles
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
  } else if (cd <= 0 && d <= enemy.def.attackRange) {
    // Normal shot: lead the target based on velocity
    enemy.abilityCooldowns.set('basic_attack', enemy.def.attackCooldown);
    enemy.animState = 'attack';

    // Lead the shot: predict target position
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
// Behaviors: Shield stance (damage reduction), charge attack,
// ground slam with telegraph, stomp shockwave, enrage at low HP
// =====================================================
function tankAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);
  const hpRatio = enemy.hp / enemy.maxHp;

  // Enrage below 25% HP: faster attacks, more damage
  const enraged = hpRatio < 0.25;
  const damageMult = enraged ? 1.5 : 1.0;

  // Shield stance: when taking ranged fire, periodically raise guard
  const shieldCd = enemy.abilityCooldowns.get('shield_stance') || 0;
  if (shieldCd <= 0 && d > 60) {
    // Activate shield stance for 2 seconds (tracked via behaviorState)
    enemy.abilityCooldowns.set('shield_stance', 8);
    enemy.behaviorState = 'shielding';
    enemy.abilityCooldowns.set('shield_end', 2);
  }

  // End shield stance
  const shieldEnd = enemy.abilityCooldowns.get('shield_end') || 0;
  if (enemy.behaviorState === 'shielding' && shieldEnd <= 0) {
    enemy.behaviorState = 'chase';
  }

  // While shielding, move slower but take reduced damage (tracked in processDamage checks)
  const moveMult = enemy.behaviorState === 'shielding' ? 0.3 : 1.0;

  // Charge attack: rush at distant target
  const chargeCd = enemy.abilityCooldowns.get('charge') || 0;
  if (chargeCd <= 0 && d > 80 && d < 200 && enemy.behaviorState !== 'shielding') {
    enemy.abilityCooldowns.set('charge', 8);
    const dir = dirTo(enemy.pos, target.pos);
    const chargeDist = Math.min(d - 20, 100);
    enemy.pos.x += dir.x * chargeDist;
    enemy.pos.y += dir.y * chargeDist;
    enemy.animState = 'attack';
    // Charge impact damage to everything near landing
    [...state.entities, state.player].forEach(e => {
      if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < 36) {
        processDamage({
          attackerId: enemy.id,
          targetId: e.id,
          baseDamage: Math.round(10 * damageMult),
          damageType: 'physical',
          tags: ['Physical', 'AOE'],
          isProjectile: false,
        }, state);
      }
    });
    clampToArena(enemy);
    return;
  }

  if (d > enemy.def.attackRange) {
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * moveMult * dt;
    enemy.pos.y += dir.y * enemy.speed * moveMult * dt;
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

    // Ground slam ability - larger AOE, targets clusters of player entities
    const slamCd = enemy.abilityCooldowns.get('ground_slam') || 0;
    const slamRadius = enraged ? 64 : 48;
    if (slamCd <= 0 && d < 50) {
      enemy.abilityCooldowns.set('ground_slam', enraged ? 4 : 6);
      // AOE damage around self
      [...state.entities, state.player].forEach(e => {
        if (e.alive && e.faction === 'player' && dist(e.pos, enemy.pos) < slamRadius) {
          processDamage({
            attackerId: enemy.id,
            targetId: e.id,
            baseDamage: Math.round(12 * damageMult),
            damageType: 'physical',
            tags: ['Physical', 'AOE'],
            isProjectile: false,
          }, state);
        }
      });
    }

    // Stomp shockwave: send a line of hazards toward the target
    const stompCd = enemy.abilityCooldowns.get('stomp_wave') || 0;
    if (stompCd <= 0 && d < 80 && d > 30) {
      enemy.abilityCooldowns.set('stomp_wave', 10);
      const dir = dirTo(enemy.pos, target.pos);
      // Create 3 hazard zones in a line toward target
      for (let i = 1; i <= 3; i++) {
        const hazard: HazardEntity = {
          id: genId(),
          type: 'hazard',
          pos: {
            x: enemy.pos.x + dir.x * (30 * i),
            y: enemy.pos.y + dir.y * (30 * i),
          },
          vel: { x: 0, y: 0 },
          hp: 1, maxHp: 1,
          radius: 24,
          speed: 0,
          faction: 'enemy',
          tags: ['Physical', 'AOE'],
          alive: true,
          invulnMs: 0, flashMs: 0, deathAnimMs: 0,
          animState: 'idle',
          rotation: 0,
          ownerId: enemy.id,
          damage: 8,
          tickRate: 0.3,
          tickTimer: 0.3 + i * 0.2, // Staggered activation
          duration: 1.5,
          maxDuration: 1.5,
        };
        state.entities.push(hazard);
      }
    }
  }

  clampToArena(enemy);
}

// =====================================================
// BLINKER - Shadow Imp
// Behaviors: Hit-and-run teleport, backstab bonus, afterimage decoy,
// shadow dodge, multi-blink combo
// =====================================================
function blinkerAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  // Track attack count for combo behavior
  const attacksSinceBlink = enemy.abilityCooldowns.get('attacks_since_blink') || 0;

  // Shadow blink: teleport behind target for backstab
  const blinkCd = enemy.abilityCooldowns.get('shadow_blink') || 0;
  if (blinkCd <= 0 && (d > 60 || attacksSinceBlink >= 2)) {
    enemy.abilityCooldowns.set('shadow_blink', 3.5);
    enemy.abilityCooldowns.set('attacks_since_blink', 0);

    // Teleport behind target (opposite of their facing direction)
    const behindAngle = target.rotation + Math.PI;
    const offset = 25 + Math.random() * 10;
    enemy.pos.x = target.pos.x + Math.cos(behindAngle) * offset;
    enemy.pos.y = target.pos.y + Math.sin(behindAngle) * offset;

    // Immediate backstab attack on arrival
    enemy.animState = 'attack';
    processDamage({
      attackerId: enemy.id,
      targetId: target.id,
      baseDamage: Math.round(enemy.def.damage * 1.5), // Backstab bonus
      damageType: 'physical',
      tags: ['Spirit', 'Melee'],
      isProjectile: false,
    }, state);
    clampToArena(enemy);
    return;
  }

  // Shadow dodge: briefly become harder to hit when at low HP
  const dodgeCd = enemy.abilityCooldowns.get('shadow_dodge') || 0;
  if (dodgeCd <= 0 && enemy.hp < enemy.maxHp * 0.4 && d < 50) {
    enemy.abilityCooldowns.set('shadow_dodge', 8);
    // Short invulnerability blink
    enemy.invulnMs = 400;
    // Reposition to a random spot near target
    const angle = Math.random() * Math.PI * 2;
    enemy.pos.x = target.pos.x + Math.cos(angle) * 50;
    enemy.pos.y = target.pos.y + Math.sin(angle) * 50;
    clampToArena(enemy);
    return;
  }

  // Multi-blink: at low HP, chain teleport around target
  const multiBlink = enemy.abilityCooldowns.get('multi_blink') || 0;
  if (multiBlink <= 0 && enemy.hp < enemy.maxHp * 0.5 && d < 100) {
    enemy.abilityCooldowns.set('multi_blink', 12);
    // Quick 2-hit combo from different angles
    for (let i = 0; i < 2; i++) {
      const angle = (Math.PI * 2 / 3) * i + Math.random() * 0.5;
      const hitPos = {
        x: target.pos.x + Math.cos(angle) * 28,
        y: target.pos.y + Math.sin(angle) * 28,
      };
      // Only process damage (visual will show as rapid movement)
      processDamage({
        attackerId: enemy.id,
        targetId: target.id,
        baseDamage: Math.round(enemy.def.damage * 0.7),
        damageType: 'physical',
        tags: ['Spirit', 'Melee'],
        isProjectile: false,
      }, state);
      enemy.pos = hitPos;
    }
    enemy.animState = 'attack';
    clampToArena(enemy);
    return;
  }

  if (d <= enemy.def.attackRange) {
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

      // After attacking, dash away slightly to avoid standing still
      const awayDir = dirTo(target.pos, enemy.pos);
      enemy.pos.x += awayDir.x * 15;
      enemy.pos.y += awayDir.y * 15;
    }
  } else {
    // Move toward target with erratic zigzag pattern
    const dir = dirTo(enemy.pos, target.pos);
    const zigzag = Math.sin(Date.now() * 0.005 + parseInt(enemy.id.replace(/\D/g, '')) * 1.7) * 0.6;
    const moveAngle = Math.atan2(dir.y, dir.x) + zigzag;
    enemy.pos.x += Math.cos(moveAngle) * enemy.speed * dt;
    enemy.pos.y += Math.sin(moveAngle) * enemy.speed * dt;
    enemy.animState = 'move';
  }

  enemy.rotation = Math.atan2(target.pos.y - enemy.pos.y, target.pos.x - enemy.pos.x);
  clampToArena(enemy);
}

// =====================================================
// HAZARD GENERATOR - Toxic Shroom
// Behaviors: Chain hazards, defensive cloud, corridor denial,
// spore burst on damage, fungal link to other hazard generators
// =====================================================
function hazardGeneratorAI(enemy: EnemyEntity, target: Entity, state: RunState, dt: number) {
  const d = dist(enemy.pos, target.pos);

  // Count existing hazards from this enemy
  const ownHazardCount = state.entities.filter(
    e => e.type === 'hazard' && e.alive && (e as HazardEntity).ownerId === enemy.id
  ).length;

  // Defensive cloud: if player gets close, drop a hazard at feet and flee
  const defensiveCd = enemy.abilityCooldowns.get('defensive_cloud') || 0;
  if (defensiveCd <= 0 && d < 50) {
    enemy.abilityCooldowns.set('defensive_cloud', 4);
    const defenseCloud: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { x: enemy.pos.x, y: enemy.pos.y },
      vel: { x: 0, y: 0 },
      hp: 1, maxHp: 1,
      radius: 36,
      speed: 0,
      faction: 'enemy',
      tags: ['Poison', 'AOE', 'DOT'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: enemy.id,
      damage: 6,
      tickRate: 0.3,
      tickTimer: 0,
      duration: 3,
      maxDuration: 3,
    };
    state.entities.push(defenseCloud);
  }

  // Maintain distance - flee faster when close
  if (d < 80) {
    const dir = dirTo(target.pos, enemy.pos);
    const fleeSpeed = d < 40 ? enemy.speed * 1.5 : enemy.speed;
    enemy.pos.x += dir.x * fleeSpeed * dt;
    enemy.pos.y += dir.y * fleeSpeed * dt;
    enemy.animState = 'move';
  } else if (d > 160) {
    // Don't stray too far; move closer to keep in hazard range
    const dir = dirTo(enemy.pos, target.pos);
    enemy.pos.x += dir.x * enemy.speed * 0.5 * dt;
    enemy.pos.y += dir.y * enemy.speed * 0.5 * dt;
    enemy.animState = 'move';
  }

  // Corridor denial: place hazards to cut off escape routes
  const corridorCd = enemy.abilityCooldowns.get('corridor_denial') || 0;
  if (corridorCd <= 0 && ownHazardCount < 4) {
    enemy.abilityCooldowns.set('corridor_denial', 8);
    // Place 2 hazards flanking the player's movement direction
    const moveAngle = Math.atan2(target.vel.y, target.vel.x);
    const isMoving = Math.abs(target.vel.x) > 10 || Math.abs(target.vel.y) > 10;

    if (isMoving) {
      for (let i = -1; i <= 1; i += 2) {
        const perpAngle = moveAngle + i * (Math.PI / 2);
        const hazard: HazardEntity = {
          id: genId(),
          type: 'hazard',
          pos: {
            x: target.pos.x + Math.cos(moveAngle) * 60 + Math.cos(perpAngle) * 30,
            y: target.pos.y + Math.sin(moveAngle) * 60 + Math.sin(perpAngle) * 30,
          },
          vel: { x: 0, y: 0 },
          hp: 1, maxHp: 1,
          radius: 36,
          speed: 0,
          faction: 'enemy',
          tags: ['Poison', 'AOE', 'DOT'],
          alive: true,
          invulnMs: 0, flashMs: 0, deathAnimMs: 0,
          animState: 'idle',
          rotation: 0,
          ownerId: enemy.id,
          damage: 3,
          tickRate: 0.5,
          tickTimer: 0.5,
          duration: 5,
          maxDuration: 5,
        };
        state.entities.push(hazard);
      }
    }
  }

  // Main hazard spawn - targeted placement
  const cd = enemy.abilityCooldowns.get('spawn_gas_cloud') || 0;
  if (cd <= 0 && ownHazardCount < 5) {
    enemy.abilityCooldowns.set('spawn_gas_cloud', 4.5);
    enemy.animState = 'attack';

    // Place hazard where the target is heading, or at their position
    let hazardX = target.pos.x;
    let hazardY = target.pos.y;
    const isMoving = Math.abs(target.vel.x) > 10 || Math.abs(target.vel.y) > 10;
    if (isMoving) {
      hazardX += target.vel.x * 0.4;
      hazardY += target.vel.y * 0.4;
    }
    hazardX += (Math.random() - 0.5) * 30;
    hazardY += (Math.random() - 0.5) * 30;

    const hazard: HazardEntity = {
      id: genId(),
      type: 'hazard',
      pos: { x: hazardX, y: hazardY },
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

  // Spore burst: when taking damage, nearby hazards deal an extra tick
  // (tracked via flash check - enemy flashes when hit)
  if (enemy.flashMs > 0 && enemy.flashMs < 100) {
    const sporeBurstCd = enemy.abilityCooldowns.get('spore_burst') || 0;
    if (sporeBurstCd <= 0) {
      enemy.abilityCooldowns.set('spore_burst', 3);
      state.entities.forEach(e => {
        if (e.type === 'hazard' && e.alive && (e as HazardEntity).ownerId === enemy.id) {
          const hazard = e as HazardEntity;
          // Boost existing hazards briefly
          hazard.duration = Math.min(hazard.duration + 1.5, hazard.maxDuration + 2);
        }
      });
    }
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
