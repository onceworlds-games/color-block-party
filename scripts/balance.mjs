// The balance harness: headless races of rival-skipper fleets over every course and weather, on the same pure
// simulation the game runs, and the boat-handling numbers. Prints the table the design is tuned against.
//   node scripts/balance.mjs            (the full table, a minute or two)
//   node scripts/balance.mjs quick      (fewer races)
//   node scripts/balance.mjs skills|courses|classes|starts|boats   (one section)
import { makeRace, stepRace, SIM_DT, standings } from '../game/js/sim/race.js';
import { thinkSkippers, botEntries, SKILLS, placeFleet, makeBrain } from '../game/js/sim/skippers.js';
import { trialSeed } from '../game/js/sim/setup.js';
import { COURSES } from '../game/js/sim/course.js';
import { WEATHER_IDS, windAt, windSample } from '../game/js/sim/wind.js';
import { CLASSES, CLASS_IDS, bestVmgAngle, targetSpeed, KN, DEG } from '../game/js/sim/polar.js';
import { makeBoat, stepBoat } from '../game/js/sim/boat.js';
import { coneStrength } from '../game/js/sim/shadow.js';
import { PARS } from '../game/js/progress.js';

const args = process.argv.slice(2);
const quick = args.includes('quick');
const only = args.filter((a) => a !== 'quick');
const want = (k) => !only.length || only.includes(k);

/** Runs one race to the end (the finish stays open for the slowest); returns the race and its standings. */
export function runRace({ seed, courseId, weather, laps = 2, skills, rules = 'racing', classes, preStart = 60, closeAfter = Infinity, onStep }) {
  const entries = botEntries(seed, skills.length, skills, (i) => (classes ? classes[i] : 'dinghy'));
  const race = makeRace({ seed, courseId, laps, weather, rules, entries, preStart, closeAfter });
  placeFleet(race);
  race.hardLimit = Infinity; // here the question is whether a skipper gets stuck, not how long the officer waits
  let guard = 0;
  while (race.phase !== 'done' && guard++ < 30 * 2400) {
    thinkSkippers(race);
    stepRace(race, SIM_DT);
    race.events.length = 0;
    if (onStep) onStep(race);
  }
  return { race, order: standings(race) };
}

const pct = (x) => `${(100 * x).toFixed(0)}%`;
const mmss = (s) => {
  if (!Number.isFinite(s)) return '-';
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
};
const avg = (l) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : NaN);

// ------------------------------------------------------------------------------------------------ skills

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
  const sk = avg(rows[2].times);
  console.log(`\nSKILLS: Pilot Bank, Classic 12 kn, 2 laps (${n} races of 8 boats)`);
  console.log('skill     time    vs Skipper  start   OCS/race  fouls  tacks  DNF');
  rows.forEach((r, i) => {
    const t = avg(r.times);
    console.log(`${SKILLS[i].name.padEnd(9)} ${mmss(t).padEnd(7)} ${(((t - sk) / sk) * 100).toFixed(1).padStart(6)}%    ${avg(r.starts).toFixed(1).padStart(5)}s  ${(r.ocs / r.n).toFixed(2).padStart(6)}   ${(r.fouls / r.n).toFixed(2).padStart(5)}  ${(r.tacks / r.n).toFixed(1).padStart(5)}  ${r.dnf}`);
  });
  console.log('targets: Skipper 4:30 +-0:45; Mate +12-18%; Deckhand +30-40%');
  console.log(`Skipper beats Mate ${pct(beats['2>1'] / n)} (target >=80%), Mate beats Deckhand ${pct(beats['1>0'] / n)} (>=85%), Legend beats Skipper ${pct(beats['3>2'] / n)} (~65%)`);
  return { mate: (avg(rows[1].times) - sk) / sk, deck: (avg(rows[0].times) - sk) / sk };
}

// ------------------------------------------------------------------------------------------------ courses x weathers

