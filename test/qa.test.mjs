// Rules and fleet behaviour that the quality pass changed: mark room, a quick return from over the line, sail numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRace, stepRace, SIM_DT } from '../game/js/sim/race.js';
import { thinkSkippers, botEntries, placeFleet } from '../game/js/sim/skippers.js';
import { resolveContacts, MARK_ZONE } from '../game/js/sim/rules.js';
import { raceSetup } from '../game/js/sim/setup.js';
import { shadowFactor } from '../game/js/sim/shadow.js';

/** Two boats side by side at a point, racing rules, the first on port tack and the second on starboard. */
function pair(race, x, y) {
  const [a, b] = race.boats;
  a.x = x - 2;
  a.y = y;
  b.x = x + 2;
  b.y = y;
  a.h = b.h = -Math.PI / 2 - 0.8;
  a.side = -1;
  b.side = 1;
  a.wx = b.wx = 0;
  a.wy = b.wy = 6;
  a.v = b.v = 3;
  return [a, b];
}

const twoBoats = () => makeRace({ seed: 5, courseId: 1, laps: 1, weather: 'moderate', rules: 'racing', entries: [{ id: 'a', cls: 'dinghy' }, { id: 'b', cls: 'dinghy' }] });

test('racing rules: port-starboard contact in open water is a foul, within a mark zone it is only a bump', () => {
  const race = twoBoats();
  const [a] = pair(race, 40, -60);
  const ev = [];
  race.t = 30;
  resolveContacts(race, ev);
  assert.ok(ev.some((e) => e.type === 'foul' && e.id === a.id), 'open water: the port boat pays');
  const race2 = twoBoats();
  const W = race2.course.targets[1];
  pair(race2, W.x + 6, W.y + 5);
  const ev2 = [];
  race2.t = 30;
  resolveContacts(race2, ev2);
  assert.ok(!ev2.some((e) => e.type === 'foul'), 'at the mark: no foul');
  assert.ok(ev2.some((e) => e.type === 'bump'), 'at the mark: a bump');
  assert.ok(MARK_ZONE >= 10);
});

test('a boat that has just touched another is not fouled for the mark it was pushed onto', () => {
  const race = twoBoats();
  const [a] = race.boats;
  const W = race.course.targets[1];
  a.x = W.x + 1.5;
  a.y = W.y + 1;
  a.touchT = race.t - 0.5;
  const ev = [];
  race.events = ev;
  stepRace(race, SIM_DT);
  assert.ok(!ev.some((e) => e.type === 'foul'), 'let off');
  const race2 = twoBoats();
  const [c] = race2.boats;
  const W2 = race2.course.targets[1];
  c.x = W2.x + 1.5;
  c.y = W2.y + 1;
  c.touchT = -99;
  const ev2 = [];
  race2.events = ev2;
  stepRace(race2, SIM_DT);
  assert.ok(ev2.some((e) => e.type === 'foul' && e.other === 'mark'), 'a clean touch is a foul');
});

test('a boat returning over the line is out of everyone\'s way: no push, no foul, no shadow', () => {
  const race = twoBoats();
  const [a, b] = pair(race, 0, 20);
  a.ocs = true;
  const ev = [];
  race.t = 30;
  const xa = a.x;
  resolveContacts(race, ev);
  assert.equal(ev.length, 0);
  assert.equal(a.x, xa);
  // It casts no shadow either.
  b.x = a.x;
  b.y = a.y + 12;
  a.wx = 0;
  a.wy = 6;
  assert.equal(shadowFactor(race, b), 1);
  a.ocs = false;
  assert.ok(shadowFactor(race, b) < 1);
});

test('rival skippers called back at the start are below the line again within 20 s, in crowded starts', () => {
  let called = 0;
  for (let k = 0; k < 14; k++) {
    const seed = 8000 + k;
    const race = makeRace({ seed, courseId: 1, laps: 1, weather: ['moderate', 'fresh', 'light', 'shifty'][k % 4], rules: 'racing', entries: botEntries(seed, 10, [0, 1, 2, 3, 0, 1, 2, 3, 2, 1]), preStart: 60 });
    placeFleet(race);
    const at = {};
    while (race.t < race.gunT + 45) {
      thinkSkippers(race);
      stepRace(race, SIM_DT);
      for (const e of race.events) {
        if (e.type === 'ocs') {
          at[e.id] = race.t;
          called++;
        }
        if (e.type === 'ocsClear') delete at[e.id];
      }
      race.events.length = 0;
      for (const [id, t0] of Object.entries(at)) assert.ok(race.t - t0 < 20, `${id} still over the line ${(race.t - t0).toFixed(0)} s after the gun (seed ${seed})`);
    }
  }
  assert.ok(called > 0, 'the check saw some');
});

test('every human has a sail number of their own, steady from race to race, and never twice in a fleet', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `player-${i}-${'x'.repeat(i)}`);
  const a = raceSetup({ fleet: 'ten' }, 111, ids, {});
  const b = raceSetup({ fleet: 'ten' }, 999, ids, {});
  const nums = a.entries.map((e) => e.num);
  assert.equal(new Set(nums).size, nums.length, `numbers ${nums}`);
  for (const id of ids) assert.equal(a.entries.find((e) => e.id === id).num, b.entries.find((e) => e.id === id).num);
  // The number the page sends (a stale 7 from every player) is ignored.
  const c = raceSetup({ fleet: 'six' }, 5, ['a', 'b', 'c'], { a: { num: 7 }, b: { num: 7 }, c: { num: 7 } });
  assert.equal(new Set(c.entries.slice(0, 3).map((e) => e.num)).size, 3);
});

test('a veer lifts the starboard tack and heads the port tack, and the helm cue and the skippers agree', async () => {
  const { headingFor } = await import('../game/js/sim/boat.js');
  const { makeLift, updateLift } = await import('../game/js/hints.js');
  const DEG = Math.PI / 180;
  const north = (h) => -Math.sin(h); // toward a mark straight upwind
  const vmg = (shiftDeg, side) => {
    const dir = Math.PI / 2 + shiftDeg * DEG; // windAt: a positive shift is a veer
    return north(headingFor(Math.cos(dir) * 6, Math.sin(dir) * 6, 47, side));
  };
  assert.ok(vmg(10, 1) > vmg(0, 1) && vmg(10, -1) < vmg(0, -1), 'a veer: starboard gains, port loses');
  assert.ok(vmg(-10, -1) > vmg(0, -1) && vmg(-10, 1) < vmg(0, 1), 'a back: port gains, starboard loses');
  // The cue: settle on the mean, then veer 10 degrees for a while.
  for (const [side, sign] of [[1, 1], [-1, -1]]) {
    const L = makeLift();
    for (let i = 0; i < 600; i++) updateLift(L, 0, side, 1 / 30);
    for (let i = 0; i < 150; i++) updateLift(L, 10 * DEG, side, 1 / 30);
    assert.ok(Math.sign(L.deg) === sign && Math.abs(L.deg) > 5, `side ${side}: ${L.deg}`);
  }
  // Headed for long enough (the hint's timer) on port when it veers.
  const L = makeLift();
  for (let i = 0; i < 600; i++) updateLift(L, 0, -1, 1 / 30);
  for (let i = 0; i < 300; i++) updateLift(L, 12 * DEG, -1, 1 / 30);
  assert.ok(L.headedT > 3, `headed for ${L.headedT} s`);
});
