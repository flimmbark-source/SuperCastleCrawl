import type {
  Entity, PlayerEntity, EnemyEntity, SummonEntity, ProjectileEntity,
  HazardEntity, RunState, Vec2, Tag, CombatLogEntry
} from '../types';
import { HARD_CAPS } from '../types';
import { addCombatLog } from '../engine/RunState';

// --- Geometry helpers ---
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function dirTo(from: Vec2, to: Vec2): Vec2 {
  return normalize({ x: to.x - from.x, y: to.y - from.y });
}

// --- Trigger chain tracking ---
interface TriggerContext {
  depth: number;
  triggerCounts: Map<string, number>;
  spawnCount: number;
}

function newTriggerContext(): TriggerContext {
  return { depth: 0, triggerCounts: new Map(), spawnCount: 0 };
}

function canTrigger(ctx: TriggerContext, triggerId: string): boolean {
  if (ctx.depth >= HARD_CAPS.maxTriggerChainDepth) return false;
  const count = ctx.triggerCounts.get(triggerId) || 0;
  if (count >= HARD_CAPS.maxSameTriggerRepeats) return false;
  return true;
}

function recordTrigger(ctx: TriggerContext, triggerId: string) {
  ctx.depth++;
  ctx.triggerCounts.set(triggerId, (ctx.triggerCounts.get(triggerId) || 0) + 1);
}

function canSpawn(ctx: TriggerContext): boolean {
  return ctx.spawnCount < HARD_CAPS.maxSpawnedFromEvent;
}

// --- Combat Resolution ---
export interface DamageEvent {
  attackerId: string;
  targetId: string;
  baseDamage: number;
  damageType: string;
  tags: Tag[];
  isProjectile: boolean;
}

export interface DamageResult {
  finalDamage: number;
  dodged: boolean;
  killed: boolean;
  blocked: boolean;
}

export function processDamage(
  event: DamageEvent,
  state: RunState,
  triggerCtx?: TriggerContext,
): DamageResult {
  const ctx = triggerCtx || newTriggerContext();
  const target = findEntity(state, event.targetId);
  const attacker = findEntity(state, event.attackerId);

  if (!target || !target.alive || !attacker) {
    return { finalDamage: 0, dodged: false, killed: false, blocked: false };
  }

  // 1. Target validity - already checked

  // 2. Avoidance check (simple dodge based on invuln)
  if (target.invulnMs > 0) {
    return { finalDamage: 0, dodged: true, killed: false, blocked: false };
  }

  // 3. Mitigation (armor for physical)
  let mitigated = event.baseDamage;
  if (event.damageType === 'physical' && 'armor' in target) {
    const armor = (target as any).armor || 0;
    const reduction = Math.min(armor * 0.5, mitigated * HARD_CAPS.maxDamageReduction);
    mitigated = Math.max(1, mitigated - reduction);
  }

  // Apply player damage scalar for player/summon attacks
  if (attacker.faction === 'player' && attacker.type === 'player') {
    mitigated *= (attacker as PlayerEntity).damageScalar;
  }

  // 4. Damage application
  const finalDamage = Math.round(mitigated);
  target.hp -= finalDamage;
  target.flashMs = 150;
  target.animState = 'hit';

  addCombatLog(state, {
    type: 'damage',
    source: attacker.id,
    target: target.id,
    value: finalDamage,
    details: `${attacker.id} dealt ${finalDamage} ${event.damageType} to ${target.id}`,
  });

  // 5. OnDamageTaken triggers
  if (canTrigger(ctx, 'OnDamageTaken')) {
    recordTrigger(ctx, 'OnDamageTaken');
    processOnDamageTakenTriggers(target, attacker, finalDamage, state, ctx);
  }

  // 6. OnHit (attacker) triggers
  if (canTrigger(ctx, 'OnHit')) {
    recordTrigger(ctx, 'OnHit');
    processOnHitTriggers(attacker, target, finalDamage, state, ctx);
  }

  // 7. OnHitTaken (defender reactive)
  // Already handled in OnDamageTaken

  // 8. Lethal check
  const killed = target.hp <= 0;
  if (killed) {
    target.hp = 0;
    target.alive = false;
    target.animState = 'death';
    target.deathAnimMs = 500;

    // 9. OnKill / OnDeath
    if (canTrigger(ctx, 'OnKill')) {
      recordTrigger(ctx, 'OnKill');
      processOnKillTriggers(attacker, target, state, ctx);
    }
    if (canTrigger(ctx, 'OnDeath')) {
      recordTrigger(ctx, 'OnDeath');
      processOnDeathTriggers(target, attacker, state, ctx);
    }

    addCombatLog(state, {
      type: 'kill',
      source: attacker.id,
      target: target.id,
      details: `${attacker.id} killed ${target.id}`,
    });
  }

  // Record trigger depth
  if (ctx.depth > 0) {
    state.triggerChainDepths.push(ctx.depth);
  }

  return { finalDamage, dodged: false, killed, blocked: false };
}

