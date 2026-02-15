import type {
  Entity, PlayerEntity, EnemyEntity, SummonEntity,
  ProjectileEntity, HazardEntity, RunState, Vec2
} from '../types';

export interface RenderConfig {
  colorblindMode: boolean;
  reducedMotion: boolean;
  screenShake: boolean;
}

const TILE_SIZE = 32;
const COLORS = {
  bg: '#161623',
  floor: '#303448',
  floorAlt: '#2b3042',
  wall: '#434a60',
  player: '#4fc3f7',
  playerOutline: '#0288d1',
  enemy: '#ef5350',
  enemyOutline: '#c62828',
  summon: '#66bb6a',
  summonOutline: '#2e7d32',
  projectilePlayer: '#81d4fa',
  projectileEnemy: '#ff8a80',
  hazard: '#9c27b0',
  hazardOutline: '#6a1b9a',
  telegraph: 'rgba(255, 82, 82, 0.25)',
  telegraphOutline: 'rgba(255, 82, 82, 0.6)',
  healthBar: '#4caf50',
  healthBarBg: '#1b5e20',
  healthBarEnemy: '#ef5350',
  manaBar: '#42a5f5',
  xpBar: '#ffd54f',
  elite: '#ff9800',
  boss: '#e040fb',
  text: '#e0e0e0',
  textDim: '#9e9e9e',
};

