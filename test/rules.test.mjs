import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS, COLS, ROWS, TILES, STEPS_MAX, PLACE_POINTS, SPEEDS, BOT_NAMES,
  botNames, calledFraction, calledMin, chooseStepSeed, computeAwards, fellCode, makeFloor, ordinal, placePoints, rankMatch,
  reachFor, reactMs, roundResult, roundSpawns, tileDist, timeline, worstDistance,
} from '../game/rules.js';
import { hash32, makeRng, strSeed } from '../game/rng.js';

test('the floor is 12 x 8 with six colours', () => {
  assert.equal(COLS * ROWS, TILES);
  assert.equal(TILES, 96);
  assert.equal(COLORS.length, 6);
  assert.deepEqual(COLORS.map((c) => c.symbol), ['heart', 'star', 'clover', 'circle', 'diamond', 'triangle']);
});

test('reaction time shrinks 7% a step down to the floor, for each speed', () => {
  assert.equal(reactMs(1, 'normal'), 3600);
  assert.equal(reactMs(2, 'normal'), Math.round(3600 * 0.93));
  assert.equal(reactMs(30, 'normal'), 1400);
  assert.equal(reactMs(1, 'chill'), 4400);
  assert.equal(reactMs(30, 'chill'), 1800);
  assert.equal(reactMs(1, 'fast'), 2800);
  assert.equal(reactMs(30, 'fast'), 1100);
  for (const speed of Object.keys(SPEEDS)) {
    let prev = Infinity;
    for (let step = 1; step <= STEPS_MAX; step++) {
      const r = reactMs(step, speed);
      assert.ok(r <= prev && r >= SPEEDS[speed].min);
      prev = r;
    }
  }
});

test('the called share falls from 22% to 6% by step 15', () => {
  assert.ok(Math.abs(calledFraction(1) - 0.22) < 1e-9);
  assert.ok(Math.abs(calledFraction(15) - 0.06) < 1e-9);
  assert.ok(Math.abs(calledFraction(40) - 0.06) < 1e-9);
  assert.equal(calledMin(2), 3);
  assert.equal(calledMin(8), 4);
  assert.equal(calledMin(12), 6);
});

test('the timeline of a step', () => {
  const g = { fa: 1000, ca: 1600, step: 1, speed: 'normal' };
  const tl = timeline(g);
  assert.equal(tl.da, 1600 + 3600);
  assert.equal(tl.ea, tl.da + 1000);
});

test('every generated floor is valid: every colour in patches, the called one in range, the rest filled', () => {
  for (let seed = 1; seed <= 400; seed++) {
    for (const step of [1, 3, 6, 10, 15, 20]) {
      for (const alive of [2, 5, 8, 12]) {
        const f = makeFloor(seed * 7919 + step, step, alive);
        assert.equal(f.colors.length, TILES);
        let called = 0;
        const counts = new Array(6).fill(0);
        for (let i = 0; i < TILES; i++) {
          assert.ok(f.colors[i] >= 0 && f.colors[i] < 6, 'every tile has a colour');
          counts[f.colors[i]]++;
          assert.equal(f.stand[i], f.colors[i] === f.call ? 1 : 0);
          if (f.stand[i]) called++;
        }
        assert.equal(called, f.count);
        const want = Math.min(40, Math.max(Math.round(calledFraction(step) * TILES), calledMin(alive)));
        assert.equal(called, want);
        assert.ok(called >= Math.max(3, alive / 2), 'at least max(3, alive/2) called tiles');
        for (let c = 0; c < 6; c++) if (c !== f.call) assert.ok(counts[c] >= 4, `colour ${c} appears (${counts[c]})`);
      }
    }
  }
});

