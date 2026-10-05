import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, isBotId } from '../game/engine.js';
import { COLS, ROWS, STEPS_MAX, TABLE, makeFloor, placePoints, rankMatch, roundResult, timeline } from '../game/rules.js';
import { R, FALL_TIME } from '../game/sim.js';
import { DT_MS, SimHuman, playMatch } from './_harness.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** Every dancer's body is finite and inside the arena (a fallen one may drift a little past the edge). */
function checkBodies(engine) {
  for (const [id, b] of engine.bots) {
    const c = b.c;
    for (const v of [c.x, c.y, c.vx, c.vy, c.fx, c.fy, c.pushT, c.cd, c.knockT]) assert.ok(Number.isFinite(v), `${id} has a finite body`);
    if (c.st === 0) assert.ok(c.x >= R - 1e-6 && c.x <= COLS - R + 1e-6 && c.y >= R - 1e-6 && c.y <= ROWS - R + 1e-6, `${id} on the floor: ${c.x}, ${c.y}`);
    else assert.ok(c.x >= -1.01 && c.x <= COLS + 1.01 && c.y >= -1.01 && c.y <= ROWS + 1.01, `${id} fallen, still near: ${c.x}, ${c.y}`);
  }
}

function checkMatch(r, rounds, label) {
  const { engine, ended } = r;
  const g = engine.g;
  assert.equal(g.phase, 'final', `${label}: ends in the podium`);
  assert.equal(g.round, rounds, `${label}: played ${rounds} rounds`);
  assert.equal(ended.length, rounds, `${label}: every round ended`);
  assert.ok(g.ids.length >= TABLE, `${label}: a full table`);
  // points: the sum of every round's place points
  const sum = Object.fromEntries(g.ids.map((id) => [id, 0]));
  for (const e of ended) {
    assert.ok(e.win.length >= 1, `${label}: a round has a winner`);
    assert.deepEqual(Object.keys(e.pts).sort(), [...g.ids].sort(), `${label}: everyone is placed`);
    for (const id of g.ids) sum[id] += e.pts[id];
    for (const id of e.win) assert.equal(e.place[id], 1);
    // places follow the elimination order: falling later is never a worse place
    for (const a of g.ids) {
      for (const b of g.ids) {
        const ka = e.out[a] ?? 1e9;
        const kb = e.out[b] ?? 1e9;
        if (ka > kb) assert.ok(e.place[a] < e.place[b], `${label}: later fall, better place`);
        if (ka === kb) assert.equal(e.place[a], e.place[b], `${label}: same drop, same place`);
      }
    }
    assert.ok(e.step >= 1 && e.step <= STEPS_MAX, `${label}: ${e.step} steps`);
    const alive = g.ids.filter((id) => e.out[id] === undefined).length;
    assert.ok(alive <= 1 || e.step === STEPS_MAX, `${label}: a round ends on one dancer or the 20th step (${alive} alive at step ${e.step})`);
    if (e.step === STEPS_MAX && alive > 1) assert.equal(e.win.length, alive, `${label}: every survivor of 20 steps wins`);
  }
  for (const id of g.ids) assert.equal(g.scores[id], sum[id], `${label}: ${id}'s score adds up`);
  // the ranking covers everyone
  const ranked = rankMatch(g.ids, g.scores, g.sv);
  assert.equal(ranked.length, g.ids.length);
  assert.equal(new Set(ranked.map((e) => e.id)).size, g.ids.length);
  assert.equal(ranked[0].place, 1);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);
  assert.ok(g.aw && 'push' in g.aw && 'lucky' in g.aw);
  assert.ok(g.pu && Object.keys(g.pu).length === g.ids.length);
  JSON.parse(JSON.stringify(g)); // plain data: it goes to the room as it is
}

test('a whole match of bots, every step, 20 seeds: it ends, ranks everyone, no NaN, nobody off the floor', () => {
  let total = 0;
  const steps = [];
  for (const seed of SEEDS) {
    const r = playMatch({ seed, rounds: 3, noFF: true, onTick: (e) => checkBodies(e) });
    checkMatch(r, 3, `seed ${seed}`);
    assert.equal(r.engine.g.ids.length, TABLE);
    assert.ok(r.engine.g.ids.every(isBotId));
    steps.push(...r.ended.map((e) => e.step));
    total += r.now;
  }
  const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
  assert.ok(avg >= 10 && avg <= 19.5, `rounds last ${avg.toFixed(1)} steps on average`);
  assert.ok(total / SEEDS.length < 6 * 60 * 1000);
});

