# Ecosystem Prototype Prompt (reformed)

Build a turn-based dice roguelite in stages. Single self-contained HTML file,
no build step, no external JS libraries, phone portrait playable, dark fantasy
dungeon tone. Google Fonts fine.

## ARCHITECTURE — NON-NEGOTIABLE

Separate the simulation from all rendering. The sim is pure logic: no DOM, no
canvas, no timers, deterministic given a seed, and it exports via
`if (typeof module !== 'undefined') module.exports = SIM`.

Also build an AUTOPLAY HARNESS that runs the headless sim thousands of times
under different bot policies and prints aggregate stats. Build this in Stage 1
and extend it every stage. An ecosystem cannot be evaluated by hand-play.
Bot policies: greedy (always commit), reroll-hungry (reroll anything below
average), cautious (extract early), diver (descend at first opportunity).

Build the stages IN ORDER. Each has a kill-gate. If a gate fails, stop and
report — do not proceed to the next stage.

## STAGE 1 — COMBAT CORE

**GATE:** Is progressive mutilation fun, or just sad? Fail if autoplay shows the
greedy policy and the reroll-hungry policy within 10% of each other (the
reroll economy isn't a decision), or if runs that reach 4+ scars never recover.

- Belt of 3 dice, left to right. Exactly 6 faces each, always 6.
- Each turn: all dice roll at once, player may reroll any die, then commits.
  Faces resolve left to right, then enemies act. Turn-based. No timers.
- HP is fight-scoped: refills between fights, pays for rerolls, 0 ends the run.
- Faces are run-scoped. Scars do NOT persist between runs in this slice.
- Reroll cost escalates within a turn and resets each turn.
- A damaged face becomes a SCAR: still rolls, is not blank, and is an empty
  SOCKET. A rolled scar's value scales with total scars on the belt — this is
  the single most important number in the design. Expose it as a named constant
  and have autoplay sweep it.
- Poison accumulates as PIPS on individual faces; 3 pips scars the face. Pips
  draw as dots, never numerals, because 1-2-3 read without counting. Poison is
  the ONLY per-face status.
- Defeating an enemy offers its signature face as a graft. A graft can only go
  into a scar socket. No scars means the graft is lost. Losing a face creates
  an opportunity — that is the design.
- THREE enemies only, one per axis, each appearing often enough to learn:
  - POSITION — scars a face on the rightmost die.
  - SHOWING  — poisons whichever face is currently face-up.
  - PLAIN    — HP damage only, no face effect.
  Every enemy telegraphs its exact target one full turn ahead, deterministically.
  Never target a face at random. The UI highlights that face ON THE DIE.
- A gauntlet of 5 fights. Between fights HP refills, scars do not, and the
  player picks one of two offered grafts or healing items.
- Healing must be SHAPED, never a flat number. Three options with genuinely
  different decisions: restore the leftmost scar on a die / restore all scars
  on a die with 2+ scars / convert a scar into a copy of an adjacent face.

## STAGE 2 — THE FLOOR, LIGHT AND EXTRACTION

**GATE:** Is the extraction decision agonizing? Fail if the diver policy and the
cautious policy differ by more than 25% in median banked gold — a dominant
strategy means the choice is fake.

- Fogged grid of 7-11 connected rooms. Entrance at an edge, stairs furthest
  away. Rooms: fight, elite, treasure, embers, empty.
- Entering an unvisited room spends 1 torch. Revisits are free.
- **THE TORCH RULE:** enemies always use their face-targeting signatures. Torch
  governs RECOVERABILITY, not whether faces are hit.
  - Torch > 0: face damage lands as pips and cracks that CLEAR after the fight.
  - Torch = 0: face damage lands as PERMANENT scars.
  Torch refills partially on descending; no other refill.
- Extraction: walk back to the entrance to bank gold and keep finds. Or descend
  for a deeper floor and a higher multiplier.
- Gold must be multiplied AT THE MOMENT IT IS EARNED by current depth, never
  retroactively at extraction. Retroactive multipliers reward farming the
  shallows then rushing, which inverts the entire risk premise.
- Add a reachable end: a boss at a fixed depth that completes a run. A loop
  with no completion gives players nothing to finish.

## STAGE 3 — BELT ORDER AND ECONOMY

**GATE:** Does gold create decisions? Fail if autoplay shows one purchase taken
first in over 80% of runs.

- Two positional chain faces: HONE (+N to the next die rightward this turn) and
  ECHO (next die rightward resolves twice). With no die to the right the face
  does NOTHING and the card must say so — silent waste is unacceptable.
- Because one enemy targets by position, belt order is contested: offense wants
  the buffer left of the payload, defence wants the best die out of the firing
  line. Preserve that tension.
- Camp upgrades, three only: +1 belt slot, +2 starting torch, +1 reroll before
  the cost escalates. No flat-percentage upgrades with many levels — linear
  steps against exponential cost stop being decisions after a few purchases.

## INSTRUMENTATION

Autoplay must report these three, prominently, because they are where this
design most likely breaks:

1. Scar count at extraction vs. at death — if deaths cluster above a scar
   threshold, the death spiral is real.
2. Voluntary dark fights per run — if near zero, the torch risk dial is not
   reading as a choice, it's reading as failure.
3. Graft take-rate when offered — if near 100%, the socket is not a decision.

## UI (load-bearing, not polish)

Dice are the primary visual: all faces of every belt die visible at all times,
large, with unmistakable intact / pipped / cracked / scarred / socketed states.
Telegraphed attacks highlight the target face on the die. A persistent
scrollable combat log. Crossing into darkness is an unmistakable event, not a
quiet decrement. Phone portrait. Nothing important behind hover or right-click.
Respect prefers-reduced-motion.

## OUT OF SCOPE

No real-time combat. No enemy dice. No statuses beyond poison. No share
artifact, no crafting, no shops, no classes, no story. No scar persistence
between runs. Resist content breadth — this tests whether systems interlock,
not whether there is enough stuff.