test('the called colour is in several patches early, with single tiles from step 6', () => {
  const patches = (f) => {
    const seen = new Uint8Array(TILES);
    const sizes = [];
    for (let i = 0; i < TILES; i++) {
      if (!f.stand[i] || seen[i]) continue;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        size++;
        for (const n of [c - 1, c + 1, c - COLS, c + COLS]) {
          if (n < 0 || n >= TILES || seen[n] || !f.stand[n]) continue;
          if ((n % COLS === 0 && c % COLS === COLS - 1) || (c % COLS === 0 && n % COLS === COLS - 1)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      sizes.push(size);
    }
    return sizes;
  };
  let early = 0;
  let lateSingles = 0;
  for (let seed = 1; seed <= 200; seed++) {
    if (patches(makeFloor(seed, 1, 8)).length >= 3) early++;
    lateSingles += patches(makeFloor(seed, 12, 8)).filter((n) => n === 1).length;
  }
  assert.ok(early >= 160, `most early floors have several patches (${early}/200)`);
  assert.ok(lateSingles >= 100, `late floors have single tiles (${lateSingles})`);
});

test('the same seed makes the same floor on every page', () => {
  const a = makeFloor(12345, 7, 6);
  const b = makeFloor(12345, 7, 6);
  assert.deepEqual([...a.colors], [...b.colors]);
  assert.equal(a.call, b.call);
});

test('the host picks a floor everyone can reach in time, whenever one exists', () => {
  const rng = makeRng(99);
  for (let n = 0; n < 200; n++) {
    const step = 1 + rng.int(20);
    const alive = 2 + rng.int(7);
    const react = reactMs(step, 'normal');
    const positions = Array.from({ length: alive }, () => ({ x: 0.5 + rng.next() * 11, y: 0.5 + rng.next() * 7 }));
    const seed = chooseStepSeed(hash32(5, n), step, alive, positions, react);
    const f = makeFloor(seed, step, alive);
    const worst = worstDistance(f, positions);
    assert.ok(worst <= reachFor(react) + 1e-9 || worst < 6, `worst ${worst} within reach ${reachFor(react)} (or best effort)`);
    if (step <= 8) assert.ok(worst <= reachFor(react), 'early steps are always reachable');
  }
});

test('tile distance is zero over a tile', () => {
  assert.equal(tileDist(3.5, 2.5, 2 * COLS + 3), 0);
  assert.ok(Math.abs(tileDist(5.5, 2.5, 2 * COLS + 3) - 1.5) < 1e-9);
});

test('spawns are spread over the floor, one per dancer', () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const n of [1, 2, 8, 12]) {
      const sp = roundSpawns(seed * 31, 1 + (seed % 5), n);
      assert.equal(sp.length, n);
      let minD = Infinity;
      for (let i = 0; i < n; i++) {
        assert.ok(sp[i].x > 0 && sp[i].x < COLS && sp[i].y > 0 && sp[i].y < ROWS);
        for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(sp[i].x - sp[j].x, sp[i].y - sp[j].y));
      }
      if (n <= 8) assert.ok(minD >= 1.9, `dancers start apart (${minD})`);
      else assert.ok(minD >= 1.0);
    }
  }
});

test('points by place, ties share the better place', () => {
  assert.deepEqual(PLACE_POINTS, [10, 7, 5, 4, 3, 2]);
  assert.equal(placePoints(1), 10);
  assert.equal(placePoints(6), 2);
  assert.equal(placePoints(7), 1);
  assert.equal(placePoints(12), 1);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  // e fell first (step 2), c and d together (step 5), b last (step 9), a still standing
  const r = roundResult(ids, { e: 2, c: 5, d: 5, b: 9 });
  assert.deepEqual(r.winners, ['a']);
  assert.deepEqual(r.place, { a: 1, b: 2, c: 3, d: 3, e: 5 });
  assert.deepEqual(r.pts, { a: 10, b: 7, c: 5, d: 5, e: 3 });
});

test('everyone left falling together share the top place', () => {
  const r = roundResult(['a', 'b', 'c', 'd'], { a: 3, b: 7, c: 7, d: 7 });
  assert.deepEqual(r.winners.sort(), ['b', 'c', 'd']);
  assert.equal(r.pts.b, 10);
  assert.equal(r.pts.c, 10);
  assert.equal(r.place.a, 4);
  assert.equal(r.pts.a, 4);
});

test('survivors of the 20th step all win', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const r = roundResult(ids, { g: 4, h: 4 });
  assert.equal(r.winners.length, 6);
  assert.ok(ids.slice(0, 6).every((id) => r.pts[id] === 10));
  assert.equal(r.place.g, 7);
  assert.equal(r.pts.g, 1);
});

test('the match ranking: points, then steps survived, then roster order; ties share a place', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const list = rankMatch(ids, { a: 20, b: 20, c: 14, d: 14 }, { a: 10, b: 30, c: 8, d: 8 });
  assert.deepEqual(list.map((e) => e.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(list.map((e) => e.place), [1, 2, 3, 3]);
});

test('the awards', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(computeAwards(order, { a: 1, b: 4, c: 4 }, { a: 9, b: 3, c: 12 }), { push: 'b', lucky: 'c' });
  assert.deepEqual(computeAwards(order, {}, {}), { push: null, lucky: null });
});

test('bot names are distinct and from the list', () => {
  for (let seed = 0; seed < 50; seed++) {
    const names = botNames(seed, 7);
    assert.equal(new Set(names).size, 7);
    assert.ok(names.every((n) => BOT_NAMES.includes(n)));
  }
  assert.deepEqual(botNames(5, 4), botNames(5, 4));
});

test('fall codes and ordinals', () => {
  assert.equal(fellCode(2, 13), 2013);
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(21), '21st');
});

test('seeds are stable', () => {
  assert.equal(strSeed('abc'), strSeed('abc'));
  assert.notEqual(strSeed('abc'), strSeed('abd'));
  const r1 = makeRng(7);
  const r2 = makeRng(7);
  for (let i = 0; i < 20; i++) assert.equal(r1.next(), r2.next());
});