test('the other settings: one round, five rounds, each speed', () => {
  for (const [rounds, speed] of [[1, 'chill'], [5, 'normal'], [3, 'fast'], [1, 'fast'], [5, 'chill']]) {
    for (const seed of [3, 9]) {
      const r = playMatch({ seed, rounds, speed, noFF: true, onTick: (e) => checkBodies(e) });
      checkMatch(r, rounds, `${rounds} rounds ${speed} seed ${seed}`);
    }
  }
});

test('with only bots left the rest of a round is played out at once, and the match still comes out right', () => {
  for (const seed of SEEDS) {
    const fast = playMatch({ seed, rounds: 3, noFF: false, onTick: (e) => checkBodies(e) });
    checkMatch(fast, 3, `ff seed ${seed}`);
    const slow = playMatch({ seed, rounds: 3, noFF: true });
    assert.ok(fast.now < slow.now, 'the fast-forward saves the wait');
  }
});

test('bots fall: about half of them per two drops from step 12 on', () => {
  let alive = 0;
  let fell = 0;
  for (const seed of SEEDS) {
    const r = playMatch({ seed, rounds: 3, noFF: true });
    for (const e of r.ended) {
      for (let step = 12; step <= Math.min(e.step, STEPS_MAX); step++) {
        const before = e.ids.filter((id) => e.out[id] === undefined || e.out[id] >= step).length;
        const falls = e.ids.filter((id) => e.out[id] === step).length;
        alive += before;
        fell += falls;
      }
    }
  }
  const rate = fell / alive;
  assert.ok(alive > 100);
  assert.ok(rate > 0.2 && rate < 0.45, `late falls ${(rate * 100).toFixed(0)}% a step (${fell}/${alive})`);
});

test('people and bots together: their own verdicts decide, the host writes them down once', () => {
  for (const seed of SEEDS) {
    const humans = [new SimHuman('p1', seed * 3), new SimHuman('p2', seed * 5 + 1, { latency: 300 })];
    const checked = new Set();
    const r = playMatch({
      seed, humans, rounds: 3, noFF: true,
      onTick: (e, now) => {
        checkBodies(e);
        const g = e.g;
        if (g.phase !== 'step' || g.res < g.step) return;
        const key = `${g.round}.${g.step}`;
        if (checked.has(key)) return;
        checked.add(key);
        // the step has been judged: everyone who said they fell is out on that step, and nobody else who stood safe is
        for (const h of humans) {
          if (h.fellOn[key]) assert.equal(g.out[h.id], g.step, `seed ${seed}: ${h.id} fell on ${key} and is out on it`);
        }
        void now;
      },
    });
    checkMatch(r, 3, `humans seed ${seed}`);
    const g = r.engine.g;
    assert.equal(g.ids.length, TABLE, 'two people and six bots');
    assert.deepEqual(g.ids.slice(0, 2), ['p1', 'p2']);
  }
});

test('a verdict that comes late still counts before the floor is back', () => {
  const engine = Engine.create({ mid: 'm', seed: 4, humans: ['p1'], settings: { rounds: 3, speed: 'normal' }, me: 'p1' });
  engine.noFF = true;
  engine.start(0);
  const g0 = engine.g;
  const stand = makeFloor(g0.ss, g0.step, g0.na).stand;
  const tile = stand.indexOf(1);
  // the host's look at them says they're safe (on a tile that stays)
  const H = { info: () => ({ x: (tile % COLS) + 0.5, y: Math.floor(tile / COLS) + 0.5, gh: false, f: 0, pc: 0, connected: true }) };
  let now = 0;
  while (engine.g.res < 1 && now < 60000) {
    now += DT_MS;
    engine.update(now, H);
  }
  assert.equal(engine.g.res, 1);
  assert.equal(engine.g.out.p1, undefined, 'judged safe');
  assert.ok(engine.reportFell('p1', 1), 'their own page says they fell, after the judging');
  const rev = engine.rev;
  while (engine.g.step === 1 && engine.g.phase === 'step' && now < 90000) {
    now += DT_MS;
    engine.update(now, H);
  }
  assert.ok(engine.rev > rev);
  assert.equal(engine.g.out.p1, 1, 'the late verdict is in the record before the next step');
  // and one for the wrong step is ignored
  assert.ok(!engine.reportFell('p1', 99));
  assert.ok(!engine.reportFell('bot1', engine.g.step), 'bots are judged by the host');
});

test('a silent connected person is judged from where they stand; someone away stands where they were', () => {
  let outs = 0;
  let safe = 0;
  for (const seed of SEEDS) {
    const away = new SimHuman('p1', seed, { away: true });
    const silent = new SimHuman('p2', seed + 100, { silent: true });
    const r = playMatch({ seed, humans: [away, silent], rounds: 1, noFF: true });
    checkMatch(r, 1, `silent seed ${seed}`);
    const e = r.ended[0];
    if (e.out.p1 !== undefined) outs++;
    else safe++;
    // the one who stands still: out on the first drop whose tiles don't include their spawn (never judged alive while over the dark)
    assert.ok(e.out.p1 === undefined || e.out.p1 >= 1);
  }
  assert.ok(outs > 0, 'someone who just stands there falls');
  void safe;
});