// Colorblind-safe patterns
const CB_PATTERNS = {
  enemy: 'cross',    // X pattern
  summon: 'circle',  // Ring pattern
  hazard: 'diagonal', // Diagonal lines
} as const;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private config: RenderConfig;
  private camera: Vec2 = { x: 0, y: 0 };
  private shakeOffset: Vec2 = { x: 0, y: 0 };
  private shakeTimer = 0;
  private particles: Particle[] = [];

  constructor(canvas: HTMLCanvasElement, config: RenderConfig) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.config = config;
  }

  updateConfig(config: RenderConfig) {
    this.config = config;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  triggerShake(intensity: number, durationMs: number) {
    if (this.config.screenShake) {
      this.shakeTimer = durationMs;
    }
  }

  render(state: RunState, interp: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Update camera to follow player
    const targetCamX = state.player.pos.x - this.width / 2;
    const targetCamY = state.player.pos.y - this.height / 2;
    this.camera.x += (targetCamX - this.camera.x) * 0.1;
    this.camera.y += (targetCamY - this.camera.y) * 0.1;

    // Screen shake
    if (this.shakeTimer > 0) {
      this.shakeOffset.x = (Math.random() - 0.5) * 6;
      this.shakeOffset.y = (Math.random() - 0.5) * 6;
      this.shakeTimer -= 16;
    } else {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    }

    ctx.save();
    ctx.translate(
      -this.camera.x + this.shakeOffset.x,
      -this.camera.y + this.shakeOffset.y
    );

    // Draw floor tiles
    this.drawFloor(state);

    // Draw hazards (below entities)
    state.entities.forEach(e => {
      if (e.type === 'hazard' && e.alive) this.drawHazard(e as HazardEntity);
    });

    // Draw ability telegraphs (below entities but above hazards)
    state.entities.forEach(e => {
      if (e.type === 'enemy') this.drawEnemyTelegraph(e as EnemyEntity);
    });

    // Draw entities
    state.entities.forEach(e => {
      if (e.type === 'summon' && e.alive) this.drawSummon(e as SummonEntity);
    });
    state.entities.forEach(e => {
      if (e.type === 'enemy') this.drawEnemy(e as EnemyEntity, state);
    });

    // Draw projectiles
    state.entities.forEach(e => {
      if (e.type === 'projectile' && e.alive) this.drawProjectile(e as ProjectileEntity);
    });

    // Draw player
    if (state.player.alive) this.drawPlayer(state.player);

    // Draw particles
    this.updateAndDrawParticles(ctx);

    ctx.restore();
  }

  private drawFloor(state: RunState) {
    const ctx = this.ctx;
    const startX = Math.floor(this.camera.x / TILE_SIZE) - 1;
    const startY = Math.floor(this.camera.y / TILE_SIZE) - 1;
    const endX = startX + Math.ceil(this.width / TILE_SIZE) + 2;
    const endY = startY + Math.ceil(this.height / TILE_SIZE) + 2;

    // Ambient base so the arena is always visible behind entities
    const pad = TILE_SIZE * 2;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect((startX - 1) * TILE_SIZE - pad, (startY - 1) * TILE_SIZE - pad, (endX - startX + 3) * TILE_SIZE + pad * 2, (endY - startY + 3) * TILE_SIZE + pad * 2);

    // Arena bounds
    const arenaSize = 14;

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const inArena = x >= -arenaSize && x <= arenaSize && y >= -arenaSize && y <= arenaSize;

        if (inArena) {
          ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        } else {
          ctx.fillStyle = COLORS.wall;
        }
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Tile seam + light noise for readability of movement space
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * TILE_SIZE + 0.5, y * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

        if (inArena && (x + y) % 5 === 0) {
          ctx.strokeStyle = 'rgba(153, 171, 208, 0.12)';
          ctx.beginPath();
          ctx.moveTo(x * TILE_SIZE + 8, y * TILE_SIZE + TILE_SIZE - 8);
          ctx.lineTo(x * TILE_SIZE + TILE_SIZE - 8, y * TILE_SIZE + 8);
          ctx.stroke();
        }

        // Arena border
        if (inArena) {
          const isEdge = x === -arenaSize || x === arenaSize || y === -arenaSize || y === arenaSize;
          if (isEdge) {
            ctx.fillStyle = COLORS.wall;
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    }
  }

  private drawPlayer(player: PlayerEntity) {
    const ctx = this.ctx;
    const { x, y } = player.pos;

    // Flash on hit
    if (player.flashMs > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
    }

    // Body - diamond shape for player
    ctx.fillStyle = COLORS.player;
    ctx.strokeStyle = COLORS.playerOutline;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x, y - player.radius);
    ctx.lineTo(x + player.radius * 0.8, y);
    ctx.lineTo(x, y + player.radius * 0.7);
    ctx.lineTo(x - player.radius * 0.8, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bark shield visual ring
    const barkShield = (player as any)._barkShieldHp || 0;
    if (barkShield > 0) {
      ctx.strokeStyle = 'rgba(139, 195, 74, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, player.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Direction indicator
    ctx.fillStyle = '#fff';
    const dirX = x + Math.cos(player.rotation) * player.radius * 0.5;
    const dirY = y + Math.sin(player.rotation) * player.radius * 0.5;
    ctx.beginPath();
    ctx.arc(dirX, dirY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Ally marker (not color-only) - small triangle above
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x, y - player.radius - 8);
    ctx.lineTo(x - 4, y - player.radius - 3);
    ctx.lineTo(x + 4, y - player.radius - 3);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  private drawEnemyTelegraph(enemy: EnemyEntity) {
    if (!enemy.alive || !enemy.activeAbility) return;
    const ability = enemy.activeAbility;

    // Only draw telegraph during telegraph phase
    if (ability.phase !== 'telegraph') return;

    const ctx = this.ctx;
    const progress = ability.windupProgress || 0;

    // Draw telegraph based on ability type
    switch (ability.id) {
      case 'blink':
        // Show destination with pulsing indicator
        if (ability.targetPos) {
          this.drawTelegraph(ability.targetPos.x, ability.targetPos.y, enemy.radius * 1.5, progress);
          // Line from current to target
          ctx.strokeStyle = COLORS.telegraphOutline;
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(enemy.pos.x, enemy.pos.y);
          ctx.lineTo(ability.targetPos.x, ability.targetPos.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        break;

      case 'charge':
      case 'lunge':
        // Show path and impact zone
        if (ability.targetPos && ability.startPos) {
          const { startPos, targetPos } = ability;
          // Draw line showing charge path
          ctx.strokeStyle = COLORS.telegraphOutline;
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(startPos.x, startPos.y);
          ctx.lineTo(targetPos.x, targetPos.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Impact zone at target
          const impactRadius = ability.id === 'charge' ? 80 : 40;
          this.drawTelegraph(targetPos.x, targetPos.y, impactRadius, progress);
        }
        break;

      case 'burst_fire':
        // Show cone/spread indicator
        if (ability.targetPos) {
          this.drawTelegraph(ability.targetPos.x, ability.targetPos.y, 50, progress);
        }
        break;

      case 'retreat':
        // Show retreat destination
        if (ability.targetPos) {
          this.drawTelegraph(ability.targetPos.x, ability.targetPos.y, enemy.radius, progress);
          // Show mine drop location
          if (ability.startPos) {
            ctx.fillStyle = 'rgba(156, 39, 176, 0.3)';
            ctx.strokeStyle = COLORS.hazardOutline;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(ability.startPos.x, ability.startPos.y, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        break;

      case 'hazard_spawn':
        // Show hazard spawn location
        if (ability.targetPos) {
          this.drawTelegraph(ability.targetPos.x, ability.targetPos.y, 50, progress);
        }
        break;

      case 'ground_slam':
        // Show AOE around enemy
        this.drawTelegraph(enemy.pos.x, enemy.pos.y, 120, progress);
        break;
    }
  }

  private drawEnemy(enemy: EnemyEntity, state: RunState) {
    const ctx = this.ctx;
    const { x, y } = enemy.pos;

    if (!enemy.alive) {
      if (enemy.deathAnimMs > 0) {
        // Death dissolve
        ctx.globalAlpha = enemy.deathAnimMs / 500;
        this.drawEnemyShape(enemy, x, y);
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Blink fade effects
    if (enemy.activeAbility?.id === 'blink') {
      if (enemy.activeAbility.phase === 'telegraph') {
        // Fade out during telegraph
        ctx.globalAlpha = 1 - (enemy.activeAbility.windupProgress || 0);
      } else if (enemy.activeAbility.phase === 'execute') {
        // Faded out during teleport
        ctx.globalAlpha = 0.2;
      }
    } else if (enemy.flashMs > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
    }

    // Color by elite/boss
    let color = COLORS.enemy;
    let outline = COLORS.enemyOutline;
    if (enemy.eliteModifier) {
      color = COLORS.elite;
      outline = '#e65100';
    }
    if (enemy.def.id.startsWith('boss_')) {
      color = COLORS.boss;
      outline = '#aa00ff';
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;

    // Motion trail for charge/lunge during execute
    if (!this.config.reducedMotion &&
        enemy.activeAbility?.phase === 'execute' &&
        (enemy.activeAbility.id === 'charge' || enemy.activeAbility.id === 'lunge')) {
      const trail = enemy.activeAbility.startPos;
      if (trail) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        this.drawEnemyShape(enemy, trail.x, trail.y);
        ctx.globalAlpha = 0.5;
        const midX = (trail.x + x) / 2;
        const midY = (trail.y + y) / 2;
        this.drawEnemyShape(enemy, midX, midY);
        ctx.globalAlpha = 1;
      }
    }

    this.drawEnemyShape(enemy, x, y);

    // Enemy marker (X shape for colorblind)
    if (this.config.colorblindMode) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      const s = 4;
      ctx.beginPath();
      ctx.moveTo(x - s, y - enemy.radius - 8 - s);
      ctx.lineTo(x + s, y - enemy.radius - 8 + s);
      ctx.moveTo(x + s, y - enemy.radius - 8 - s);
      ctx.lineTo(x - s, y - enemy.radius - 8 + s);
      ctx.stroke();
    } else {
      // Red dot above
      ctx.fillStyle = COLORS.enemy;
      ctx.beginPath();
      ctx.arc(x, y - enemy.radius - 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Health bar
    const hpRatio = enemy.hp / enemy.maxHp;
    const barW = enemy.radius * 2;
    const barH = 4;
    const barY = y + enemy.radius + 4;
    ctx.fillStyle = COLORS.healthBarBg;
    ctx.fillRect(x - barW / 2, barY, barW, barH);
    ctx.fillStyle = COLORS.healthBarEnemy;
    ctx.fillRect(x - barW / 2, barY, barW * hpRatio, barH);

    // Poison stack indicator
    if (enemy.poisonStacks > 0) {
      ctx.fillStyle = '#76ff03';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`☠${enemy.poisonStacks}`, x, barY + 14);
    }

    ctx.globalAlpha = 1;
  }

  private drawEnemyShape(enemy: EnemyEntity, x: number, y: number) {
    const ctx = this.ctx;
    const r = enemy.radius;

    switch (enemy.def?.archetype) {
      case 'melee_chaser':
        // Triangle (aggressive)
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.7);
        ctx.lineTo(x - r, y + r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'ranged_spitter':
        // Pentagon
        this.drawRegularPolygon(x, y, r, 5);
        break;
      case 'tank':
        // Square (sturdy)
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        break;
      case 'blinker':
        // Star shape
        this.drawStar(x, y, r, 4);
        break;
      case 'hazard_generator':
        // Hexagon
        this.drawRegularPolygon(x, y, r, 6);
        break;
      default:
        // Circle fallback
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
  }

  private drawRegularPolygon(x: number, y: number, r: number, sides: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawStar(x: number, y: number, r: number, points: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI * 2 / (points * 2)) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.4;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawSummon(summon: SummonEntity) {
    const ctx = this.ctx;
    const { x, y } = summon.pos;

    ctx.fillStyle = COLORS.summon;
    ctx.strokeStyle = COLORS.summonOutline;
    ctx.lineWidth = 2;

    // Rounded square for summons
    const r = summon.radius;
    ctx.beginPath();
    ctx.moveTo(x - r + 3, y - r);
    ctx.lineTo(x + r - 3, y - r);
    ctx.quadraticCurveTo(x + r, y - r, x + r, y - r + 3);
    ctx.lineTo(x + r, y + r - 3);
    ctx.quadraticCurveTo(x + r, y + r, x + r - 3, y + r);
    ctx.lineTo(x - r + 3, y + r);
    ctx.quadraticCurveTo(x - r, y + r, x - r, y + r - 3);
    ctx.lineTo(x - r, y - r + 3);
    ctx.quadraticCurveTo(x - r, y - r, x - r + 3, y - r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ally marker - small triangle (same as player)
    if (this.config.colorblindMode) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y - r - 6, 3, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.summon;
      ctx.beginPath();
      ctx.moveTo(x, y - r - 8);
      ctx.lineTo(x - 3, y - r - 4);
      ctx.lineTo(x + 3, y - r - 4);
      ctx.closePath();
      ctx.fill();
    }

    // Duration bar
    const ratio = summon.duration / summon.maxDuration;
    const barW = r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - barW / 2, y + r + 2, barW, 3);
    ctx.fillStyle = '#a5d6a7';
    ctx.fillRect(x - barW / 2, y + r + 2, barW * ratio, 3);
  }

  private drawProjectile(proj: ProjectileEntity) {
    const ctx = this.ctx;
    const { x, y } = proj.pos;
    const color = proj.faction === 'player' ? COLORS.projectilePlayer : COLORS.projectileEnemy;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, proj.radius, 0, Math.PI * 2);
    ctx.fill();

    // Trail
    if (!this.config.reducedMotion) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(x - proj.vel.x * 0.02, y - proj.vel.y * 0.02, proj.radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawHazard(hazard: HazardEntity) {
    const ctx = this.ctx;
    const { x, y } = hazard.pos;

    const alpha = Math.min(1, hazard.duration / 0.5); // Fade out
    ctx.globalAlpha = 0.4 * alpha;
    ctx.fillStyle = COLORS.hazard;
    ctx.beginPath();
    ctx.arc(x, y, hazard.radius, 0, Math.PI * 2);
    ctx.fill();

    // Pattern overlay for colorblind
    if (this.config.colorblindMode) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      // Diagonal lines
      for (let i = -hazard.radius; i < hazard.radius; i += 8) {
        ctx.beginPath();
        ctx.moveTo(x + i, y - hazard.radius);
        ctx.lineTo(x + i + hazard.radius, y);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = COLORS.hazardOutline;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6 * alpha;
    ctx.beginPath();
    ctx.arc(x, y, hazard.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  // --- Telegraphs ---
  drawTelegraph(x: number, y: number, radius: number, progress: number) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.telegraph;
    ctx.strokeStyle = COLORS.telegraphOutline;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fill progress
    ctx.fillStyle = 'rgba(255, 82, 82, 0.15)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.closePath();
    ctx.fill();
  }

  // --- Particles ---
  spawnParticles(x: number, y: number, color: string, count: number) {
    if (this.config.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  private updateAndDrawParticles(ctx: CanvasRenderingContext2D) {
    const dt = 1 / 60;
    this.particles = this.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) return false;

      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      return true;
    });
    ctx.globalAlpha = 1;
  }
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string;
  size: number;
}
