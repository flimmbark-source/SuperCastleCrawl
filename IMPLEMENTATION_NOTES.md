# Unique Player Mechanics Implementation

## Overview
This implementation adds comprehensive unique mechanics to the Druid class in Glyphdelve, transforming Move and Attack into interesting decisions while maintaining the core design paradigm.

## Completed Systems

### 1. Status Effect System (`/src/types/index.ts`, `/src/systems/CombatSystem.ts`)

**New Status Effects:**
- **Bleed**: Damage over time that self-decays (1 damage per stack at turn start, then -1 stack). Max 15 stacks.
- **Slow**: Movement speed penalty (+50% Move GCD per stack). Duration-based (4s). Max 3 stacks.
- **Stun**: Action denial. Cleared at start of turn. Cannot stack.
- **Brittle**: Burst vulnerability (+50% damage taken from next hit, then consumed). 3s duration.
- **Exposed**: Sustained vulnerability (+25% damage from all sources). 4s duration, refreshes on reapply.

**Implementation:**
- Added status effect fields to Entity interface
- Created processing functions: `processBleed()`, `updateStatusEffects()`, `applyBleed()`, `applySlow()`, `applyBrittle()`, `applyExposed()`, `applyStun()`
- Integrated into damage calculation pipeline (Brittle/Exposed multipliers)
- Added HARD_CAPS for maxBleedStacks (15) and maxSlowStacks (3)

### 2. Keyword System (`/src/data/keywords.ts`)

**Three Categories:**
- **Action Keywords**: Move, Attack, AoE, Dash, Channel, Transform
- **Modifier Keywords**: Leap, Winding, Trample, Splash, Pierce, Echo, Repeat, Roar
- **Trigger Keywords**: On Move, On Attack, On Transform, On Debuff Applied, On Area Damage, On Hit, On Kill, On Damage Taken

**Features:**
- Full definitions with examples for each keyword
- Status effect definitions with mechanics explanations
- Helper functions: `getKeywordDefinition()`, `getStatusDefinition()`, `getStatusIcon()`
- KEYWORD_MAP for text parsing

### 3. New Druid Abilities (`/src/data/skills.ts`)

**Starter Ability (Player "1" key):**
1. **Bear Form Transform** (Common): Toggle between Caster and Bear forms. Changes Move and Attack behavior:
   - **Caster Form**: Attack = Bark Missile (ranged projectile, 14 damage)
   - **Bear Form**: Attack = Bear Claw (melee slash, 12 damage), Move = Trample (6 damage to enemies in path)
   - Upgrade: Enhanced Bear Form (+15% move speed, Trample 9 damage)

**Additional Skills:**
2. **Roaring Sprint** (Uncommon): Transform passive - Move gains 80 radius AoE Roar at destination (6 damage), +30% Move GCD
3. **Repeating Echo** (Rare): Active buff - Next ability triggers twice (60% on second), 18s cooldown
4. **Thorn Mantle** (Uncommon): Active defensive - 6s buff that emits 40 radius AoE when damaged (8 damage), 14s cooldown

### 4. New Druid Passives (`/src/data/passives.ts`)

**Added 5 new passives:**
1. **Bleeding Wounds** (Uncommon): Area Damage applies 1 Bleed to enemies hit
2. **Debilitating Presence** (Uncommon): Applying any debuff also applies 1 Slow
3. **Brittle Fury** (Rare): Melee attacks apply Brittle (3s duration)
4. **Momentum Strike** (Common): After Move, next Attack +40% damage and Pierce 1
5. **Feral Adaptation** (Rare): On Transform, gain 2s invuln + 60 radius AoE (12 damage)

### 5. Rule-Bending Items (`/src/data/items.ts`)

**Added 8 new items:**

**Movement Modifiers:**
- **Winding Paws** (Relic): Move becomes Winding (curved path, +20% GCD, dodge projectiles)
- **Leaping Greaves** (Uncommon): Move becomes Leap (arc trajectory, +60% GCD, 10 AoE damage on landing)

**Attack Modifiers:**
- **Splinter Fang** (Uncommon): Attack fires 3 projectiles in 30° cone (60% damage each)

**AoE Modifiers:**
- **Condensed Fury** (Rare): AoEs -40% radius but trigger twice

**Utility:**
- **Echo Seed (Reformed)** (Relic): 15% chance abilities refund cooldown (but +40% GCD)
- **Thorned Carapace** (Uncommon): On damage taken, leave 40 radius Thorn Zone (4s, 3 dmg/sec, max 3)
- **Packlord's Coronet** (Rare): Your debuffs mark targets for +30% summon damage (6s, max 5 targets)

### 6. Combat System Integration (`/src/systems/CombatSystem.ts`)

**New Trigger Handlers:**
- `processOnDebuffAppliedTriggers()`: Handles Debilitating Presence and Packlord's Coronet
- `processOnAreaDamageTriggers()`: Handles Bleeding Wounds passive

**Damage Pipeline Updates:**
- Brittle status checked and consumed on hit (+50% damage)
- Exposed status checked on hit (+25% damage, not consumed)
- Packlord's Coronet marking system for summons
- Venomweave now triggers OnDebuffApplied

### 7. UI Components

**KeywordText Component** (`/src/ui/components/KeywordText.tsx`):
- Parses text and highlights keywords with dotted underlines
- Shows tooltip on hover with definition, mechanics, and examples
- Integrates with KEYWORD_MAP for automatic detection

**StatusIcon Component** (`/src/ui/components/StatusIcon.tsx`):
- Displays status effect icon with stack count
- Shows detailed tooltip with mechanics on hover
- Three sizes: small, medium, large
- Includes duration display

