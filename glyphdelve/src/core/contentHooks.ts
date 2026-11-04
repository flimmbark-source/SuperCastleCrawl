// ============================================================
// Glyphdelve - Content Hooks
//
// Every passive and every triggered item is implemented here, in one place,
// keyed by its content id. `coverage.test.ts` asserts that no declared piece
// of content is missing an implementation, which is what stops the "offers an
// upgrade that does nothing" failure from ever coming back.
//
// Items whose effect changes what Move or Attack *is* (Leaping Greaves,
// Splinter Fang, ...) are implemented in the engine instead and declared in
// ENGINE_IMPLEMENTED_IDS there, because they modify action execution rather
// than reacting to an event.
// ============================================================

import type { ContentHook, CombatContext } from './combat';
import {
  registerHooks, dealDamage, dealAreaDamage, inflictStatus, spawnHazard,
  enemiesWithin, livingEnemies, heal, logLine, fx, statusStacks, freeNeighbourTile,
} from './combat';
import { STATUS_CAPS } from './model';
import { tileDist } from './grid';

/** Beat durations used by content, gathered so they are easy to tune together. */
const D = {
  bleed: 6,
  slow: 6,
  brittle: 4,
  exposed: 5,
  thornZone: 4,
  poisonCloud: 5,
  momentum: 4,
} as const;