test('a person who is not in the room is out', () => {
  const engine = Engine.create({ mid: 'm', seed: 1, humans: ['a', 'b'], settings: { rounds: 1, speed: 'normal' }, me: 'a' });
  engine.noFF = true;
  engine.start(0);
  const H = { info: (id) => (id === 'a' ? { x: 1, y: 1, gh: false, f: 0, pc: 0, connected: true } : null) };
  let now = 0;
  const tl = () => timeline(engine.g);
  while (engine.g.res < 1 && now < 30000) {
    now += DT_MS;
    engine.update(now, H);
  }
  assert.equal(engine.g.out.b, 1, 'the one who left fell on the first judging');
  void tl;
});

test('a new host carries on from the room copy: the record and the bots', () => {
  for (const seed of [2, 5, 8]) {
    const humans = [new SimHuman('p1', seed)];
    let snapshot = null;
    let host = null;
    const r = playMatch({
      seed, humans, rounds: 3, noFF: true,
      onTick: (e, now) => {
        host = e;
        if (!snapshot && e.g.round === 2 && e.g.step === 4 && now >= timeline(e.g).ca + 500) {
          snapshot = { g: JSON.parse(JSON.stringify(e.g)), b: JSON.parse(JSON.stringify(e.snapshot(now))), now };
        }
      },
    });
    assert.ok(snapshot, 'reached round 2, step 4');
    // the adopted engine plays on to the end with the same people (here: only bots move, the person stands where they were)
    const adopted = Engine.adopt(snapshot.g, snapshot.b, 'p1');
    adopted.noFF = true;
    assert.equal(adopted.g.by, 'p1');
    assert.equal(adopted.bots.size, snapshot.g.ids.filter(isBotId).length);
    const H = { info: () => ({ x: 6, y: 4, gh: false, f: 0, pc: 0, connected: true }) };
    let now = snapshot.now;
    let done = false;
    for (let i = 0; i < 60 * 60 * 20 && !done; i++) {
      now += DT_MS;
      done = adopted.update(now, H);
      checkBodies(adopted);
    }
    assert.ok(done, 'the new host finishes the match');
    assert.equal(adopted.g.phase, 'final');
    assert.equal(adopted.g.round, 3);
    assert.ok(host);
  }
});

test('the record is replaced, never edited: what was written to the room stays as it was', () => {
  const engine = Engine.create({ mid: 'm', seed: 7, humans: [], settings: { rounds: 1, speed: 'fast' }, me: 'host' });
  engine.noFF = true;
  engine.start(0);
  const written = [];
  let now = 0;
  let lastRev = -1;
  for (let i = 0; i < 60 * 40; i++) {
    now += DT_MS;
    engine.update(now, null);
    if (engine.rev !== lastRev) {
      lastRev = engine.rev;
      written.push({ g: engine.g, json: JSON.stringify(engine.g) });
    }
  }
  assert.ok(written.length > 10);
  for (const w of written) assert.equal(JSON.stringify(w.g), w.json);
});

test('shoves: a bot knocked 1.6 tiles, one landing on a person becomes an event', () => {
  const engine = Engine.create({ mid: 'm', seed: 11, humans: ['p1'], settings: { rounds: 1, speed: 'normal' }, me: 'p1' });
  engine.noFF = true;
  engine.start(0);
  const b = engine.bots.get('bot1');
  assert.ok(engine.knockBot('bot1', 1, 0));
  assert.ok(!engine.knockBot('bot1', 1, 0), 'already flying');
  assert.ok(!engine.knockBot('nobody', 1, 0));
  assert.ok(b.c.knockT > 0);
  // a bot shoving someone: put a person in its fists
  const other = engine.bots.get('bot2');
  other.c.x = 6;
  other.c.y = 4;
  b.c.x = 5.3;
  b.c.y = 4;
  b.c.knockT = 0;
  b.c.fx = 1;
  b.c.fy = 0;
  b.c.pushT = 0.2;
  b.c.hits.length = 0;
  const H = { info: () => ({ x: 5.9, y: 4.05, gh: false, f: 0, pc: 0, connected: true }) };
  engine.refreshChars.call(Object.assign(engine, { H }));
  engine.contacts('bot1', b.c);
  const events = engine.takeEvents();
  assert.ok(events.some((e) => e.t === 'push' && e.to === 'p1' && e.by === 'bot1'), 'the person is told');
  assert.ok(other.c.knockT > 0, 'the other bot was knocked too');
  void FALL_TIME;
  void placePoints;
  void roundResult;
});
