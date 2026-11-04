// Bulk balance sweep over complete runs. `npm run sim [count]`
import { initializeRegistry } from '../src/data';
import { sweep, simulateRun } from '../src/core/runSim';

initializeRegistry();

const count = parseInt(process.argv[2] ?? '60', 10);
const seeds = Array.from({ length: count }, (_, i) => i + 1);

// A/B: does the skill economy actually pay for its Beats?
for (const useSkills of [false, true]) {
  const a = sweep(seeds, { routePolicy: 'greedy_safe', useSkills });
  console.log(`skills ${useSkills ? 'used   ' : 'ignored'}: win ${a.winRate}% · ` +
    `level ${a.avgFinalLevel} · beats ${a.avgBeats} · stalls ${a.stalls}`);
}

for (const policy of ['greedy_safe', 'greedy_power'] as const) {
  const s = sweep(seeds, { routePolicy: policy });
  console.log(`\n=== route policy: ${policy} (${s.runs} runs) ===`);
  console.log(`win rate          ${s.winRate}%`);
  console.log(`avg rooms cleared ${s.avgRoomsCleared}`);
  console.log(`avg final level   ${s.avgFinalLevel}`);
  console.log(`avg kills         ${s.avgKills}`);
  console.log(`avg beats         ${s.avgBeats}`);
  console.log(`stalls            ${s.stalls}`);
  console.log(`deaths by floor   ${JSON.stringify(s.deathsByFloor)}`);
  console.log(`deaths by room    ${JSON.stringify(s.deathsByType)}`);
  console.log(`avg HP lost/room  ${JSON.stringify(s.avgHpLossByType)}`);
  if (s.errors.length) console.log(`ERRORS (${s.errors.length}): ${s.errors.slice(0, 5).join(' | ')}`);
}

// One run in detail, to eyeball the shape of a delve.
const r = simulateRun(7);
console.log(`\n=== seed 7 detail: ${r.won ? 'WON' : 'died on floor ' + r.diedOn?.floor} ===`);
r.rooms.forEach((room, i) => {
  console.log(
    `${String(i + 1).padStart(2)}. f${room.floor} ${room.type.padEnd(8)} ` +
    `${room.layout.padEnd(21)} L${room.level} ` +
    `${String(room.hpBefore).padStart(3)}→${String(room.hpAfter).padStart(3)} HP ` +
    `${String(room.beats).padStart(4)} beats  ${room.outcome}`);
});