const hooks: ContentHook[] = [
  // ==========================================================
  // PASSIVES
  // ==========================================================

  // -- Stat-shaped passives. The multiplier itself lives in
  //    playerDamageMultiplier(); these hooks keep the per-turn bookkeeping.
  {
    id: 'pack_tactics', source: 'passive', on: ['OnActorTurn'],
    handle: () => { /* Read directly by playerDamageMultiplier each hit. */ },
  },
  {
    id: 'natures_fury', source: 'passive', on: ['OnActorTurn'],
    handle: () => { /* Read directly by playerDamageMultiplier each hit. */ },
  },
  {
    id: 'alpha_bond', source: 'passive', on: ['OnSummon'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnSummon') return;
      // A lone summon is tougher and faster, not just harder-hitting.
      const summons = ctx.actors.filter(a => a.alive && a.kind === 'summon');
      if (summons.length !== 1) return;
      const s = summons[0];
      if (s.flags.alphaBuffed) return;
      s.flags.alphaBuffed = true;
      s.maxHp = Math.round(s.maxHp * 1.4);
      s.hp = s.maxHp;
      s.actSpeed = Math.max(2, s.actSpeed - 1);
      logLine(ctx, 'trigger', `Alpha Bond empowers ${s.name}`);
    },
  },
  {
    id: 'elder_bond', source: 'passive', on: ['OnSummon'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnSummon') return;
      const playerArmor = Number(ctx.owned.flags.playerArmor ?? 0);
      ctx.actors.filter(a => a.alive && a.kind === 'summon' && !a.flags.elderBonded)
        .forEach(s => {
          s.flags.elderBonded = true;
          s.armor += playerArmor * 0.4;
        });
    },
  },
  {
    id: 'symbiotic_growth', source: 'passive', on: ['OnSummon', 'OnDeath'],
    handle: (_ev, ctx) => {
      // +8 max HP per living summon, recomputed so it never drifts.
      const player = ctx.actors.find(a => a.kind === 'player');
      if (!player) return;
      const count = ctx.actors.filter(a => a.alive && a.kind === 'summon').length;
      const base = Number(ctx.owned.flags.baseMaxHp ?? player.maxHp);
      const target = base + count * 8;
      const delta = target - player.maxHp;
      player.maxHp = target;
      if (delta > 0) player.hp += delta;
      player.hp = Math.min(player.hp, player.maxHp);
    },
  },

  // -- Reactive passives.
  {
    id: 'spore_mantle', source: 'passive', on: ['OnDamageTaken'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDamageTaken' || ev.target.kind !== 'player') return;
      spawnHazard(ctx, ev.target.tile, 3, D.poisonCloud, 'player', 'Spore Cloud', '#8bc34a', ['DOT', 'Poison']);
      logLine(ctx, 'trigger', 'Spore Mantle releases a cloud');
    },
  },
  {
    id: 'thorned_hide', source: 'passive', on: ['OnDamageTaken'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDamageTaken' || ev.target.kind !== 'player') return;
      if (ev.attacker.faction !== 'enemy') return;
      if (tileDist(ev.attacker.tile, ev.target.tile) > 1) return; // melee only
      const reflect = Math.max(1, Math.round(ev.damage * 0.25));
      dealDamage(ctx, {
        attacker: ev.target, target: ev.attacker, amount: reflect,
        type: 'physical', tags: ['Physical'], silentTriggers: true,
      });
      logLine(ctx, 'trigger', `Thorned Hide reflects ${reflect}`);
    },
  },
  {
    id: 'root_network', source: 'passive', on: ['OnDamageTaken'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDamageTaken' || ev.target.kind !== 'summon') return;
      const others = ctx.actors.filter(a =>
        a.alive && a.kind === 'summon' && a.id !== ev.target.id);
      if (!others.length) return;
      // Give back a fifth of the hit, spread across the rest of the pack.
      const share = (ev.damage * 0.2) / others.length;
      ev.target.hp = Math.min(ev.target.maxHp, ev.target.hp + ev.damage * 0.2);
      others.forEach(o => { o.hp = Math.max(1, o.hp - share); });
      logLine(ctx, 'trigger', 'Root Network spreads the wound');
    },
  },
  {
    id: 'death_blossom', source: 'passive', on: ['OnDeath'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDeath' || ev.target.kind !== 'summon') return;
      dealAreaDamage(ctx, {
        attacker: ev.target, centre: ev.target.tile, radius: 1, amount: 15,
        type: 'nature', tags: ['AOE', 'Nature'], hits: 'enemy',
        colour: '#aed581', label: 'Death Blossom',
      });
      logLine(ctx, 'trigger', 'Death Blossom detonates');
    },
  },
  {
    id: 'feral_momentum', source: 'passive', on: ['OnKill', 'OnActorTurn'],
    handle: (ev, ctx) => {
      if (ev.type === 'OnKill') {
        if (ev.attacker.faction !== 'player') return;
        const cur = Number(ctx.owned.flags.feralMomentumStacks ?? 0);
        ctx.owned.flags.feralMomentumStacks = Math.min(5, cur + 1);
        ctx.owned.flags.feralMomentumBeats = 8;
      }
    },
  },
  {
    id: 'toxic_proliferation', source: 'passive', on: ['OnKill'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnKill') return;
      const stacks = statusStacks(ev.target.statuses, 'poison');
      if (stacks <= 0) return;
      const spread = Math.max(1, Math.floor(stacks * 0.5));
      enemiesWithin(ctx, ev.target.tile, 2)
        .filter(e => e.id !== ev.target.id)
        .forEach(e => inflictStatus(ctx, ev.attacker, e, 'poison', spread, -1));
      logLine(ctx, 'trigger', `Toxic Proliferation spreads ${spread} Poison`);
    },
  },
  {
    id: 'mycorrhizal_bond', source: 'passive', on: ['OnSummon'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnSummon') return;
      // Next non-Summon skill is cheaper in Beats.
      ctx.owned.flags.nextSkillBeatDiscount = 2;
      logLine(ctx, 'trigger', 'Mycorrhizal Bond: next skill costs 2 fewer Beats');
    },
  },
  {
    id: 'verdant_pulse', source: 'passive', on: ['OnActorTurn'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnActorTurn' || ev.actor.kind !== 'player') return;
      const counter = Number(ctx.owned.flags.verdantCounter ?? 0) + 1;
      ctx.owned.flags.verdantCounter = counter;
      if (counter % 3 !== 0) return;
      heal(ctx, ev.actor, 5);
      ctx.actors.filter(a => a.alive && a.kind === 'summon')
        .forEach(s => heal(ctx, s, 5));
    },
  },
  {
    id: 'bleeding_wounds', source: 'passive', on: ['OnAreaDamage'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnAreaDamage') return;
      ev.targets.forEach(t => inflictStatus(ctx, ev.attacker, t, 'bleed', 2, D.bleed));
    },
  },
  {
    id: 'debilitating_presence', source: 'passive', on: ['OnDebuffApplied'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDebuffApplied' || ev.status === 'slow') return;
      inflictStatus(ctx, ev.attacker, ev.target, 'slow', 1, D.slow);
    },
  },
  {
    id: 'brittle_fury', source: 'passive', on: ['OnHit'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnHit' || ev.attacker.kind !== 'player') return;
      if (!ev.tags.includes('Melee')) return;
      inflictStatus(ctx, ev.attacker, ev.target, 'brittle', 1, D.brittle);
    },
  },
  {
    id: 'momentum_strike', source: 'passive', on: ['OnMove'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnMove' || ev.actor.kind !== 'player') return;
      ctx.owned.flags.momentumStrikeArmed = true;
      ctx.owned.flags.momentumStrikeBeats = D.momentum;
    },
  },
  {
    id: 'primal_instinct', source: 'passive', on: ['OnTransform'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnTransform') return;
      // Your next two actions are quicker after shifting form.
      ctx.owned.flags.hasteActions = 2;
      logLine(ctx, 'trigger', 'Primal Instinct: next 2 actions cost 1 less Beat');
    },
  },
  {
    id: 'feral_adaptation', source: 'passive', on: ['OnTransform'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnTransform') return;
      dealAreaDamage(ctx, {
        attacker: ev.actor, centre: ev.actor.tile, radius: 2, amount: 12,
        type: 'nature', tags: ['AOE', 'Nature', 'Transform'], hits: 'enemy',
        colour: '#ffb74d', label: 'Feral Adaptation',
      });
      ev.actor.flags.shieldHp = Number(ev.actor.flags.shieldHp ?? 0) + 12;
      logLine(ctx, 'trigger', 'Feral Adaptation erupts and shields you');
    },
  },

  // ==========================================================
  // ITEMS
  // ==========================================================
  {
    id: 'venomweave_cloak', source: 'item', on: ['OnHit'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnHit' || ev.attacker.faction !== 'player') return;
      if (ev.target.faction !== 'enemy') return;
      inflictStatus(ctx, ev.attacker, ev.target, 'poison', 1, -1);
    },
  },
  {
    id: 'spore_sac', source: 'item', on: ['OnHit'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnHit' || ev.attacker.faction !== 'player') return;
      if (statusStacks(ev.target.statuses, 'poison') < STATUS_CAPS.poison) return;
      if (ev.target.flags.sporeSacSpent) return;
      ev.target.flags.sporeSacSpent = true;
      logLine(ctx, 'trigger', `Spore Sac detonates ${ev.target.name}`, true);
      dealDamage(ctx, {
        attacker: ev.attacker, target: ev.target, amount: 30,
        type: 'poison', tags: ['Poison', 'AOE'], silentTriggers: true,
      });
    },
  },
  {
    id: 'bramble_heart', source: 'item', on: ['OnDamageTaken'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDamageTaken' || ev.target.kind !== 'player') return;
      if (ev.attacker.faction !== 'enemy') return;
      dealDamage(ctx, {
        attacker: ev.target, target: ev.attacker, amount: 6,
        type: 'physical', tags: ['Physical'], silentTriggers: true,
      });
      logLine(ctx, 'trigger', 'Bramble Heart lashes back');
    },
  },
  {
    id: 'thorned_carapace', source: 'item', on: ['OnDamageTaken'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDamageTaken' || ev.target.kind !== 'player') return;
      spawnHazard(ctx, ev.target.tile, 3, D.thornZone, 'player', 'Thorn Zone', '#8d6e63', ['DOT', 'Physical']);
    },
  },
  {
    id: 'guardian_bark_amulet', source: 'item', on: ['OnDamageTaken', 'OnActorTurn'],
    handle: (ev, ctx) => {
      const player = ctx.actors.find(a => a.kind === 'player');
      if (!player || !player.alive) return;
      if (player.flags.barkUsed) return;
      if (player.hp / player.maxHp >= 0.3) return;
      player.flags.barkUsed = true;
      player.flags.shieldHp = Number(player.flags.shieldHp ?? 0) + 25;
      logLine(ctx, 'trigger', 'Guardian Bark hardens around you (+25 shield)', true);
      fx(ctx, { kind: 'ring', tile: player.tile, colour: '#a1887f', lifeMs: 600, radius: 1 });
    },
  },
  {
    id: 'living_moss_shield', source: 'item', on: ['OnActorTurn'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnActorTurn' || ev.actor.kind !== 'player') return;
      const quiet = Number(ctx.owned.flags.beatsSinceHit ?? 99);
      heal(ctx, ev.actor, quiet >= 6 ? 2 : 1);
    },
  },
  {
    id: 'moonbone_charm', source: 'item', on: ['OnKill'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnKill') return;
      ctx.owned.flags.moonboneBoost = 0.12;
      if (ev.target.flags.isElite) {
        ctx.owned.flags.moonboneBoost = 0.24;
        ctx.owned.flags.moonboneBeats = 10;
        logLine(ctx, 'trigger', 'Moonbone Charm flares (+24% summon damage)');
      }
    },
  },
  {
    id: 'packleader_fang', source: 'item', on: ['OnSummon'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnSummon') return;
      const summons = ctx.actors.filter(a => a.alive && a.kind === 'summon');
      if (!summons.length) return;
      const first = summons.find(s => s.flags.packleaderFirst) ?? summons[0];
      first.flags.packleaderFirst = true;
      const bonus = Number(first.flags.bonusDamage ?? 0) + 5;
      first.flags.bonusDamage = bonus;
      logLine(ctx, 'trigger', `Packleader's Fang: ${first.name} +5 damage (now +${bonus})`);
    },
  },
  {
    id: 'hive_mind_crown', source: 'item', on: ['OnHit'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnHit' || ev.attacker.kind !== 'summon') return;
      // All summons converge on the last thing a summon hit.
      ctx.owned.flags.hiveFocusId = ev.target.id;
    },
  },
  {
    id: 'packlord_coronet', source: 'item', on: ['OnDebuffApplied'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnDebuffApplied') return;
      ev.target.flags.packlordMark = true;
      fx(ctx, { kind: 'text', tile: ev.target.tile, colour: '#ce93d8', text: '◈', lifeMs: 700 });
    },
  },
  {
    id: 'totem_bark_ring', source: 'item', on: ['OnSummon'],
    handle: (ev, ctx) => {
      if (ev.type !== 'OnSummon') return;
      // Totem-tagged summons last 40% longer.
      ctx.actors.filter(a => a.alive && a.kind === 'summon' && a.tags.includes('Totem') && !a.flags.totemExtended)
        .forEach(s => {
          s.flags.totemExtended = true;
          s.flags.lifespan = Math.round(Number(s.flags.lifespan ?? 20) * 1.4);
        });
    },
  },
];

