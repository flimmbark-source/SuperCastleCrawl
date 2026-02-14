# Glyphdelve — Minimalist Systemic Dungeon Crawler Prototype

## Setup & Run

```bash
cd glyphdelve
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Production Build
```bash
npm run build
npx vite preview   # serves dist/
```

## Controls

| Input | Action |
|-------|--------|
| WASD | Move |
| Mouse | Aim |
| Left Click | Basic attack (auto-fire) |
| 1 / 2 / 3 | Use skill 1/2/3 |
| E | Interact |
| ESC | Pause |
| F3 | Debug overlay |
| F5 | Restart same seed |

All keys are remappable via Settings.

## Architecture

```
src/
├── types/          # All TypeScript type definitions, constants, XP table
├── engine/         # Core: SeededRNG, DataRegistry, RunState, GameLoop, InputManager, AccessibilitySettings
├── systems/        # CombatSystem, LevelSystem, DropSystem, ShrineMeldSystem, EnemyAI
├── renderer/       # Canvas2D renderer (entities, tiles, particles, telegraphs)
├── data/           # Content registries: skills, passives, items, modifiers, enemies, meldRecipes
├── ui/
│   ├── components/ # HUD, MapView
│   ├── modals/     # LevelUpModal, ShrineModal
│   └── panels/     # SettingsPanel, SidePanel, BuildSummary, DebugOverlay
└── App.tsx         # Main React app orchestrator
```

## Run Loop

1. Start from menu (choose seed)
2. Enter dungeon map (2 floors x 9 nodes each)
3. Traverse nodes: combat, elite, shrine, recovery, event, boss
4. Real-time top-down combat with WASD movement + mouse aim
5. Gain XP from kills, level up, choose 1 of 5 mixed offers (skills/passives)
6. Enemies drop items/essence/consumables
7. Shrines allow melding two elements into one powerful hybrid
8. Beat floor 1 boss, progress to floor 2, beat final boss to win

## Key Systems

### Level-Up Offers (5 cards, always)
- Min 2 skill/upgrade offers, min 2 passive offers, 1 flex
- Weighted: `FinalWeight = Base x Synergy x Pity x Novelty x RarityAdj`
- Anti-frustration: forced High-synergy after 2 dry levels

### Combat Resolution Order
1. Validity 2. Avoidance 3. Mitigation 4. Damage 5. OnDamageTaken
6. OnHit 7. OnHitTaken 8. Lethal 9. OnKill/OnDeath 10. Cleanup
- Trigger chain depth cap: 4, same-trigger repeats: 2, spawns per event: 6

### Drop Tables
- Normal: 12% item, 22% essence (pity at 10 kills -> 35%)
- Elite: 65% item, 100% essence
- Boss: 100% item, 100% essence, 35% rare/relic

### Shrine Melding
- Skill+Skill (45 Essence), Passive+Passive (55), Item+Item (35)
- Inherit 2 parent traits + 1 emergent trait from shared tags
- Preview before confirm, hard cap enforcement

### Druid Content
- 8 skills, 14 passives, 12 items, 10 modifiers
- 6 meld recipes with distinct outcomes

### Three Viable Archetypes
1. **Swarm Summoner**: Pack Tactics + multiple wolf summons + Swarming modifier
2. **Elite Single-Summon**: Alpha Bond + upgraded Alpha Wolf + Elder Bond
3. **Caster-Summoner Hybrid**: Mycorrhizal Bond + Spore Bolt + Fungal Link

## Accessibility Features
- Full key remapping
- Pause anytime (ESC)
- Game speed: 0.75x / 1.0x / 1.25x
- Font scale: 100% / 125% / 150%
- Colorblind-safe mode (patterns/icons, not color-only)
- Reduced motion toggle
- Screen shake toggle
- Tooltip mode: Plain / Detailed

## Balancing Notes

### Current State
- Floor 1 enemies: 18-45 EHP, 5-9 DPS
- Floor 2 enemies: ~1.5-1.8x scaling
- Player base: 100 HP, 4.2 tiles/sec, 8 base auto-attack damage
- XP curve: L2@60, L3@140, L4@240 -- players should hit L3-4 by floor 1 mid

### Known Tuning Needs
- Boss HP may need adjustment after observing meld-empowered builds
- Poison stack cap (12) may be too generous with Toxic Proliferation
- Swarm archetype may out-DPS single-summon in late game -- Alpha Bond values may need +10%
- Echo Seed (15% skill echo) is potentially very strong with low-CD skills -- monitor

## Extension Roadmap
1. More classes: Pyromancer (burn/chain), Shadowblade (stealth/crit)
2. Meta-progression: Unlock permanent small bonuses between runs
3. More floors: 3-4 floors with escalating enemy diversity
4. More meld recipes: 20+ distinct outcomes, cross-archetype melds
5. Sound: Procedural audio cues for combat feedback
6. Multiplayer: Co-op 2-player with shared shrine economy
7. Content tooling: JSON editor for balancing skills/enemies in-browser
