// Courses, rounding, starts and whole races: determinism and fuzzing. Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, buildCourse, courseDef, crossingStep, inPolygon, inShoal } from '../game/js/sim/course.js';
import { makeRace, stepRace, SIM_DT, standings, spawnPoint } from '../game/js/sim/race.js';
import { thinkSkippers, botEntries, placeFleet } from '../game/js/sim/skippers.js';
import { WEATHER_IDS } from '../game/js/sim/wind.js';
import { mulberry32 } from '../game/js/sim/rng.js';

test('every course builds, with geometry for every target and a start area clear of land', () => {
  for (const def of COURSES) {
    for (const laps of [1, 2, 3]) {
      const c = buildCourse(def, { laps, fleet: 10, scale: 1 });
      assert.equal(c.targets[0].type, 'start');
      assert.equal(c.targets.at(-1).type, 'finish');
      for (const t of c.targets.slice(1)) {
        assert.ok(Number.isFinite(t.legLen) && t.legLen > 5, `${def.name}: ${t.name} leg ${t.legLen}`);
        if (t.type === 'mark') assert.ok(Number.isFinite(t.rx) && Number.isFinite(t.ry) && ['port', 'starboard'].includes(t.side));
        else assert.ok(Number.isFinite(t.x1) && Number.isFinite(t.fx));
      }
      const race = { course: c, boats: [] };
      for (let s = 0; s < 10; s++) {
        const p = spawnPoint(race, s);
        for (const il of c.islands) assert.ok(!inPolygon(il.poly, p.x, p.y), `${def.name}: spawn ${s} on an island`);
        for (const sh of c.shoals) assert.ok(!inShoal(sh, p.x, p.y), `${def.name}: spawn ${s} on a shoal`);
      }
      for (const t of c.targets) for (const il of c.islands) assert.ok(!inPolygon(il.poly, t.x, t.y), `${def.name}: ${t.name} ashore`);
    }
  }
});

/** Drives a point along a path and sums the rounding steps for a target. */
function walk(t, pts) {
  const state = { side: 0 };
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    for (let k = 1; k <= 20; k++) sum += crossingStep(t, state, ax + ((bx - ax) * k) / 20, ay + ((by - ay) * k) / 20);
  }
  return sum;
}

test('a windward mark counts when left to port, not when left to starboard, and a wrong rounding must be unwound', () => {
  const c = buildCourse(courseDef(1), { laps: 1, fleet: 6 });
  const W = c.targets[1];
  assert.equal(W.side, 'port');
  // Up the right of the mark, over the top to the left, back down: a port rounding.
  assert.equal(walk(W, [[10, W.y + 30], [10, W.y - 8], [-10, W.y - 8], [-10, W.y + 30]]), 1);
  // Up the left and over to the right: the wrong way.
  assert.equal(walk(W, [[-10, W.y + 30], [-10, W.y - 8], [10, W.y - 8], [10, W.y + 30]]), -1);
  // Wrong way, then back the same way: unwound, nothing counted.
  assert.equal(walk(W, [[-10, W.y + 30], [-10, W.y - 8], [10, W.y - 8], [-10, W.y - 8], [-10, W.y + 30]]), 0);
  // Passing far beyond the end of the rounding ray counts for nothing.
  assert.equal(walk(W, [[10, W.y - 80], [-10, W.y - 80]]), 0);
});

test('a boat jostled back and forth across a rounding ray counts it once at most', () => {
  const c = buildCourse(courseDef(1), { laps: 1, fleet: 6 });
  const W = c.targets[1];
  const pts = [[5, W.y - 6]];
  for (let i = 0; i < 40; i++) pts.push([i % 2 ? 0.6 : -0.6, W.y - 6 - i * 0.2]);
  pts.push([-5, W.y - 15]);
  assert.equal(walk(W, pts), 1);
});

test('a gate counts forwards only, and a line crossed backwards needs no unwinding', () => {
  const c = buildCourse(courseDef(1), { laps: 2, fleet: 6 });
  const G = c.targets[2];
  assert.equal(G.type, 'gate');
  assert.equal(walk(G, [[G.x, G.y - 10], [G.x, G.y + 10]]), 1);
  assert.equal(walk(G, [[G.x, G.y + 10], [G.x, G.y - 10]]), -1);
  assert.equal(walk(G, [[G.x + 40, G.y - 10], [G.x + 40, G.y + 10]]), 0); // beside the gate
});