**LootSelectionModal Component** (`/src/ui/modals/LootSelectionModal.tsx`):
- 3-choice item selection UI
- Displays items with rarity colors, slot badges, and icons
- Uses KeywordText for description parsing
- "Skip for Essence" option

## Integration Points (Requires Further Work)

### Game.ts Integration

The following systems need to be integrated into the main game loop:

1. **Status Effect Updates** (`Game.ts` main loop):
```typescript
import { processBleed, updateStatusEffects } from './systems/CombatSystem';

// In game update loop:
updateStatusEffects(state, dt);

// At start of player turn:
processBleed(state);
```

2. **Movement Modifications** (when items equipped):
- Check for Winding Paws → apply curved movement path
- Check for Leaping Greaves → apply arc trajectory + landing AoE
- Check for Roaring Sprint → apply Roar at destination when in Bear Form

3. **Attack Modifications** (when items equipped):
- Check for Splinter Fang → fire 3 projectiles in cone
- Apply Momentum Strike buff after Move actions

4. **AoE Modifications** (when Condensed Fury equipped):
- Reduce AoE radius by 40%
- Trigger AoE effects twice

5. **Transform Triggers**:
- Process OnTransform triggers (Feral Adaptation)
- Track Transform state for Roaring Sprint

6. **Ability Triggers**:
- Repeating Echo buff application and consumption
- Echo Seed cooldown refund checks
- Thorn Mantle damage reflection

### Loot System Integration

The 3-choice loot system needs to be integrated into combat completion:

```typescript
// When combat ends (enemy room cleared):
if (shouldDropLoot()) {
  const offers = generateLootOffers(3, state); // Generate 3 random items
  const essenceReward = calculateEssenceReward(state);

  // Show LootSelectionModal
  showLootModal(offers, essenceReward);
}
```

### HUD Integration

Display status icons on entities:

```typescript
// In entity rendering:
import { StatusIcon } from './components/StatusIcon';

// For each entity:
{entity.bleedStacks > 0 && <StatusIcon statusId="bleed" stacks={entity.bleedStacks} />}
{entity.slowStacks > 0 && <StatusIcon statusId="slow" stacks={entity.slowStacks} duration={entity.slowDuration} />}
{entity.brittle && <StatusIcon statusId="brittle" duration={entity.brittleDuration} />}
{entity.exposed && <StatusIcon statusId="exposed" duration={entity.exposedDuration} />}
{entity.stunned && <StatusIcon statusId="stun" />}
```

## Synergy Examples

### Build Archetype: "Bleeding Trampler"
**Core Loop:**
1. Equip: Leaping Greaves + Condensed Fury
2. Passive: Bleeding Wounds + Debilitating Presence
3. Ability: Roaring Sprint

**Gameplay:**
- Move → Leap landing deals 10 damage in small AoE (triggers twice = 20 damage)
- Bleeding Wounds applies 2 Bleed per leap (double from Condensed Fury)
- Debilitating Presence adds 2 Slow stacks
- In Bear Form, also get Roar at destination (triggers twice = 12 more damage, 2 more Bleed)

### Build Archetype: "Brittle Burst"
**Core Loop:**
1. Passive: Brittle Fury + Momentum Strike
2. Item: Packlord's Coronet
3. Summons: Briar Wolves

**Gameplay:**
- Move → Gain Momentum Strike buff
- Attack → Apply Brittle + marked for summons
- Summons attack Brittle target → +50% damage from Brittle, +30% from mark
- Target takes massive burst damage from combo

### Build Archetype: "Echo Spam"
**Core Loop:**
1. Ability: Repeating Echo + Thorn Mantle
2. Item: Echo Seed (Reformed) + Condensed Fury
3. Passive: Bleeding Wounds

**Gameplay:**
- Cast Repeating Echo → Next ability triggers twice
- Cast Thorn Mantle → 6s retaliation buff (applied twice)
- Get hit → Emit AoE 4 times (2 buffs × 2 triggers from Condensed Fury)
- Each AoE applies Bleed (8 stacks total per damage taken)
- 15% chance Echo Seed refunds Thorn Mantle → cast again immediately

## Testing Checklist

- [ ] Status effects apply correctly (Bleed, Slow, Brittle, Exposed, Stun)
- [ ] Status effects decay/expire properly
- [ ] Brittle consumed on hit, Exposed persists
- [ ] OnDebuffApplied triggers fire (Debilitating Presence, Packlord's Coronet)
- [ ] OnAreaDamage triggers fire (Bleeding Wounds)
- [ ] KeywordText highlights and tooltips work
- [ ] StatusIcon displays and tooltips work
- [ ] LootSelectionModal renders correctly
- [ ] Movement modifiers change player movement
- [ ] Attack modifiers change player attacks
- [ ] Repeating Echo doubles ability effects
- [ ] Condensed Fury doubles AoE triggers

## Design Philosophy Adherence

✅ **Keyword-first design**: Every mechanic uses explicit keywords (Move, Attack, Leap, Roar, etc.)

✅ **Natural language**: Descriptions read like sentences, not stat blocks

✅ **Trigger transparency**: All triggers explicitly stated with "On X" or "When Y"

✅ **Synergy visibility**: Every item/passive has synergyNote explaining interactions

✅ **Rule-bending clarity**: Movement/Attack modifiers clearly state the transformation

✅ **Depth through combination**: Individual pieces are simple, but combos create emergent complexity

## Notes

- All new tags added to Tag union type (OnMove, OnAttack, OnTransform, OnDebuffApplied, OnAreaDamage, Movement, Attack, Utility, Defensive, Modifier)
- TypeScript types updated to support optional status effect fields on Entity
- Combat system exports all new functions for integration
- UI components are fully self-contained and can be imported as needed
- All content follows existing rarity/baseWeight conventions
- Synergy ratings would be calculated by existing engine based on tag matching
