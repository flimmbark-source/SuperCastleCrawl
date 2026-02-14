import type {
  RunState, PlayerEntity, Entity, SummonEntity,
  ProjectileEntity, ActiveSkill, NodeType, Vec2, Tag
} from '../types';
import { HARD_CAPS, xpForLevel } from '../types';
import { SeededRNG } from './SeededRNG';
import { GameLoop } from './GameLoop';
import { InputManager } from './InputManager';
import { Renderer } from '../renderer/Renderer';
import type { RenderConfig } from '../renderer/Renderer';
import { createRunState, getCurrentNode, advanceNode, addCombatLog, updateBuildTags } from './RunState';
import { registry } from './DataRegistry';
import {
  processDamage, processPoison, updateProjectiles, updateHazards,
  updateSummons, cleanupEntities, updateTimers, processRegen,
  dist, dirTo, findNearestEnemy
} from '../systems/CombatSystem';
import { awardXP, XP_REWARDS, generateLevelUpOffers, applyLevelUpChoice } from '../systems/LevelSystem';
import { rollDrops, applyDrops, checkPityDrop } from '../systems/DropSystem';
import { updateEnemyAI, spawnEnemiesForNode } from '../systems/EnemyAI';
import type { LevelUpOffer } from '../types';
import type { AccessibilitySettings } from '../types';

export type GamePhase =
  | 'menu'
  | 'map'
  | 'combat'
  | 'levelup'
  | 'shrine'
  | 'recovery'
  | 'event'
  | 'victory'
  | 'defeat'
  | 'build_summary';

export interface GameCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onLevelUp: (offers: LevelUpOffer[]) => void;
  onStateUpdate: (state: RunState) => void;
  onNodeComplete: () => void;
  onRunEnd: (won: boolean) => void;
}

const ARENA_SIZE = 13 * 32;

export class Game {
  private loop: GameLoop;
  private input: InputManager;
  private renderer!: Renderer;
  private rng: SeededRNG;
  state: RunState;
  phase: GamePhase = 'menu';
  private callbacks: GameCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private pendingLevelUps = 0;
  private roomClearAwarded = false;
  private onboardingStep = 0;
  private periodicTimers: Map<string, number> = new Map();
  private settings: AccessibilitySettings;

  // Skill auto-attack
  private autoAttackTimer = 0;
  private autoAttackCooldown = 0.6;

  constructor(seed: number, callbacks: GameCallbacks, settings: AccessibilitySettings) {
    this.rng = new SeededRNG(seed);
    this.state = createRunState(seed);
    this.callbacks = callbacks;
    this.settings = settings;
    this.input = new InputManager(settings.keyBindings as any);

    this.loop = new GameLoop(
      (dt) => this.update(dt),
      (interp) => this.render(interp)
    );
    this.loop.gameSpeed = settings.gameSpeed;
  }

  attachCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    this.renderer = new Renderer(canvas, {
      colorblindMode: this.settings.colorblindMode,
      reducedMotion: this.settings.reducedMotion,
      screenShake: this.settings.screenShake,
    });
    this.input.attach(canvas);
  }

  updateSettings(settings: AccessibilitySettings) {
    this.settings = settings;
    this.loop.gameSpeed = settings.gameSpeed;
    if (this.renderer) {
      this.renderer.updateConfig({
        colorblindMode: settings.colorblindMode,
        reducedMotion: settings.reducedMotion,
        screenShake: settings.screenShake,
      });
    }
    this.input.setBindings(settings.keyBindings as any);
  }

  start() {
    this.setPhase('map');
    this.loop.start();
  }

  stop() {
    this.loop.stop();
    this.input.detach();
  }

  pause() {
    this.loop.paused = true;
    this.state.paused = true;
  }

  unpause() {
    this.loop.paused = false;
    this.state.paused = false;
  }

  togglePause() {
    if (this.loop.paused) this.unpause();
    else this.pause();
  }

  setPhase(phase: GamePhase) {
    this.phase = phase;
    this.callbacks.onPhaseChange(phase);
  }

  // --- Enter a node ---
  enterNode() {
    const node = getCurrentNode(this.state);
    this.state.entities = [];
    this.roomClearAwarded = false;

    switch (node.type) {
      case 'combat':
        this.startCombat('combat');
        break;
      case 'elite':
        this.startCombat('elite');
        break;
      case 'boss':
        this.startCombat('boss');
        break;
      case 'shrine':
        this.setPhase('shrine');
        break;
      case 'recovery':
        this.setPhase('recovery');
        break;
      case 'event':
        this.setPhase('event');
        break;
    }
  }

  private startCombat(type: 'combat' | 'elite' | 'boss') {
    this.state.combatActive = true;
    this.state.player.pos = { x: 0, y: 100 };
    this.state.player.vel = { x: 0, y: 0 };

    spawnEnemiesForNode(this.state, type, this.state.floor, this.rng);
    this.setPhase('combat');

    addCombatLog(this.state, {
      type: 'damage',
      source: 'system',
      details: `Entered ${type} room (Floor ${this.state.floor})`,
    });
  }

  completeNode() {
    const node = getCurrentNode(this.state);
    node.completed = true;

    // Check pity drop
    const nodeIdx = this.state.currentNodeIndex +
      (this.state.floor - 1) * 9;
    const pityDrop = checkPityDrop(this.state, nodeIdx, this.rng);
    if (pityDrop) {
      applyDrops(this.state, pityDrop);
    }

    const next = advanceNode(this.state);
    if (this.state.runComplete) {
      this.setPhase(this.state.runWon ? 'victory' : 'defeat');
      this.callbacks.onRunEnd(this.state.runWon);
      return;
    }

    // Handle pending level-ups
    if (this.pendingLevelUps > 0) {
      this.showLevelUp();
      return;
    }

    this.callbacks.onNodeComplete();
    this.setPhase('map');
  }

  // --- Level up ---
  showLevelUp() {
    this.pendingLevelUps--;
    const offers = generateLevelUpOffers(this.state, this.rng);
    this.state.offeredHistory.push({
      level: this.state.player.level,
      offered: offers,
      chosen: '',
    });
    this.setPhase('levelup');
    this.callbacks.onLevelUp(offers);
  }

  chooseLevelUp(offerId: string) {
    applyLevelUpChoice(this.state, offerId);

    // Record choice
    const last = this.state.offeredHistory[this.state.offeredHistory.length - 1];
    if (last) last.chosen = offerId;

    if (this.pendingLevelUps > 0) {
      this.showLevelUp();
    } else if (this.phase === 'levelup' && this.state.combatActive) {
      this.setPhase('combat');
    } else {
      this.setPhase('map');
    }
  }

  // --- Recovery ---
  applyRecovery() {
    this.state.player.hp = Math.min(
      this.state.player.maxHp,
      this.state.player.hp + Math.floor(this.state.player.maxHp * 0.3)
    );
    this.state.player.resource = this.state.player.maxResource;
    this.completeNode();
  }

  // --- Event ---
  applyEvent(choice: number) {
    // Simple event: choice 0 = bonus essence, choice 1 = bonus HP
    if (choice === 0) {
      this.state.player.essence += 20;
    } else {
      this.state.player.maxHp += 10;
      this.state.player.hp += 10;
    }
    this.completeNode();
  }

  // --- Show build summary ---
  showBuildSummary() {
    this.setPhase('build_summary');
  }

  // --- Main update ---
  private update(dt: number) {
    this.state.runTime += dt;

    // Input: pause
    if (this.input.isActionJustPressed('pause')) {
      this.togglePause();
    }

    if (this.phase === 'combat') {
      this.updateCombat(dt);
    }

    this.callbacks.onStateUpdate(this.state);
    this.input.endFrame();
  }

  private updateCombat(dt: number) {
    const player = this.state.player;
    if (!player.alive) {
      this.state.runComplete = true;
      this.state.runWon = false;
      this.setPhase('defeat');
      this.callbacks.onRunEnd(false);
      return;
    }

    // --- Player movement ---
    let dx = 0, dy = 0;
    if (this.input.isActionDown('moveUp')) dy -= 1;
    if (this.input.isActionDown('moveDown')) dy += 1;
    if (this.input.isActionDown('moveLeft')) dx -= 1;
    if (this.input.isActionDown('moveRight')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      player.pos.x += dx * player.speed * dt;
      player.pos.y += dy * player.speed * dt;
      player.animState = 'move';
      player.rotation = Math.atan2(dy, dx);
    } else {
      player.animState = 'idle';
    }

    // Clamp player to arena
    player.pos.x = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.x));
    player.pos.y = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.y));

    // --- Player aim (toward mouse) ---
    if (this.canvas) {
      const mousePos = this.input.getMousePos();
      const worldX = mousePos.x + (this.state.player.pos.x - this.canvas.width / 2);
      const worldY = mousePos.y + (this.state.player.pos.y - this.canvas.height / 2);
      player.rotation = Math.atan2(worldY - player.pos.y, worldX - player.pos.x);
    }

    // --- Skill usage ---
    for (let i = 0; i < player.skills.length; i++) {
      const skill = player.skills[i];
      skill.cooldownRemaining = Math.max(0, skill.cooldownRemaining - dt);

      const actionKey = `skill${i + 1}`;
      if (this.input.isActionJustPressed(actionKey) && skill.cooldownRemaining <= 0) {
        this.useSkill(skill, i);
      }
    }

    // --- Auto attack on mouse click ---
    this.autoAttackTimer = Math.max(0, this.autoAttackTimer - dt);
    if (this.input.isMouseDown() && this.autoAttackTimer <= 0) {
      this.autoAttackTimer = this.autoAttackCooldown / player.attackSpeed;
      // Basic attack projectile
      const dir = { x: Math.cos(player.rotation), y: Math.sin(player.rotation) };
      const proj: ProjectileEntity = {
        id: `proj_${Date.now()}_${Math.random()}`,
        type: 'projectile',
        pos: { x: player.pos.x + dir.x * 15, y: player.pos.y + dir.y * 15 },
        vel: { x: dir.x * 300, y: dir.y * 300 },
        hp: 1, maxHp: 1,
        radius: 4,
        speed: 300,
        faction: 'player',
        tags: ['Projectile', 'Physical'],
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: player.rotation,
        ownerId: 'player',
        damage: 8 * player.damageScalar,
        piercing: false,
        lifetime: 1.2,
        maxLifetime: 1.2,
        hitEntities: new Set(),
      };
      this.state.entities.push(proj);
      player.animState = 'attack';
    }

    // --- Systems ---
    updateEnemyAI(this.state, dt);
    updateSummons(this.state, dt);
    updateProjectiles(this.state, dt);
    updateHazards(this.state, dt);
    processPoison(this.state, dt);
    processRegen(this.state, dt);
    updateTimers(this.state, dt);

    // --- Check kills and award XP ---
    this.processKills();

    // --- Check room clear ---
    const livingEnemies = this.state.entities.filter(
      e => e.type === 'enemy' && e.alive
    );
    if (livingEnemies.length === 0 && !this.roomClearAwarded && this.state.combatActive) {
      this.roomClearAwarded = true;
      this.state.combatActive = false;
      const lvl = awardXP(this.state, XP_REWARDS.roomClear);
      if (lvl) this.pendingLevelUps++;

      // Short delay then complete
      setTimeout(() => {
        if (this.pendingLevelUps > 0) {
          this.showLevelUp();
        } else {
          this.completeNode();
        }
      }, 800);
    }

    cleanupEntities(this.state);

    // Periodic timers (verdant pulse, etc.)
    this.updatePeriodicEffects(dt);
  }

  private processKills() {
    const deadEnemies = this.state.entities.filter(
      e => e.type === 'enemy' && !e.alive && e.deathAnimMs > 0 && e.deathAnimMs <= 500
    );

    // Only process newly dead
    deadEnemies.forEach(e => {
      if ((e as any)._xpAwarded) return;
      (e as any)._xpAwarded = true;

      const enemy = e as any;
      const isBoss = enemy.def?.id?.startsWith('boss_');
      const isElite = !!enemy.eliteModifier;

      const xpType = isBoss ? 'boss' : isElite ? 'elite' : 'normal';
      const xp = XP_REWARDS[xpType];
      const leveled = awardXP(this.state, xp);
      if (leveled) this.pendingLevelUps++;

      this.state.killCount++;

      // Roll drops
      const drops = rollDrops(this.state, xpType, this.rng);
      applyDrops(this.state, drops);

      // Particles
      if (this.renderer) {
        this.renderer.spawnParticles(e.pos.x, e.pos.y, '#ff5722', 8);
      }

      // Track death cause
      const cause = isBoss ? 'boss_kill' : isElite ? 'elite_kill' : 'normal_kill';
      // Player death cause tracking in combat log already handles this
    });
  }

  private useSkill(skill: ActiveSkill, index: number) {
    const def = skill.def;
    skill.cooldownRemaining = Math.max(HARD_CAPS.minCooldown, def.cooldown);

    const player = this.state.player;

    // Mycorrhizal Bond - reduce next non-summon cooldown after summon
    if (def.tags.includes('Summon')) {
      const mycBond = player.passives.find(p => p.def.id === 'mycorrhizal_bond');
      if (mycBond && mycBond.active) {
        // Flag for next non-summon skill
        (player as any)._nextCooldownReduction = 0.30;
      }
    } else if ((player as any)._nextCooldownReduction) {
      skill.cooldownRemaining *= (1 - (player as any)._nextCooldownReduction);
      delete (player as any)._nextCooldownReduction;
    }

    if (def.summonId) {
      this.spawnSummon(def);
    } else if (def.projectileSpeed) {
      this.fireSkillProjectile(def);
    } else if (def.aoeRadius) {
      this.useAoeSkill(def);
    } else if (def.id === 'wild_charge') {
      this.useDash(def);
    } else if (def.id === 'fungal_link') {
      // Heal from summon damage for duration (simplified)
      addCombatLog(this.state, {
        type: 'heal',
        source: 'player',
        details: `Activated Fungal Link (${def.duration}s)`,
      });
    }

    addCombatLog(this.state, {
      type: 'trigger',
      source: 'player',
      details: `Used skill: ${def.name}`,
    });
  }

  private spawnSummon(def: typeof this.state.player.skills[0]['def']) {
    const activeSummons = this.state.entities.filter(
      e => e.type === 'summon' && e.alive && e.faction === 'player'
    );

    if (activeSummons.length >= HARD_CAPS.maxActiveSummons) return;
    if (def.maxSummons && activeSummons.filter(s =>
      (s as SummonEntity).summonDefId === def.summonId
    ).length >= def.maxSummons) return;

    const player = this.state.player;
    const angle = Math.random() * Math.PI * 2;
    const summon: SummonEntity = {
      id: `summon_${Date.now()}_${Math.random()}`,
      type: 'summon',
      pos: {
        x: player.pos.x + Math.cos(angle) * 40,
        y: player.pos.y + Math.sin(angle) * 40,
      },
      vel: { x: 0, y: 0 },
      hp: 30,
      maxHp: 30,
      radius: 9,
      speed: 3.5 * 32,
      faction: 'player',
      tags: def.tags,
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: 'player',
      summonDefId: def.summonId || def.id,
      duration: def.duration || 20,
      maxDuration: def.duration || 20,
      damage: def.damage || 8,
      attackCooldown: 1.2,
      attackCooldownRemaining: 0,
      attackRange: 28,
    };

    // Apply Alpha Bond
    const alphaBond = player.passives.find(p => p.def.id === 'alpha_bond');
    if (alphaBond && alphaBond.active) {
      const currentSummons = this.state.entities.filter(e => e.type === 'summon' && e.alive);
      if (currentSummons.length === 0) {
        summon.hp *= 1.4;
        summon.maxHp = summon.hp;
        summon.damage *= 1.6;
      }
    }

    // Apply Symbiotic Growth
    const symGrowth = player.passives.find(p => p.def.id === 'symbiotic_growth');
    if (symGrowth && symGrowth.active) {
      const summonCount = this.state.entities.filter(e => e.type === 'summon' && e.alive).length + 1;
      player.maxHp = 100 + summonCount * 8;
    }

    this.state.entities.push(summon);

    addCombatLog(this.state, {
      type: 'summon',
      source: 'player',
      details: `Summoned ${def.name}`,
    });
  }

  private fireSkillProjectile(def: typeof this.state.player.skills[0]['def']) {
    const player = this.state.player;
    const dir = { x: Math.cos(player.rotation), y: Math.sin(player.rotation) };
    const speed = def.projectileSpeed || 250;
    const count = def.projectileCount || 1;

    for (let i = 0; i < count; i++) {
      const spread = count > 1 ? (i - (count - 1) / 2) * 0.15 : 0;
      const angle = player.rotation + spread;
      const proj: ProjectileEntity = {
        id: `proj_${Date.now()}_${Math.random()}`,
        type: 'projectile',
        pos: { x: player.pos.x, y: player.pos.y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        hp: 1, maxHp: 1,
        radius: 6,
        speed,
        faction: 'player',
        tags: def.tags,
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: angle,
        ownerId: 'player',
        damage: (def.damage || 10) * player.damageScalar,
        piercing: false,
        lifetime: 2,
        maxLifetime: 2,
        hitEntities: new Set(),
        aoeOnImpact: def.aoeRadius,
      };
      this.state.entities.push(proj);
    }
  }

  private useAoeSkill(def: typeof this.state.player.skills[0]['def']) {
    const player = this.state.player;
    const radius = def.aoeRadius || 48;

    // If ranged, place at mouse position; if melee, at player
    let center = { ...player.pos };
    if (def.range && def.range > 0 && this.canvas) {
      const mousePos = this.input.getMousePos();
      center = {
        x: mousePos.x + (player.pos.x - this.canvas.width / 2),
        y: mousePos.y + (player.pos.y - this.canvas.height / 2),
      };
      // Clamp to range
      const d = dist(player.pos, center);
      if (d > def.range) {
        const dir = dirTo(player.pos, center);
        center.x = player.pos.x + dir.x * def.range;
        center.y = player.pos.y + dir.y * def.range;
      }
    }

    if (def.duration && def.duration > 0) {
      // Create hazard zone (player-owned)
      const hazard: any = {
        id: `hazard_${Date.now()}_${Math.random()}`,
        type: 'hazard',
        pos: center,
        vel: { x: 0, y: 0 },
        hp: 1, maxHp: 1,
        radius,
        speed: 0,
        faction: 'player',
        tags: def.tags,
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: 0,
        ownerId: 'player',
        damage: (def.damage || 4) * player.damageScalar,
        tickRate: 0.5,
        tickTimer: 0,
        duration: def.duration,
        maxDuration: def.duration,
      };
      this.state.entities.push(hazard);
    } else {
      // Instant AOE
      this.state.entities.forEach(e => {
        if (e.alive && e.faction === 'enemy' && dist(e.pos, center) < radius) {
          processDamage({
            attackerId: 'player',
            targetId: e.id,
            baseDamage: (def.damage || 15) * player.damageScalar,
            damageType: 'physical',
            tags: def.tags,
            isProjectile: false,
          }, this.state);
        }
      });
    }
  }

  private useDash(def: typeof this.state.player.skills[0]['def']) {
    const player = this.state.player;
    const dir = { x: Math.cos(player.rotation), y: Math.sin(player.rotation) };
    const dashDist = def.range || 160;

    // Move player
    const startPos = { ...player.pos };
    player.pos.x += dir.x * dashDist;
    player.pos.y += dir.y * dashDist;

    // Clamp
    player.pos.x = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.x));
    player.pos.y = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.y));

    // Damage enemies in path
    this.state.entities.forEach(e => {
      if (e.alive && e.faction === 'enemy') {
        // Simple line-circle intersection
        const d = distToLine(startPos, player.pos, e.pos);
        if (d < e.radius + player.radius) {
          processDamage({
            attackerId: 'player',
            targetId: e.id,
            baseDamage: (def.damage || 15) * player.damageScalar,
            damageType: 'physical',
            tags: def.tags,
            isProjectile: false,
          }, this.state);
        }
      }
    });

    player.invulnMs = 200;
  }

  private updatePeriodicEffects(dt: number) {
    const player = this.state.player;

    // Verdant Pulse (10s heal)
    const verdantPulse = player.passives.find(p => p.def.id === 'verdant_pulse');
    if (verdantPulse && verdantPulse.active) {
      const timer = (this.periodicTimers.get('verdant_pulse') || 0) + dt;
      if (timer >= 10) {
        this.periodicTimers.set('verdant_pulse', 0);
        player.hp = Math.min(player.maxHp, player.hp + 5);
        this.state.entities.forEach(e => {
          if (e.type === 'summon' && e.alive && e.faction === 'player') {
            e.hp = Math.min(e.maxHp, e.hp + 5);
          }
        });
      } else {
        this.periodicTimers.set('verdant_pulse', timer);
      }
    }

    // Feral Momentum decay
    const feralMomentum = player.passives.find(p => p.def.id === 'feral_momentum');
    if (feralMomentum && feralMomentum.active) {
      if (player.damageScalar > 1.0) {
        player.damageScalar = Math.max(1.0, player.damageScalar - 0.08 * dt / 5);
      }
    }
  }

  private render(interp: number) {
    if (!this.renderer || !this.canvas) return;

    // Resize check
    if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
      this.renderer.resize(this.canvas.width, this.canvas.height);
    }

    if (this.phase === 'combat' || this.phase === 'levelup') {
      this.renderer.render(this.state, interp);
    }
  }
}

function distToLine(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(a, p);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(closest, p);
}
