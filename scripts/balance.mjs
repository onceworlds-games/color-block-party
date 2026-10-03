// The balance harness: headless races of rival-skipper fleets over every course and weather, on the same pure
// simulation the game runs. Prints the numbers the design is tuned against.
//   node scripts/balance.mjs            (the full table)
//   node scripts/balance.mjs quick      (fewer races)
import { makeRace, stepRace, SIM_DT, standings } from '../game/js/sim/race.js';
import { thinkSkippers, botEntries, SKILLS, placeFleet } from '../game/js/sim/skippers.js';
import { COURSES } from '../game/js/sim/course.js';
import { WEATHER_IDS } from '../game/js/sim/wind.js';

const quick = process.argv.includes('quick');

/** Runs one race to the end; returns the boats. */
export function runRace({ seed, courseId, weather, laps = 2, skills, rules = 'racing', classes, preStart = 60 }) {
  const entries = botEntries(seed, skills.length, skills, (i) => (classes ? classes[i] : 'dinghy'));
  const race = makeRace({ seed, courseId, laps, weather, rules, entries, preStart });
  placeFleet(race);
  let guard = 0;
  while (race.phase !== 'done' && guard++ < 30 * 1800) {
    thinkSkippers(race);
    stepRace(race, SIM_DT);
    race.events.length = 0;
  }
  return { race, order: standings(race) };
}

const pct = (x) => `${(100 * x).toFixed(0)}%`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function skillTable(n) {
  // A fleet of each skill, two of each, on the classic windward-leeward at 12 knots.
  const rows = SKILLS.map(() => ({ times: [], starts: [], ocs: 0, fouls: 0, tacks: 0, dnf: 0, n: 0 }));
  const beats = {};
  for (let s = 0; s < n; s++) {
    const skills = [0, 1, 2, 3, 0, 1, 2, 3];
    const { order } = runRace({ seed: 1000 + s, courseId: 1, weather: 'classic', skills });
    for (const b of order) {
      const r = rows[b.bot.skill];
      r.n++;
      if (b.finished) r.times.push(b.finishT);
      else r.dnf++;
      if (b.startT !== null) r.starts.push(b.startT);
      r.ocs += b.stats.ocs;
      r.fouls += b.stats.fouls;
      r.tacks += b.stats.tacks;
    }
    // Pairwise: the best boat of each skill against the best of each other skill.
    const bestOf = {};
    for (const b of order) if (bestOf[b.bot.skill] === undefined) bestOf[b.bot.skill] = order.indexOf(b);
    for (const a of [0, 1, 2, 3]) for (const c of [0, 1, 2, 3]) if (a !== c) {
      const k = `${a}>${c}`;
      beats[k] = (beats[k] ?? 0) + (bestOf[a] < bestOf[c] ? 1 : 0);
    }
  }
  const avg = (l) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : NaN);
  const sk = avg(rows[2].times);
  console.log(`\nSkill on Pilot Bank, Classic 12 kn, 2 laps (${n} races of 8 boats)`);
  console.log('skill     time    vs Skipper  start   OCS/race  fouls  tacks  DNF');
  rows.forEach((r, i) => {
    const t = avg(r.times);
    console.log(`${SKILLS[i].name.padEnd(9)} ${mmss(t).padEnd(7)} ${(((t - sk) / sk) * 100).toFixed(1).padStart(6)}%    ${avg(r.starts).toFixed(1).padStart(5)}s  ${(r.ocs / r.n).toFixed(2).padStart(6)}   ${(r.fouls / r.n).toFixed(2).padStart(5)}  ${(r.tacks / r.n).toFixed(1).padStart(5)}  ${r.dnf}`);
  });
  console.log(`Skipper beats Mate ${pct(beats['2>1'] / n)} (target >=80%), Mate beats Deckhand ${pct(beats['1>0'] / n)} (>=85%), Legend beats Skipper ${pct(beats['3>2'] / n)} (~65%)`);
}

if (import.meta.url === `file://${process.argv[1]}`) skillTable(quick ? 12 : 60);