let installed = false;

/** Idempotent so hot-reload and repeated test setup cannot double-register. */
export function installContentHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks(hooks);
}

/** Ids implemented here, for the coverage test. */
export const HOOK_IMPLEMENTED_IDS: ReadonlySet<string> = new Set(hooks.map(h => h.id));

/** Decay of the short-lived player flags these hooks set. Driven by the engine. */
export function decayOwnedFlags(ctx: CombatContext, beats: number): void {
  const f = ctx.owned.flags;

  const fm = Number(f.feralMomentumBeats ?? 0);
  if (fm > 0) {
    f.feralMomentumBeats = fm - beats;
    if (Number(f.feralMomentumBeats) <= 0) {
      f.feralMomentumStacks = 0;
      f.feralMomentumBeats = 0;
    }
  }

  const ms = Number(f.momentumStrikeBeats ?? 0);
  if (ms > 0) {
    f.momentumStrikeBeats = ms - beats;
    if (Number(f.momentumStrikeBeats) <= 0) {
      f.momentumStrikeArmed = false;
      f.momentumStrikeBeats = 0;
    }
  }

  const mb = Number(f.moonboneBeats ?? 0);
  if (mb > 0) {
    f.moonboneBeats = mb - beats;
    if (Number(f.moonboneBeats) <= 0) {
      f.moonboneBoost = ctx.owned.itemIds.has('moonbone_charm') ? 0.12 : 0;
      f.moonboneBeats = 0;
    }
  }

  f.beatsSinceHit = Number(f.beatsSinceHit ?? 0) + beats;
}

export { livingEnemies, freeNeighbourTile };