function processOnDamageTakenTriggers(
  target: Entity, attacker: Entity, damage: number,
  state: RunState, ctx: TriggerContext
) {
  if (target.type === 'player') {
    const player = target as PlayerEntity;
    // Spore Mantle
    const sporeMantle = player.passives.find(p => p.def.id === 'spore_mantle');
    if (sporeMantle && sporeMantle.active) {
      // Spawn poison cloud (handled by effect system)
    }
    // Thorned Hide
    const thornedHide = player.passives.find(p => p.def.id === 'thorned_hide');
    if (thornedHide && thornedHide.active && attacker.faction === 'enemy') {
      const reflectDmg = Math.round(damage * 0.25);
      if (reflectDmg > 0) {
        attacker.hp -= reflectDmg;
        if (attacker.hp <= 0) {
          attacker.hp = 0;
          attacker.alive = false;
          attacker.animState = 'death';
          attacker.deathAnimMs = 500;
        }
      }
    }
  }
}

function processOnHitTriggers(
  attacker: Entity, target: Entity, damage: number,
  state: RunState, ctx: TriggerContext
) {
  if (attacker.type === 'player') {
    const player = attacker as PlayerEntity;
    // Check for poison application items
    const venomweave = player.items.find(i => i.def.id === 'venomweave_cloak');
    if (venomweave && target.type === 'enemy') {
      const enemy = target as EnemyEntity;
      enemy.poisonStacks = Math.min(HARD_CAPS.maxPoisonStacks, enemy.poisonStacks + 1);
    }
  }
}

function processOnKillTriggers(
  attacker: Entity, target: Entity,
  state: RunState, ctx: TriggerContext
) {
  if (attacker.faction === 'player') {
    // Feral Momentum
    const player = state.player;
    const feralMomentum = player.passives.find(p => p.def.id === 'feral_momentum');
    if (feralMomentum && feralMomentum.active) {
      player.damageScalar = Math.min(player.damageScalar + 0.08, 1.0 + 0.08 * 5);
    }

    // Toxic Proliferation
    if (target.type === 'enemy') {
      const enemy = target as EnemyEntity;
      const toxicProliferation = player.passives.find(p => p.def.id === 'toxic_proliferation');
      if (toxicProliferation && toxicProliferation.active && enemy.poisonStacks > 0) {
        const spreadStacks = Math.floor(enemy.poisonStacks * 0.5);
        if (spreadStacks > 0 && canSpawn(ctx)) {
          const nearby = state.entities.filter(
            e => e.alive && e.faction === 'enemy' && e.id !== target.id && dist(e.pos, target.pos) < 80
          ) as EnemyEntity[];
          nearby.forEach(ne => {
            ne.poisonStacks = Math.min(HARD_CAPS.maxPoisonStacks, ne.poisonStacks + spreadStacks);
          });
        }
      }
    }
  }
}

function processOnDeathTriggers(
  target: Entity, attacker: Entity,
  state: RunState, ctx: TriggerContext
) {
  // Death Blossom for summons
  if (target.type === 'summon' && target.faction === 'player') {
    const player = state.player;
    const deathBlossom = player.passives.find(p => p.def.id === 'death_blossom');
    if (deathBlossom && deathBlossom.active) {
      // AOE damage at summon death position
      state.entities
        .filter(e => e.alive && e.faction === 'enemy' && dist(e.pos, target.pos) < 48)
        .forEach(e => {
          e.hp -= 15;
          e.flashMs = 100;
          if (e.hp <= 0) {
            e.hp = 0;
            e.alive = false;
            e.animState = 'death';
            e.deathAnimMs = 500;
          }
        });
    }
  }
}

