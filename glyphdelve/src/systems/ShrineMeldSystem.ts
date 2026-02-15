import type {
  RunState, MeldType, MeldRecipe, Tag,
  ActiveSkill, ActivePassive, ActiveItem,
  SkillDef, PassiveDef, ItemDef
} from '../types';
import { MELD_COSTS, HARD_CAPS } from '../types';
import { registry } from '../engine/DataRegistry';
import { addCombatLog, updateBuildTags } from '../engine/RunState';

export interface MeldInput {
  type: 'skill' | 'passive' | 'item';
  id: string;
  name: string;
  tags: Tag[];
}

export interface MeldPreview {
  possible: boolean;
  outputName: string;
  outputDescription: string;
  outputTags: Tag[];
  inheritedTraits: string[];
  emergentTrait: string;
  cost: number;
  reason?: string;
}

export function getMeldableItems(state: RunState, meldType: MeldType): MeldInput[] {
  const player = state.player;
  const results: MeldInput[] = [];

  if (meldType === 'skill_skill') {
    player.skills.forEach(s => {
      results.push({ type: 'skill', id: s.def.id, name: s.def.name, tags: s.def.tags });
    });
  } else if (meldType === 'passive_passive') {
    player.passives.forEach(p => {
      results.push({ type: 'passive', id: p.def.id, name: p.def.name, tags: p.def.tags });
    });
  } else if (meldType === 'item_item') {
    player.items.forEach(i => {
      results.push({ type: 'item', id: i.def.id, name: i.def.name, tags: i.def.tags });
    });
  }

  return results;
}

export function previewMeld(
  state: RunState,
  input1: MeldInput,
  input2: MeldInput,
  meldType: MeldType
): MeldPreview {
  const cost = MELD_COSTS[meldType];

  if (state.player.essence < cost) {
    return {
      possible: false,
      outputName: '???',
      outputDescription: 'Insufficient Essence',
      outputTags: [],
      inheritedTraits: [],
      emergentTrait: '',
      cost,
      reason: `Need ${cost} Essence (have ${state.player.essence})`,
    };
  }

  if (input1.id === input2.id) {
    return {
      possible: false,
      outputName: '???',
      outputDescription: 'Cannot meld an item with itself',
      outputTags: [],
      inheritedTraits: [],
      emergentTrait: '',
      cost,
      reason: 'Cannot meld same item with itself',
    };
  }

  // Find matching recipe
  const recipe = registry.findMeldRecipe(input1.tags, input2.tags, meldType);

  if (!recipe) {
    // Generate a generic meld result from tag intersection
    return generateGenericMeld(input1, input2, meldType, cost);
  }

  // Look up the output definition
  let outputName = recipe.outputId;
  let outputDesc = '';
  let outputTags: Tag[] = [];

  if (recipe.outputType === 'skill') {
    const skill = registry.getSkill(recipe.outputId);
    if (skill) {
      outputName = skill.name;
      outputDesc = skill.description;
      outputTags = skill.tags;
    }
  } else if (recipe.outputType === 'passive') {
    const passive = registry.getPassive(recipe.outputId);
    if (passive) {
      outputName = passive.name;
      outputDesc = passive.description;
      outputTags = passive.tags;
    }
  } else if (recipe.outputType === 'item') {
    const item = registry.getItem(recipe.outputId);
    if (item) {
      outputName = item.name;
      outputDesc = item.description;
      outputTags = item.tags;
    }
  }

  // Validate against hard caps
  const capViolation = checkCapViolation(state, recipe);
  if (capViolation) {
    return {
      possible: false,
      outputName,
      outputDescription: outputDesc,
      outputTags,
      inheritedTraits: recipe.inheritedTraits,
      emergentTrait: recipe.emergentTrait,
      cost,
      reason: capViolation,
    };
  }

  return {
    possible: true,
    outputName,
    outputDescription: outputDesc,
    outputTags,
    inheritedTraits: recipe.inheritedTraits,
    emergentTrait: recipe.emergentTrait,
    cost,
  };
}

function generateGenericMeld(
  input1: MeldInput,
  input2: MeldInput,
  meldType: MeldType,
  cost: number
): MeldPreview {
  // Find shared tags
  const sharedTags = input1.tags.filter(t => input2.tags.includes(t));
  const allTags = [...new Set([...input1.tags, ...input2.tags])];

  // Inherit up to 2 parent traits (pick from names)
  const inheritedTraits = [
    `${input1.name} base effect`,
    `${input2.name} base effect`,
  ];

  // Emergent trait from shared tags or dominant parent
  const emergentTag = sharedTags.length > 0 ? sharedTags[0] : allTags[0];
  const emergentTrait = `Enhanced ${emergentTag} synergy effect`;

  return {
    possible: true,
    outputName: `Fused ${input1.name.split(' ')[0]} ${input2.name.split(' ').pop()}`,
    outputDescription: `A melded creation combining aspects of ${input1.name} and ${input2.name}.`,
    outputTags: allTags.slice(0, 5) as Tag[],
    inheritedTraits,
    emergentTrait,
    cost,
  };
}

function checkCapViolation(state: RunState, recipe: MeldRecipe): string | null {
  // Check if the result would violate any hard caps
  const activeSummons = state.entities.filter(e => e.type === 'summon' && e.alive).length;
  // We can't fully know until runtime, but check obvious cases
  return null;
}

export function executeMeld(
  state: RunState,
  input1: MeldInput,
  input2: MeldInput,
  meldType: MeldType,
  preview: MeldPreview
): boolean {
  if (!preview.possible) return false;

  const player = state.player;

  // Deduct cost
  player.essence -= preview.cost;

  // Remove inputs
  if (meldType === 'skill_skill') {
    player.skills = player.skills.filter(
      s => s.def.id !== input1.id && s.def.id !== input2.id
    );
    // Add melded skill
    const meldedSkill = registry.getSkill(
      registry.findMeldRecipe(input1.tags, input2.tags, meldType)?.outputId || ''
    );
    if (meldedSkill) {
      player.skills.push({
        def: meldedSkill,
        cooldownRemaining: 0,
        level: 1,
        upgraded: false,
      });
    }
  } else if (meldType === 'passive_passive') {
    player.passives = player.passives.filter(
      p => p.def.id !== input1.id && p.def.id !== input2.id
    );
    const meldedPassive = registry.getPassive(
      registry.findMeldRecipe(input1.tags, input2.tags, meldType)?.outputId || ''
    );
    if (meldedPassive) {
      player.passives.push({ def: meldedPassive, active: true });
    }
  } else if (meldType === 'item_item') {
    player.items = player.items.filter(
      i => i.def.id !== input1.id && i.def.id !== input2.id
    );
    const meldedItem = registry.getItem(
      registry.findMeldRecipe(input1.tags, input2.tags, meldType)?.outputId || ''
    );
    if (meldedItem) {
      player.items.push({ def: meldedItem, modifiers: [], melded: true, cooldownRemaining: 0 });
    }
  }

  // Log
  addCombatLog(state, {
    type: 'meld',
    source: 'shrine',
    details: `Melded ${input1.name} + ${input2.name} = ${preview.outputName}`,
  });

  state.meldHistory.push({
    input1: input1.id,
    input2: input2.id,
    output: preview.outputName,
    type: meldType,
    cost: preview.cost,
  });

  updateBuildTags(player);
  return true;
}
