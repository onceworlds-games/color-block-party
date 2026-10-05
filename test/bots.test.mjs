import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT, newBrain, think } from '../game/bots.js';
import { COLS, ROWS, TILES, makeFloor, reactMs, tileDist } from '../game/rules.js';
import { DT, newChar, newFloor, onFloor, separate, stepChar } from '../game/sim.js';
import { makeRng } from '../game/rng.js';

function setup(seed, step = 3, n = 6) {
  const rng = makeRng(seed);
  const f = makeFloor(seed, step, n);
  const chars = Array.from({ length: n }, (_, i) => {
    const c = newChar(0.6 + rng.next() * 10.8, 0.6 + rng.next() * 6.8);
    c.id = `bot${i + 1}`;
    return c;
  });
  const brains = chars.map((_, i) => newBrain(makeRng(seed * 31 + i)));
  const ctx = { phase: 'pre', step, now: 0, ca: 600, colors: f.colors, call: f.call, chars, n };
  return { f, chars, brains, ctx };
}

test('bots only ever ask for legal moves: a stick inside the unit circle, a yes/no push', () => {
  const out = { ix: 0, iy: 0, push: false };
  for (let seed = 1; seed <= 60; seed++) {
    const { f, chars, brains, ctx } = setup(seed, 1 + (seed % 18), 3 + (seed % 6));
    const floor = newFloor();
    for (let tick = 0; tick < 60 * 6; tick++) {
      ctx.now = tick * (1000 / 60);
      ctx.phase = ctx.now < 600 ? 'pre' : ctx.now < 600 + reactMs(ctx.step, 'normal') ? 'call' : 'down';
      floor.voidOn = ctx.phase === 'down';
      floor.stand = f.stand;
      chars.forEach((c, i) => {
        think(brains[i], c, ctx, out);
        assert.ok(Number.isFinite(out.ix) && Number.isFinite(out.iy), 'finite');
        assert.ok(Math.hypot(out.ix, out.iy) <= 1 + 1e-9, 'a legal stick');
        assert.equal(typeof out.push, 'boolean');
        stepChar(c, out.ix, out.iy, out.push, DT, floor);
        if (c.st === 0) separate(c, chars, chars.length, floor, i);
        assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
      });
    }
  }
});

test('a bot runs to the called colour and stands on it', () => {
  let made = 0;
  let total = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { f, chars, brains, ctx } = setup(seed, 2, 1);
    const c = chars[0];
    // only try bots with a called tile within 3 tiles (they have 3.6 s)
    let near = Infinity;
    for (let i = 0; i < TILES; i++) if (f.stand[i]) near = Math.min(near, tileDist(c.x, c.y, i));
    if (near > 3) continue;
    total++;
    const out = { ix: 0, iy: 0, push: false };
    const floor = newFloor();
    for (let tick = 0; tick < 60 * 4; tick++) {
      ctx.now = tick * (1000 / 60);
      ctx.phase = ctx.now < 600 ? 'pre' : 'call';
      think(brains[0], c, ctx, out);
      stepChar(c, out.ix, out.iy, out.push, DT, floor);
    }
    floor.voidOn = true;
    floor.stand = f.stand;
    if (onFloor(floor, c.x, c.y, 0)) made++;
  }
  assert.ok(total > 30);
  assert.ok(made >= total * 0.95, `${made}/${total} stood on the colour`);
});

test('a bot sometimes runs for the wrong colour first, then corrects after about 0.4 s', () => {
  const saved = BOT.oopsEarly;
  BOT.oopsEarly = 1;
  try {
    let oops = 0;
    let corrected = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { f, chars, brains, ctx } = setup(seed, 1, 1);
      const c = chars[0];
      const out = { ix: 0, iy: 0, push: false };
      const floor = newFloor();
      let wrongSeen = false;
      let rightSeen = false;
      for (let tick = 0; tick < 60 * 3; tick++) {
        ctx.now = tick * (1000 / 60);
        ctx.phase = ctx.now < 600 ? 'pre' : 'call';
        think(brains[0], c, ctx, out);
        stepChar(c, out.ix, out.iy, out.push, DT, floor);
        if (c.tgt >= 0 && ctx.phase === 'call') {
          if (f.colors[c.tgt] !== f.call) wrongSeen = true;
          else if (wrongSeen) rightSeen = true;
        }
      }
      if (wrongSeen) oops++;
      if (rightSeen) corrected++;
    }
    assert.ok(oops >= 30, `${oops} oopses`);
    assert.equal(corrected, oops, 'every oops was corrected');
  } finally {
    BOT.oopsEarly = saved;
  }
});

test('a bot shoves someone standing on its tile, sometimes', () => {
  let shoves = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { f, chars, brains, ctx } = setup(seed, 14, 2);
    const [a, other] = chars;
    const tile = f.stand.indexOf(1);
    other.x = (tile % COLS) + 0.5;
    other.y = Math.floor(tile / COLS) + 0.5;
    a.x = other.x - 0.7;
    a.y = other.y;
    a.x = Math.min(COLS - 0.4, Math.max(0.4, a.x));
    brains[0].willPush = true;
    const out = { ix: 0, iy: 0, push: false };
    const floor = newFloor();
    for (let tick = 0; tick < 60 * 3; tick++) {
      ctx.now = tick * (1000 / 60);
      ctx.phase = ctx.now < 600 ? 'pre' : 'call';
      think(brains[0], a, ctx, out);
      if (out.push) {
        shoves++;
        break;
      }
      stepChar(a, out.ix, out.iy, false, DT, floor);
      other.x = (tile % COLS) + 0.5;
      other.y = Math.floor(tile / COLS) + 0.5;
    }
  }
  assert.ok(shoves > 0, 'bots do shove');
  void ROWS;
});