export function findEntity(state: RunState, id: string): Entity | undefined {
  if (id === 'player') return state.player;
  return state.entities.find(e => e.id === id);
}

// --- Collision ---
export function checkCircleCollision(a: Entity, b: Entity): boolean {
  return dist(a.pos, b.pos) < a.radius + b.radius;
}

// --- Poison tick processing ---
export function processPoison(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (!e.alive || e.type !== 'enemy') return;
    const enemy = e as EnemyEntity;
    if (enemy.poisonStacks > 0) {
      // 2 damage per stack per second
      const poisonDmg = enemy.poisonStacks * 2 * dt;
      enemy.hp -= poisonDmg;
      if (enemy.hp <= 0) {
        enemy.hp = 0;
        enemy.alive = false;
        enemy.animState = 'death';
        enemy.deathAnimMs = 500;
        addCombatLog(state, {
          type: 'kill',
          source: 'poison',
          target: enemy.id,
          details: `${enemy.id} killed by poison (${enemy.poisonStacks} stacks)`,
        });
        // Update death cause taxonomy
        const key = 'DoT';
        state.deathCauseTaxonomy.set(key, (state.deathCauseTaxonomy.get(key) || 0) + 1);
      }
    }
  });
}

// --- Projectile updates ---
export function updateProjectiles(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (e.type !== 'projectile' || !e.alive) return;
    const proj = e as ProjectileEntity;
    proj.pos.x += proj.vel.x * dt;
    proj.pos.y += proj.vel.y * dt;
    proj.lifetime -= dt;
    if (proj.lifetime <= 0) {
      proj.alive = false;
      return;
    }

    // Check collisions
    const targets = state.entities.filter(t =>
      t.alive && t.faction !== proj.faction && !proj.hitEntities.has(t.id)
      && t.type !== 'projectile' && t.type !== 'hazard'
    );
    // Also check player
    if (proj.faction === 'enemy' && state.player.alive && !proj.hitEntities.has('player')) {
      targets.push(state.player);
    }

    for (const target of targets) {
      if (dist(proj.pos, target.pos) < proj.radius + target.radius) {
        proj.hitEntities.add(target.id);
        processDamage({
          attackerId: proj.ownerId,
          targetId: target.id,
          baseDamage: proj.damage,
          damageType: 'physical',
          tags: [],
          isProjectile: true,
        }, state);

        if (!proj.piercing) {
          proj.alive = false;
          break;
        }
      }
    }
  });
}

// --- Hazard updates ---
export function updateHazards(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (e.type !== 'hazard' || !e.alive) return;
    const hazard = e as HazardEntity;
    hazard.duration -= dt;
    if (hazard.duration <= 0) {
      hazard.alive = false;
      return;
    }
    hazard.tickTimer -= dt;
    if (hazard.tickTimer <= 0) {
      hazard.tickTimer = hazard.tickRate;
      // Damage entities in range
      const targetFaction = hazard.faction === 'player' ? 'enemy' : 'player';
      state.entities.forEach(t => {
        if (t.alive && t.faction === targetFaction && dist(t.pos, hazard.pos) < hazard.radius) {
          processDamage({
            attackerId: hazard.ownerId,
            targetId: t.id,
            baseDamage: hazard.damage,
            damageType: 'poison',
            tags: ['DOT'],
            isProjectile: false,
          }, state);
        }
      });
      // Also check player
      if (targetFaction === 'player' && state.player.alive && dist(state.player.pos, hazard.pos) < hazard.radius) {
        processDamage({
          attackerId: hazard.ownerId,
          targetId: 'player',
          baseDamage: hazard.damage,
          damageType: 'poison',
          tags: ['DOT'],
          isProjectile: false,
        }, state);
      }
    }
  });
}