function courseTable(n) {
  // Every course in every weather: does every bot finish (no grounding loops, no stuck boats)?
  console.log(`\nCOURSES x WEATHERS: one race each of 8 bots (two of each skill), finish open to the last boat${n > 1 ? `, ${n} seeds` : ''}`);
  console.log(`course               ${WEATHER_IDS.map((w) => w.padEnd(13)).join('')} par   Skipper`);
  let bad = 0;
  const skipperTimes = {};
  for (const def of COURSES) {
    const cells = [];
    for (const weather of WEATHER_IDS) {
      let fin = 0;
      let all = 0;
      let grounds = 0;
      const win = [];
      for (let k = 0; k < n; k++) {
        const { order } = runRace({ seed: 300 + def.id * 17 + k * 101, courseId: def.id, weather, laps: def.lapped ? 2 : 1, skills: [0, 1, 2, 3, 0, 1, 2, 3] });
        all += order.length;
        fin += order.filter((b) => b.finished).length;
        grounds += order.reduce((a, b) => a + b.stats.grounds, 0);
        if (order[0]?.finished) win.push(order[0].finishT);
      }
      if (fin < all) bad++;
      cells.push(`${fin === all ? 'ok' : `${fin}/${all}`} ${mmss(avg(win))}${grounds ? ` g${grounds}` : ''}`.padEnd(13));
    }
    skipperTimes[def.id] = trialPar(def);
    console.log(`${String(def.id).padStart(2)} ${def.name.padEnd(17)} ${cells.join('')} ${mmss(PARS[def.id])}  ${mmss(skipperTimes[def.id])}`);
  }
  console.log(`(cell: finished/boats, the winner's time, g = groundings; par: progress.js, Skipper: the measured par). ${bad ? `${bad} cells with a boat that did not finish` : 'Every bot finished everywhere.'}`);
  console.log(`measured pars: ${JSON.stringify(skipperTimes)}`);
  return skipperTimes;
}

/** The time trial's par: a Skipper of each personality alone in the trial's own conditions; the mean, in seconds. */
function trialPar(def) {
  const times = [];
  for (const persona of ['textbook', 'aggressive', 'cautious', 'gambler']) {
    const seed = trialSeed(def.id);
    const race = makeRace({ seed, courseId: def.id, laps: def.lapped ? 2 : 1, weather: 'classic', rules: 'casual', trial: true, preStart: 30, entries: [{ id: 'par', name: 'Par', cls: 'dinghy', bot: { skill: 2, persona, trim: 1, brain: makeBrain(seed + 3, 2, persona) } }] });
    placeFleet(race);
    while (race.phase !== 'done') {
      thinkSkippers(race);
      stepRace(race, SIM_DT);
      race.events.length = 0;
    }
    if (race.boats[0].finished) times.push(race.boats[0].finishT);
  }
  return Math.round(avg(times));
}

// ------------------------------------------------------------------------------------------------ classes

const HOMES = [
  { label: 'light (Catboat)', cls: 'catboat', courseId: 1, weather: 'light', laps: 2 },
  { label: 'fresh (Skiff)', cls: 'skiff', courseId: 1, weather: 'fresh', laps: 2 },
  { label: 'shifty (Dinghy)', cls: 'dinghy', courseId: 1, weather: 'shifty', laps: 2 },
  { label: 'reaches (Catamaran)', cls: 'cat', courseId: 2, weather: 'moderate', laps: 2 },
];

function classTable(n) {
  console.log(`\nCLASSES: mixed fleets of 8 (two of each class, all Skippers), ${n} races per condition: share of wins`);
  console.log(`condition              ${CLASS_IDS.map((c) => CLASSES[c].name.padEnd(11)).join('')}`);
  const out = {};
  for (const h of HOMES) {
    const wins = Object.fromEntries(CLASS_IDS.map((c) => [c, 0]));
    for (let k = 0; k < n; k++) {
      const classes = ['dinghy', 'skiff', 'catboat', 'cat', 'dinghy', 'skiff', 'catboat', 'cat'];
      // Rotate who starts where, so no class always gets the same slot.
      const rot = classes.map((_, i) => classes[(i + k) % classes.length]);
      // Two interleaved seed sets, so a lucky run of seeds doesn't pass for a result.
      const { order } = runRace({ seed: 5000 + (k % 2) * 4000 + (k >> 1) * 13 + h.courseId, courseId: h.courseId, weather: h.weather, laps: h.laps, skills: [2, 2, 2, 2, 2, 2, 2, 2], classes: rot });
      if (order[0]?.finished) wins[order[0].cls]++;
    }
    out[h.cls] = wins;
    console.log(`${h.label.padEnd(22)} ${CLASS_IDS.map((c) => `${pct(wins[c] / n)}${c === h.cls ? '*' : ''}`.padEnd(11)).join('')}`);
  }
  console.log("targets: the home class (*) wins 35-45%, each class <=20% in the others' home conditions");
  return out;
}

// ------------------------------------------------------------------------------------------------ starts

