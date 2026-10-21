// Headless pace check: a clean "good human" bot vs the AI riders (no traffic, no combat).
// Usage: node scripts/balance-sim.mjs [runs]
import { createRacerState, stepRacer } from '../src/game/Physics.js';
import { computeAIInput } from '../src/game/AIController.js';
import { RACE_DISTANCE, sampleAt } from '../shared/track.js';

const DT = 1 / 60;
const DEFS = [
  { name: 'Rex', skill: 0.92, lane: -4.6 }, { name: 'Mika', skill: 0.78, lane: 4.6 },
  { name: 'Juno', skill: 0.66, lane: -2.3 }, { name: 'Vex', skill: 0.54, lane: 2.3 },
  { name: 'Nova', skill: 0.42, lane: 5.35 },
];
const DIFF = { speed: 1, rubber: 1 };

function botInput(state) {
  let target = 99;
  for (const look of [10, 30, 60, 100]) target = Math.min(target, Math.max(26, sampleAt(state.progress + look).safeSpeed * 0.97));
  const brake = state.speed > target + 1 ? 1 : 0;
  return { throttle: brake ? 0 : 1, brake, steer: Math.max(-1, Math.min(1, (0 - state.lateral) * 0.5)), boost: state.boost > 25 };
}

function race() {
  const bot = createRacerState();
  const ais = DEFS.map((d) => ({ ...d, preferredLane: d.lane, laneTarget: d.lane, thinkTimer: 0, moodTimer: 0, aggression: 0.3, state: createRacerState({ lateral: d.lane }) }));
  const traffic = { all: [] };
  const times = {};
  let t = 0;
  while (t < 400 && Object.keys(times).length < 6) {
    t += DT;
    if (!bot.finished) { stepRacer(bot, botInput(bot), DT, sampleAt(bot.progress)); if (bot.progress >= RACE_DISTANCE) { bot.finished = true; times.Bot = t; } }
    for (const ai of ais) {
      if (ai.state.finished) continue;
      const input = computeAIInput(ai, { traffic, playerProgress: bot.progress, playerLateral: bot.lateral, elapsed: t, difficulty: DIFF }, DT);
      stepRacer(ai.state, input, DT, sampleAt(ai.state.progress));
      if (ai.state.progress >= RACE_DISTANCE) { ai.state.finished = true; times[ai.name] = t; }
    }
  }
  return times;
}

const runs = Number(process.argv[2] ?? 3);
const acc = {};
for (let i = 0; i < runs; i++) for (const [k, v] of Object.entries(race())) (acc[k] ??= []).push(v);
for (const [k, v] of Object.entries(acc)) console.log(k.padEnd(5), (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) + 's');
console.log('race distance', RACE_DISTANCE.toFixed(0), 'm');
