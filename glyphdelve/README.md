# Glyphdelve

A tactical dungeon crawler where every action costs **Beats** — and Beats are
exactly what the monsters get to spend.

```bash
cd glyphdelve
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and production build |
| `npm test` | Run the test suite (46 tests) |
| `npm run lint` | ESLint |
| `npm run sim [n]` | Simulate `n` complete runs headlessly and print balance figures |

---

## The idea

Three rules carry the whole game.

**1. Every action costs Beats.** Stepping costs 2, a bolt costs 2, a heavy
skill costs 5. The cost is printed on every button *before* you press it,
because spending 4 Beats means handing every enemy 4 Beats of their own. A
Shadow Imp acts every 2 Beats, a Stone Golem every 5 — so "this costs 4" also
means "the imp gets two turns and the golem gets one." That arithmetic is the
game.

**2. Enemies tell you what they will do.** Every enemy declares its next
action and the board shows it: threatened tiles are hatched with the exact
incoming damage printed on them, movement draws as an arrow. Attacks are
**committed** — once declared, the tiles are locked in, so stepping out of
them makes the blow miss. Dodging is a decision, not a dice roll.

**3. The room is a weapon.** Walls block movement and line of fire. Bramble
costs an extra Beat to cross but nothing can shoot you inside it. Chasms
cannot be crossed — but anything shoved into one is gone for good, whatever
its health was.

Underneath sits the thing the game has always been about: **tags**. Every
skill, passive and item is tagged, and the level-up generator weights its
offers toward the tags you already carry, so the game notices the build you
are making and offers you more of it. At a **shrine** you can fuse two things
you own into a hybrid that inherits from both and gains a trait neither had.

---

## Controls

| Input | Action |
|---|---|
| `WASD` / `QEZC` / arrows | Step (walking into an enemy attacks it) |
| Click | Move to a tile, or strike an enemy in reach |
| `Space` / `.` | Focus — wait a single Beat |
| `1`–`9` | Use a skill |
| `Tab` | Toggle step-cost hints |
| `F5` | Restart the current seed |

Everything is remappable in Settings.

---

## Architecture

```
src/
├── core/           Pure, headless game. No DOM, no renderer, no wall clock.
│   ├── grid.ts         Terrain, line of fire, A* weighted by Beat cost
│   ├── roomgen.ts      Six seeded room layouts
│   ├── model.ts        The Beat economy, intents, Beat-denominated statuses
│   ├── combat.ts       Damage pipeline, shove, hazards, content hook registry
│   ├── contentHooks.ts Every passive and triggered item, in one place
│   ├── ai.ts           Enemy intent declaration and committed execution
│   ├── tactical.ts     The engine: action costs, scheduling, skill effects
│   ├── bot.ts          Heuristic reference player, used as a balance oracle
│   └── runSim.ts       Headless whole-run simulation
├── engine/         Orchestration: run state, branching map, input, phases
├── renderer/       Canvas2D board renderer
├── systems/        Level-up offers, drops, shrine melding
├── data/           Content registries: skills, passives, items, enemies, melds
└── ui/             React interface, built on the tokens in ui/theme.ts
```

Two properties are worth protecting:

**`src/core` has no browser dependencies.** It can be driven by a test or a
bot with no canvas, which is what makes `npm run sim` and the balance suite
possible at all.

**There is no simulation loop.** The game is turn-based, so game logic runs
only when the player acts. The animation frame is purely visual.

---

## Systems

### The Beat clock
Every actor carries `nextActAt`. The player spends Beats; the clock advances;
every actor whose turn falls inside that window acts in order, executing the
intent the player already saw, then declares a new one. Cooldowns are counted
in Beats and move only when an action is taken.

### Delve Pressure
A room that goes too long without a kill gets harder: enemies gain flat bonus
damage, capped at +8. There is a 14-Beat grace at the start so that crossing a
room is free — only stalling is taxed. At full pressure the delve begins
closing in on the player directly, which guarantees a room always resolves.

### Statuses
All durations are in Beats. Bleed ticks and decays when its victim acts.
Poison ticks and does not decay. Slow adds a Beat to everything the victim
does. Brittle is consumed by the next hit for +50%. Root denies movement but
not attacks.

### Elites
Elites carry a modifier that changes how they behave, not just their stat
line: **Frenzied** acts a Beat sooner and hits harder, **Shielded** regains a
shield each turn, **Toxic** poisons on hit and leaves a cloud where it dies.
The modifier is named in the turn rail and its rule stated in the inspector.

### The route
Each floor is a directed graph with real branches that fan out and rejoin,
built from quotas rather than per-node rolls. Elites pay better but cost
health you may not get back, and the spring and the shrine are rarely on the
same path.

---

## Balance

`npm run sim` plays complete runs with a heuristic bot and reports the result.
Current figures, 160 runs per configuration:

| Measure | Value |
|---|---|
| Win rate, playing the map carefully | ~54% |
| Win rate, always taking the elite | ~47% |
| Win rate, ignoring skills entirely | ~50% |
| Average level at the end | ~4 |
| Stalled rooms | 0 |

Three of those numbers matter as design evidence rather than trivia: route
choice is worth about seven points, which means the branching map is a real
decision; using skills beats ignoring them, which means the skill economy pays
for its Beats; and zero stalls means every room resolves.

The bot is deliberately not optimal. It kills what it can reach, steps out of
telegraphs that would really hurt, and otherwise closes distance. If it cannot
survive something, a person probably cannot either.

---

## Testing

```bash
npm test
```

46 tests across the Beat economy, intent commitment and dodging, terrain and
line of fire, shove interactions, statuses, the offer generator, shrine
melding, and opening balance.

Two of them exist to stop specific failures coming back:

- **`coverage.test.ts`** asserts that every declared item, passive and skill
  has an implementation, and that no description still talks in seconds or
  real-time stats. An earlier build shipped 8 items, 5 passives and a skill
  that were offered to the player, read as upgrades, and did nothing at all.
- **`balance.test.ts`** asserts a level-1 player can clear the opening room
  across 40 seeds. An earlier build's first room was not winnable.

---

## Accessibility

Full key remapping, 100/125/150% font scale, a colourblind mode that adds
shape and glyph cues rather than relying on hue, a reduced-motion mode that
disables tweens and marching-ant animations, a screen-shake toggle, and
plain/detailed tooltip modes. Terrain is distinguished by texture as well as
colour, and every threatened tile prints its damage as a number.

---

## Where it could go next

- A second class. The content model is class-agnostic; `data/` is the only
  place that assumes Druid.
- More meld recipes. Six is enough to prove the idea, not enough to explore.
- A third floor, and enemy archetypes that ask new spatial questions rather
  than carrying bigger numbers.
- Sound. There is none, and a Beat-driven game is unusually well suited to it.