function startTable(n) {
  // Which half of the line did the boat leading 20 s after the gun start from, and was it the favoured (upwind) end?
  let counted = 0;
  let fav = 0;
  let mid = 0;
  const W = windSample();
  for (let k = 0; k < n; k++) {
    const crossX = new Map();
    let leader = null;
    let favoured = 0;
    const { race } = runRace({
      seed: 7000 + k,
      courseId: 1,
      weather: k % 2 ? 'shifty' : 'moderate',
      laps: 1,
      skills: [2, 3, 2, 3, 2, 3, 2, 3],
      onStep: (r) => {
        if (Math.abs(r.t - r.gunT) < SIM_DT / 2) {
          windAt(r.wind, 0, 0, r.t, W);
          // Upwind is against the air's velocity; the end further upwind is favoured.
          const ux = -W.vx / (W.ms || 1);
          favoured = Math.abs(W.shift) >= 4 * DEG ? Math.sign(ux) : 0;
        }
        for (const b of r.boats) if (b.startT !== null && !crossX.has(b.id)) crossX.set(b.id, b.x);
        if (leader === null && r.t >= r.gunT + 20) leader = standings(r)[0]; // the leader: least distance to go
        if (leader && r.t > r.gunT + 21) r.phase = 'done';
      },
    });
    if (!favoured || !leader || !crossX.has(leader.id)) continue;
    counted++;
    const x = crossX.get(leader.id);
    if (Math.abs(x) < race.course.halfLine / 3) mid++;
    if (Math.sign(x) === favoured) fav++;
  }
  console.log(`\nSTARTS: ${counted} races with a favoured end (bias >= 4 degrees): the leader 20 s after the gun started in the favoured half ${pct(fav / Math.max(1, counted))} (target >=55%; from the middle third ${pct(mid / Math.max(1, counted))})`);
  return fav / Math.max(1, counted);
}

// ------------------------------------------------------------------------------------------------ boat handling

function sailBoat(clsId, kn, steps, onStep) {
  const b = makeBoat('a', clsId, 0, 0, -Math.PI / 2 - 47 * DEG);
  const wind = { vx: 0, vy: kn * KN, kn };
  const cur = { vx: 0, vy: 0 };
  let t = 0;
  for (let i = 0; i < steps; i++) {
    t += SIM_DT;
    onStep(b, t);
    stepBoat(b, wind, cur, t, SIM_DT);
  }
  return b;
}

function boatTable() {
  console.log('\nBOATS (12 kn unless noted)');
  for (const kn of [10, 12, 14]) {
    const row = CLASS_IDS.map((c) => `${CLASSES[c].name} ${bestVmgAngle(CLASSES[c], kn, true).angle.toFixed(1)}/${bestVmgAngle(CLASSES[c], kn, false).angle.toFixed(1)}`);
    console.log(`best VMG angles up/down at ${kn} kn: ${row.join(', ')}   (target Dinghy 44-48 / 148-152)`);
  }
  const sh = [3, 4, 5].map((L) => {
    const s = coneStrength(0, 0, 0, 1, 0, L * 4.5);
    return `${L} lengths ${pct(1 - targetSpeed(CLASSES.dinghy, 47, 12 * (1 - s), false) / targetSpeed(CLASSES.dinghy, 47, 12, false))}`;
  });
  console.log(`speed lost straight downwind of a sail: ${sh.join(', ')}   (target 15-35%)`);
  for (const clsId of CLASS_IDS) {
    let entry = 0;
    let exitV = null;
    let end = null;
    let rec = null;
    let v0 = 0;
    let messyExit = null;
    sailBoat(clsId, 12, 30 * 40, (b, t) => {
      if (t > 15 && t < 15 + SIM_DT) {
        entry = b.v;
        b.tackReq = true;
      }
      if (t > 15.2 && !b.man && end === null) {
        end = t;
        exitV = b.v;
      }
      if (end !== null && rec === null && b.v >= 0.92 * b.target) rec = t - end;
      if (t > 25 && t < 25 + SIM_DT) b.tackReq = true;
      if (t > 27 && t < 27 + SIM_DT) {
        v0 = b.v;
        b.tackReq = true;
      }
      if (t > 27.2 && !b.man && messyExit === null && v0) messyExit = b.v;
    });
    console.log(`${CLASSES[clsId].name.padEnd(10)} clean tack loses ${pct(1 - exitV / entry)}, back to speed in ${rec?.toFixed(1)} s; a tack straight after another loses ${pct(1 - messyExit / v0)}   (targets <=25% in <=3 s; messy ~45%)`);
  }
  let out = null;
  sailBoat('dinghy', 12, 30 * 40, (b, t) => {
    if (t > 10 && t < 14) {
      b.push = true;
      b.steer = b.side;
    } else if (t >= 14 && t < 20) {
      b.push = false;
      b.steer = -b.side;
    } else b.steer = 0;
    if (t >= 14 && out === null && !b.irons && b.v >= 0.4 * b.target && b.target > 0) out = t;
  });
  console.log(`in irons, then bearing away: sailing again in ${(out - 14).toFixed(1)} s   (target <=4 s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  if (want('boats')) boatTable();
  if (want('skills')) skillTable(quick ? 12 : 60);
  if (want('classes')) classTable(quick ? 48 : 160);
  if (want('starts')) startTable(quick ? 60 : 160);
  if (want('courses')) courseTable(1);
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
