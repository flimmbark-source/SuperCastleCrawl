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
import { rollDrops, applyDrops, checkPityDrop, createGuaranteedEncounterDrop } from '../systems/DropSystem';
import { updateEnemyAI, spawnEnemiesForNode } from '../systems/EnemyAI';
import type { LevelUpOffer, EncounterLootEntry } from '../types';
import type { AccessibilitySettings } from '../types';

export type GamePhase =
  | 'menu'
  | 'map'
  | 'combat'
  | 'levelup'
  | 'shrine'
  | 'recovery'
  | 'event'
  | 'loot'
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
  private encounterHadItemDrop = false;
  private currentEncounterType: 'normal' | 'elite' | 'boss' = 'normal';
  private onboardingStep = 0;
  private periodicTimers: Map<string, number> = new Map();
  private settings: AccessibilitySettings;

  // Skill auto-attack
  private autoAttackTimer = 0;
  private autoAttackCooldown = 0.6;
  private turnPhase: 'player' | 'enemy' = 'player';
  private enemyTurnTimer = 0;
  private readonly enemyTurnDuration = 0.35;
  private readonly playerStepDistance = 32;

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
    this.turnPhase = 'player';
    this.enemyTurnTimer = 0;
    this.state.player.pos = { x: 0, y: 100 };
    this.state.encounterLoot = [];
    this.encounterHadItemDrop = false;
    this.currentEncounterType = type === 'combat' ? 'normal' : type;
    this.state.player.vel = { x: 0, y: 0 };
    (this.state.player as any)._packleaderStacks = 0;
    (this.state.player as any)._firstSummonId = '';
    (this.state.player as any)._moonboneBoost = 0;

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
    } else if (this.state.combatActive) {
      this.setPhase('combat');
    } else {
      this.completeNode();
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

  confirmEncounterLoot() {
    if (this.pendingLevelUps > 0) {
      this.showLevelUp();
    } else {
      this.completeNode();
    }
  }

  useInventoryItem(itemId: string) {
    const idx = this.state.player.inventory.findIndex(i => i.id === itemId);
    if (idx < 0) return;

    const item = this.state.player.inventory[idx];

    if (item.effect === 'heal') {
      const before = this.state.player.hp;
      this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + item.value);
      const healed = Math.round(this.state.player.hp - before);
      addCombatLog(this.state, {
        type: 'heal',
        source: 'inventory',
        target: 'player',
        value: healed,
        details: `Used ${item.name} (+${healed} HP)`,
      });
    } else if (item.effect === 'resource') {
      const before = this.state.player.resource;
      this.state.player.resource = Math.min(this.state.player.maxResource, this.state.player.resource + item.value);
      const gained = Math.round(this.state.player.resource - before);
      addCombatLog(this.state, {
        type: 'trigger',
        source: 'inventory',
        target: 'player',
        value: gained,
        details: `Used ${item.name} (+${gained} Resource)`,
      });
    }

    item.charges -= 1;
    if (item.charges <= 0) {
      this.state.player.inventory.splice(idx, 1);
    }
  }

  // --- Main update ---
  private update(dt: number) {
    this.state.runTime += dt;

    // Input: pause
    if (this.input.isActionJustPressed('pause')) {
      this.togglePause();
    }

    // Defensive sync: if combat is active, always surface the combat view.
    if (this.state.combatActive && this.phase !== 'combat' && this.phase !== 'levelup') {
      this.setPhase('combat');
    }

    if (this.phase === 'combat') {
      this.updateCombat(dt);
    }

    this.callbacks.onStateUpdate(this.state);
    this.input.endFrame();
  }

  private updateCombat(dt: number) {
    const player = this.state.player;
    (player as any)._secondsSinceHit = ((player as any)._secondsSinceHit || 999) + dt;
    if (!player.alive) {
      this.state.runComplete = true;
      this.state.runWon = false;
      this.setPhase('defeat');
      this.callbacks.onRunEnd(false);
      return;
    }

    if (this.canvas) {
      const mousePos = this.input.getMousePos();
      const worldX = mousePos.x + (this.state.player.pos.x - this.canvas.width / 2);
      const worldY = mousePos.y + (this.state.player.pos.y - this.canvas.height / 2);
      player.rotation = Math.atan2(worldY - player.pos.y, worldX - player.pos.x);
    }

    if (this.turnPhase === 'player') {
      player.animState = 'idle';
      if (this.tryPlayerTurnAction()) {
        this.processKills();
        this.checkRoomClear();
      }
      return;
    }

    // Enemy turn: enemies/summons/projectiles all resolve a short action window.
    this.enemyTurnTimer -= dt;
    updateEnemyAI(this.state, dt);
    updateSummons(this.state, dt);
    updateProjectiles(this.state, dt);
    updateHazards(this.state, dt);
    processPoison(this.state, dt);
    processRegen(this.state, dt);
    updateTimers(this.state, dt);

    this.processKills();
    this.checkRoomClear();
    cleanupEntities(this.state);
    this.updatePeriodicEffects(dt);

    if (this.enemyTurnTimer <= 0) {
      this.turnPhase = 'player';
      this.autoAttackTimer = Math.max(0, this.autoAttackTimer - this.enemyTurnDuration);
      addCombatLog(this.state, {
        type: 'trigger',
        source: 'system',
        details: 'Player turn',
      });
    }
  }

  private tryPlayerTurnAction(): boolean {
    const player = this.state.player;

    for (let i = 0; i < player.skills.length; i++) {
      const skill = player.skills[i];
      skill.cooldownRemaining = Math.max(0, skill.cooldownRemaining - this.enemyTurnDuration);
      const actionKey = `skill${i + 1}`;
      if (this.input.isActionJustPressed(actionKey) && skill.cooldownRemaining <= 0) {
        this.useSkill(skill, i);
        this.beginEnemyTurn();
        return true;
      }
    }

    const step = this.playerStepDistance * (1 + this.getItemStatBonus('move_speed'));
    const prevPos = { ...player.pos };
    if (this.input.isActionJustPressed('moveUp')) {
      player.pos.y -= step;
      player.rotation = -Math.PI / 2;
      player.animState = 'move';
      this.spawnTrailIfNeeded(prevPos);
      this.beginEnemyTurn();
      return true;
    }
    if (this.input.isActionJustPressed('moveDown')) {
      player.pos.y += step;
      player.rotation = Math.PI / 2;
      player.animState = 'move';
      this.spawnTrailIfNeeded(prevPos);
      this.beginEnemyTurn();
      return true;
    }
    if (this.input.isActionJustPressed('moveLeft')) {
      player.pos.x -= step;
      player.rotation = Math.PI;
      player.animState = 'move';
      this.spawnTrailIfNeeded(prevPos);
      this.beginEnemyTurn();
      return true;
    }
    if (this.input.isActionJustPressed('moveRight')) {
      player.pos.x += step;
      player.rotation = 0;
      player.animState = 'move';
      this.spawnTrailIfNeeded(prevPos);
      this.beginEnemyTurn();
      return true;
    }

    player.pos.x = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.x));
    player.pos.y = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.y));

    this.autoAttackTimer = Math.max(0, this.autoAttackTimer - this.enemyTurnDuration);
    if (this.input.isMouseJustClicked() && this.autoAttackTimer <= 0) {
      this.autoAttackTimer = this.autoAttackCooldown / player.attackSpeed;
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
      this.beginEnemyTurn();
      return true;
    }

    return false;
  }

  private spawnTrailIfNeeded(pos: Vec2) {
    if (!this.hasItem('wild_stride_boots')) return;
    const hazard: any = {
      id: `trail_${Date.now()}_${Math.random()}`,
      type: 'hazard',
      pos: { ...pos },
      vel: { x: 0, y: 0 },
      hp: 1, maxHp: 1,
      radius: 16,
      speed: 0,
      faction: 'player',
      tags: ['DOT', 'Physical'],
      alive: true,
      invulnMs: 0, flashMs: 0, deathAnimMs: 0,
      animState: 'idle',
      rotation: 0,
      ownerId: 'player',
      damage: 3,
      tickRate: 0.4,
      tickTimer: 0,
      duration: 1.3,
      maxDuration: 1.3,
    };
    this.state.entities.push(hazard);
    if (this.renderer) this.renderer.spawnParticles(pos.x, pos.y, '#8bc34a', 4);
  }

  private beginEnemyTurn() {
    const player = this.state.player;
    player.pos.x = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.x));
    player.pos.y = Math.max(-ARENA_SIZE, Math.min(ARENA_SIZE, player.pos.y));
    this.turnPhase = 'enemy';
    this.enemyTurnTimer = this.enemyTurnDuration;
    addCombatLog(this.state, {
      type: 'trigger',
      source: 'system',
      details: 'Enemy turn',
    });
  }

  private checkRoomClear() {
    const livingEnemies = this.state.entities.filter(
      e => e.type === 'enemy' && e.alive
    );

    if (livingEnemies.length === 0 && !this.roomClearAwarded && this.state.combatActive) {
      this.roomClearAwarded = true;
      this.state.combatActive = false;
      const lvl = awardXP(this.state, XP_REWARDS.roomClear);
      if (lvl) this.pendingLevelUps++;

      setTimeout(() => {
        if (!this.encounterHadItemDrop) {
          const guaranteed = createGuaranteedEncounterDrop(this.state, this.rng, this.currentEncounterType);
          this.collectEncounterLoot(guaranteed.items);
          applyDrops(this.state, guaranteed);
          this.encounterHadItemDrop = true;
        }

        if (this.state.encounterLoot.length > 0) {
          this.setPhase('loot');
          return;
        }

        if (this.pendingLevelUps > 0) {
          this.showLevelUp();
        } else {
          this.completeNode();
        }
      }, 400);
    }
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
      if (isElite && this.hasItem('moonbone_charm')) {
        (this.state.player as any)._moonboneBoost = 0.12;
      }

      const xpType = isBoss ? 'boss' : isElite ? 'elite' : 'normal';
      const xp = XP_REWARDS[xpType];
      const leveled = awardXP(this.state, xp);
      if (leveled) this.pendingLevelUps++;

      this.state.killCount++;

      // Roll drops
      const drops = rollDrops(this.state, xpType, this.rng);
      if (drops.items.length > 0) {
        this.collectEncounterLoot(drops.items);
        this.encounterHadItemDrop = true;
      }
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

    player.animState = 'attack';

    if (def.summonId) {
      this.spawnSummon(def);
    } else if (def.projectileSpeed) {
      this.fireSkillProjectile(def);
    } else if (def.aoeRadius) {
      this.useAoeSkill(def);
    } else if (def.id === 'wild_charge') {
      this.useDash(def);
    } else if (def.id === 'fungal_link') {
      (player as any)._fungalLinkMs = (def.duration || 6) * 1000;
      if (this.renderer) this.renderer.spawnParticles(player.pos.x, player.pos.y, '#81c784', 10);
      addCombatLog(this.state, {
        type: 'heal',
        source: 'player',
        details: `Activated Fungal Link (${def.duration}s)`,
      });
    }

    this.spawnSkillVisuals(def.id);

    addCombatLog(this.state, {
      type: 'trigger',
      source: 'player',
      details: `Used skill: ${def.name}`,
    });

    if (this.hasItem('echo_seed') && this.rng.chance(0.15)) {
      const dir = { x: Math.cos(player.rotation), y: Math.sin(player.rotation) };
      const echo: ProjectileEntity = {
        id: `echo_${Date.now()}_${Math.random()}`,
        type: 'projectile',
        pos: { x: player.pos.x + dir.x * 15, y: player.pos.y + dir.y * 15 },
        vel: { x: dir.x * 260, y: dir.y * 260 },
        hp: 1, maxHp: 1, radius: 4, speed: 260, faction: 'player',
        tags: ['Projectile', 'Nature'], alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0, animState: 'idle', rotation: player.rotation,
        ownerId: 'player', damage: 4 * player.damageScalar, piercing: false, lifetime: 1.1, maxLifetime: 1.1, hitEntities: new Set(),
      };
      this.state.entities.push(echo);
      if (this.renderer) this.renderer.spawnParticles(player.pos.x, player.pos.y, '#b39ddb', 6);
      addCombatLog(this.state, { type: 'trigger', source: 'item', details: 'Echo Seed duplicated a weakened cast' });
    }
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

    // Item stat mods
    const summonDamageBonus = this.getItemStatBonus('summon_damage');
    if (summonDamageBonus > 0) {
      const moonboneBoost = (player as any)._moonboneBoost ? summonDamageBonus : 0;
      summon.damage *= (1 + summonDamageBonus + moonboneBoost);
    }
    const totemDurationBonus = this.getItemStatBonus('totem_duration');
    if (totemDurationBonus > 0 && def.tags.includes('Totem')) {
      summon.duration *= (1 + totemDurationBonus);
      summon.maxDuration = summon.duration;
    }

    if (this.hasItem('packleader_fang')) {
      const stacks = (player as any)._packleaderStacks || 0;
      const firstSummonId = (player as any)._firstSummonId as string;
      if (!firstSummonId) {
        (player as any)._firstSummonId = summon.id;
      } else if (firstSummonId) {
        const first = this.state.entities.find(e => e.id === firstSummonId && e.type === 'summon' && e.alive) as SummonEntity | undefined;
        if (first) first.damage += 5;
      }
      (player as any)._packleaderStacks = stacks + 1;
    }

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
    const radius = (def.aoeRadius || 48) * (1 + this.getItemStatBonus('aoe_radius'));

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
      const hazardTags = [...def.tags];
      if (def.id === 'entangling_vines' && !hazardTags.includes('Debuff')) hazardTags.push('Debuff');
      if (def.id === 'totemic_ward') {
        if (!hazardTags.includes('Heal')) hazardTags.push('Heal');
        if (!hazardTags.includes('Debuff')) hazardTags.push('Debuff');
      }

      const hazard: any = {
        id: `hazard_${Date.now()}_${Math.random()}`,
        type: 'hazard',
        pos: center,
        vel: { x: 0, y: 0 },
        hp: 1, maxHp: 1,
        radius,
        speed: 0,
        faction: 'player',
        tags: hazardTags,
        alive: true,
        invulnMs: 0, flashMs: 0, deathAnimMs: 0,
        animState: 'idle',
        rotation: 0,
        ownerId: 'player',
        damage: def.id === 'totemic_ward' ? 0 : (def.damage || 4) * player.damageScalar,
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



  private spawnSkillVisuals(skillId: string) {
    if (!this.renderer) return;
    const { x, y } = this.state.player.pos;
    const palette: Record<string, string> = {
      summon_briar_wolf: '#66bb6a',
      entangling_vines: '#8bc34a',
      spore_bolt: '#7e57c2',
      spirit_swarm: '#ab47bc',
      thornburst: '#ef5350',
      totemic_ward: '#4dd0e1',
      fungal_link: '#81c784',
      wild_charge: '#ffb74d',
    };
    this.renderer.spawnParticles(x, y, palette[skillId] || '#90caf9', 8);
  }

  private collectEncounterLoot(items: Array<{ id: string; name: string; rarity: any; description: string; triggerSentence: string }>) {
    items.forEach(item => {
      const entry: EncounterLootEntry = {
        id: item.id,
        name: item.name,
        rarity: item.rarity,
        description: item.description,
        effectSummary: item.triggerSentence,
      };
      this.state.encounterLoot.push(entry);
    });
  }

  private hasItem(itemId: string): boolean {
    return this.state.player.items.some(i => i.def.id === itemId);
  }

  private getItemStatBonus(stat: string): number {
    let total = 0;
    this.state.player.items.forEach(item => {
      item.def.effects.forEach(effect => {
        if (effect.type === 'stat_mod' && effect.stat === stat) {
          total += effect.value || 0;
        }
      });
    });
    return total;
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

    // Living Moss Shield
    if (this.hasItem('living_moss_shield')) {
      const timer = ((player as any)._mossTimer || 0) + dt;
      (player as any)._mossTimer = timer;
      if (timer >= 3) {
        (player as any)._mossTimer = 0;
        const sinceHit = (player as any)._secondsSinceHit || 999;
        const heal = sinceHit >= 5 ? 4 : 2;
        player.hp = Math.min(player.maxHp, player.hp + heal);
      }
    }

    // Moonbone elite-kill burst decay
    if ((player as any)._moonboneBoost > 0) {
      (player as any)._moonboneBoost = Math.max(0, (player as any)._moonboneBoost - dt * 0.06);
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

    if (this.phase === 'combat' || this.phase === 'levelup' || this.state.combatActive) {
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