// --- Summon updates ---
export function updateSummons(state: RunState, dt: number) {
  state.entities.forEach(e => {
    if (e.type !== 'summon' || !e.alive) return;
    const summon = e as SummonEntity;
    summon.duration -= dt;
    if (summon.duration <= 0) {
      summon.alive = false;
      return;
    }

    // Apply passive bonuses
    const player = state.player;
    const activeSummons = state.entities.filter(s => s.type === 'summon' && s.alive && s.faction === 'player');
    let damageMult = 1.0;

    // Pack Tactics
    const packTactics = player.passives.find(p => p.def.id === 'pack_tactics');
    if (packTactics && packTactics.active && activeSummons.length >= 2) {
      damageMult += 0.20;
    }

    // Alpha Bond
    const alphaBond = player.passives.find(p => p.def.id === 'alpha_bond');
    if (alphaBond && alphaBond.active && activeSummons.length === 1) {
      damageMult += 0.60;
      summon.speed = 4.2 * 32 * 1.25;
    }

    // Find nearest enemy and move toward it
    const nearestEnemy = findNearestEnemy(state, summon.pos);
    if (nearestEnemy) {
      const d = dist(summon.pos, nearestEnemy.pos);
      if (d > summon.attackRange) {
        const dir = dirTo(summon.pos, nearestEnemy.pos);
        summon.pos.x += dir.x * summon.speed * dt;
        summon.pos.y += dir.y * summon.speed * dt;
        summon.animState = 'move';
      } else {
        summon.attackCooldownRemaining -= dt;
        if (summon.attackCooldownRemaining <= 0) {
          summon.attackCooldownRemaining = summon.attackCooldown;
          summon.animState = 'attack';
          processDamage({
            attackerId: summon.id,
            targetId: nearestEnemy.id,
            baseDamage: summon.damage * damageMult,
            damageType: 'physical',
            tags: ['Summon', 'Melee'],
            isProjectile: false,
          }, state);
        } else {
          summon.animState = 'idle';
        }
      }
    } else {
      // Follow player
      const d = dist(summon.pos, state.player.pos);
      if (d > 60) {
        const dir = dirTo(summon.pos, state.player.pos);
        summon.pos.x += dir.x * summon.speed * dt;
        summon.pos.y += dir.y * summon.speed * dt;
        summon.animState = 'move';
      } else {
        summon.animState = 'idle';
      }
    }
  });
}

export function findNearestEnemy(state: RunState, pos: Vec2): EnemyEntity | undefined {
  let nearest: EnemyEntity | undefined;
  let minDist = Infinity;
  state.entities.forEach(e => {
    if (e.type === 'enemy' && e.alive) {
      const d = dist(pos, e.pos);
      if (d < minDist) {
        minDist = d;
        nearest = e as EnemyEntity;
      }
    }
  });
  return nearest;
}

export function findNearestPlayerAlly(state: RunState, pos: Vec2): Entity | undefined {
  let nearest: Entity | undefined = state.player;
  let minDist = dist(pos, state.player.pos);
  state.entities.forEach(e => {
    if (e.type === 'summon' && e.alive && e.faction === 'player') {
      const d = dist(pos, e.pos);
      if (d < minDist) {
        minDist = d;
        nearest = e;
      }
    }
  });
  return nearest;
}

// --- Entity cleanup ---
export function cleanupEntities(state: RunState) {
  state.entities = state.entities.filter(e => {
    if (!e.alive && e.deathAnimMs <= 0) return false;
    return true;
  });
}

// --- Timer updates ---
export function updateTimers(state: RunState, dt: number) {
  const updateEntity = (e: Entity) => {
    if (e.invulnMs > 0) e.invulnMs -= dt * 1000;
    if (e.flashMs > 0) e.flashMs -= dt * 1000;
    if (!e.alive && e.deathAnimMs > 0) e.deathAnimMs -= dt * 1000;
    if (e.animState === 'hit' && e.flashMs <= 0 && e.alive) {
      e.animState = 'idle';
    }
  };
  updateEntity(state.player);
  state.entities.forEach(updateEntity);
}

// --- Regen ---
export function processRegen(state: RunState, dt: number) {
  const player = state.player;
  if (!player.alive) return;

  // Living Moss Shield regen
  const mossShield = player.items.find(i => i.def.id === 'living_moss_shield');
  if (mossShield) {
    player.hp = Math.min(player.maxHp, player.hp + 2 * dt / 3);
  }

  // Verdant Pulse handled by periodic timer (simplified here)
}