function runBots(seed, courseId, weather, n = 6, rules = 'racing') {
  const entries = botEntries(seed, n, [3, 2, 1, 0, 2, 3, 1, 0, 2, 3].slice(0, n));
  const race = makeRace({ seed, courseId, laps: 2, weather, rules, entries });
  placeFleet(race);
  const log = [];
  while (race.phase !== 'done' && race.t < 1500) {
    thinkSkippers(race);
    stepRace(race, SIM_DT);
    for (const e of race.events) if (e.type === 'finish' || e.type === 'round') log.push(`${e.type}:${e.id}:${race.t.toFixed(4)}`);
    race.events.length = 0;
  }
  return { race, log };
}

test('a race is deterministic: same seed, same fleet, same result to the step', () => {
  const a = runBots(77, 1, 'shifty');
  const b = runBots(77, 1, 'shifty');
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(standings(a.race).map((x) => x.id), standings(b.race).map((x) => x.id));
});

test('fuzz: a boat driven by random input for minutes stays finite, inside the world, its counters bounded', () => {
  const rand = mulberry32(99);
  for (const weather of WEATHER_IDS) {
    const entries = [{ id: 'me', cls: 'skiff', name: 'Me' }, ...botEntries(5, 3, [1, 2, 3])];
    const race = makeRace({ seed: 1234, courseId: 9, laps: 3, weather, rules: 'racing', entries });
    placeFleet(race);
    const me = race.byId.get('me');
    const B = race.course.bounds;
    for (let i = 0; i < 30 * 240; i++) {
      if (i % 7 === 0) {
        me.steer = rand() * 2 - 1;
        me.push = rand() < 0.2;
        me.tackReq = rand() < 0.08;
        me.hikeReq = rand() < 0.5;
      }
      thinkSkippers(race);
      stepRace(race, i % 97 === 0 ? 0.1 : SIM_DT); // the odd long frame
      race.events.length = 0;
      for (const b of race.boats) {
        for (const k of ['x', 'y', 'h', 'v', 'stamina', 'heel']) assert.ok(Number.isFinite(b[k]), `${weather}: ${b.id}.${k}`);
        assert.ok(b.x >= B.x0 - 25.01 && b.x <= B.x1 + 25.01 && b.y >= B.y0 - 25.01 && b.y <= B.y1 + 25.01, `${b.id} left the world`);
        assert.ok(b.v >= 0 && b.v < 20, `${b.id} speed ${b.v}`);
        assert.ok(b.stamina >= 0 && b.stamina <= 1);
        assert.ok(b.pi >= 0 && b.pi <= race.course.targets.length);
      }
      assert.ok(race.contacts.size < 200);
    }
  }
});

test('over the line at the gun: OCS, and no mark counts until the boat comes back below and crosses again', () => {
  const race = makeRace({ seed: 3, courseId: 7, laps: 1, weather: 'classic', rules: 'casual', entries: [{ id: 'me' }], preStart: 2 });
  const me = race.byId.get('me');
  me.x = 0;
  me.y = -3;
  me.h = -Math.PI / 2 - 0.8;
  me.v = 2;
  let ocs = false;
  let cleared = false;
  let started = false;
  for (let i = 0; i < 30 * 40; i++) {
    // Over early, then run back below, then sail up again.
    if (race.t < 2.5) me.steer = 0;
    else if (!cleared) {
      me.aim = Math.PI / 2 + 0.5; // bear away, back down
    } else me.aim = me.x < 0 ? -Math.PI / 2 + 0.85 : -Math.PI / 2 - 0.85; // close-hauled toward the middle
    stepRace(race, SIM_DT);
    for (const e of race.events) {
      if (e.type === 'ocs') ocs = true;
      if (e.type === 'ocsClear') cleared = true;
      if (e.type === 'start') started = true;
      if (e.type === 'round') assert.ok(started, 'a mark counted before a proper start');
    }
    race.events.length = 0;
    if (started) break;
  }
  assert.ok(ocs && cleared && started, `ocs ${ocs} cleared ${cleared} started ${started}`);
});

test('two boats finishing in the same step get a stable order', () => {
  const race = makeRace({ seed: 9, courseId: 7, laps: 1, weather: 'classic', entries: [{ id: 'b' }, { id: 'a' }] });
  for (const [id, ft] of [['b', 100], ['a', 100]]) {
    const x = race.byId.get(id);
    x.finished = true;
    x.finishT = ft;
  }
  race.byId.get('b').place = 1;
  race.byId.get('a').place = 2;
  assert.deepEqual(standings(race).map((x) => x.id), ['b', 'a']);
});
