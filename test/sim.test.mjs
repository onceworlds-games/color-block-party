// The pure simulation: polar, wind, boats, shadows, rules. Run with `npm test` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, CLASS_IDS, bestVmgAngle, targetSpeed, polarAt, DEG, KN } from '../game/js/sim/polar.js';
import { makeWind, windAt, windSample, WEATHER_IDS, PRESETS } from '../game/js/sim/wind.js';
import { makeBoat, stepBoat, readWind, angDiff } from '../game/js/sim/boat.js';
import { coneStrength, SHADOW } from '../game/js/sim/shadow.js';
import { giveWay } from '../game/js/sim/rules.js';
import { hash32, mulberry32 } from '../game/js/sim/rng.js';

const AREA = { x0: -150, y0: -250, x1: 150, y1: 80 };

test('the dinghy polar peaks at 44-48 degrees upwind and 148-152 downwind (10-14 kn)', () => {
  for (const kn of [10, 12, 14]) {
    const up = bestVmgAngle(CLASSES.dinghy, kn, true);
    const down = bestVmgAngle(CLASSES.dinghy, kn, false);
    assert.ok(up.angle >= 44 && up.angle <= 48, `upwind ${up.angle} at ${kn} kn`);
    assert.ok(down.angle >= 148 && down.angle <= 152, `downwind ${down.angle} at ${kn} kn`);
  }
});

test('every class has a finite, non-negative polar and nothing inside its no-go zone', () => {
  for (const id of CLASS_IDS) {
    const cls = CLASSES[id];
    for (let a = 0; a <= 180; a += 0.5) {
      const p = polarAt(id, a);
      assert.ok(Number.isFinite(p) && p >= 0, `${id} ${a}`);
      if (a < cls.nogo - 0.5) assert.equal(p, 0, `${id} sails at ${a}`);
    }
    for (const kn of [0, 3, 8, 12, 18, 25, 60]) assert.ok(Number.isFinite(targetSpeed(cls, 90, kn, false)));
  }
});

test('speed saturates: doubling the wind gives less than double the speed', () => {
  const s8 = targetSpeed(CLASSES.dinghy, 90, 8, false);
  const s16 = targetSpeed(CLASSES.dinghy, 90, 16, false);
  assert.ok(s16 < 2 * s8 && s16 > s8);
});

test('the wind is a pure function of seed and time', () => {
  const a = makeWind(123, 'shifty', AREA, 300);
  const b = makeWind(123, 'shifty', AREA, 300);
  const sa = windSample();
  const sb = windSample();
  for (let i = 0; i < 200; i++) {
    const x = -120 + (i * 37) % 240;
    const y = -230 + (i * 53) % 300;
    const t = i * 1.7;
    windAt(a, x, y, t, sa);
    windAt(b, x, y, t, sb);
    assert.equal(sa.vx, sb.vx);
    assert.equal(sa.vy, sb.vy);
  }
  const c = makeWind(124, 'shifty', AREA, 300);
  windAt(c, 0, 0, 50, sb);
  windAt(a, 0, 0, 50, sa);
  assert.notEqual(sa.vx, sb.vx);
});

test('every weather stays within its ranges everywhere, with no NaN', () => {
  for (const id of [...WEATHER_IDS, 'classic']) {
    for (let seed = 1; seed <= 20; seed++) {
      const w = makeWind(seed * 7919, id, AREA, 300);
      const p = PRESETS[id];
      assert.ok(w.baseKn >= p.kn[0] - 1e-9 && w.baseKn <= p.kn[1] + 1e-9);
      const s = windSample();
      for (let i = 0; i < 300; i++) {
        windAt(w, -150 + ((i * 41) % 300), -250 + ((i * 29) % 330), i * 1.3, s);
        assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy) && Number.isFinite(s.kn));
        // Never backwards: the wind always blows broadly down the course (shifts are offsets, not a spin).
        assert.ok(s.vy > 0, `${id} seed ${seed} blows upwind`);
        const maxMul = id === 'squall' ? 3.2 : 1.9;
        assert.ok(s.kn <= w.baseKn * maxMul && s.kn >= 0.05 * w.baseKn, `${id} ${s.kn} vs ${w.baseKn}`);
      }
    }
  }
});

function sailBoat(clsId, { kn = 12, steps = 300, onStep } = {}) {
  const b = makeBoat('a', clsId, 0, 0, -Math.PI / 2 - 47 * DEG);
  const wind = { vx: 0, vy: kn * KN, kn };
  const cur = { vx: 0, vy: 0 };
  let t = 0;
  for (let i = 0; i < steps; i++) {
    t += 1 / 30;
    if (onStep) onStep(b, t, i);
    stepBoat(b, wind, cur, t, 1 / 30);
  }
  return { b, t, wind };
}

test('a clean tack loses no more than a quarter of the speed and recovers within 3 s', () => {
  let entry = 0;
  let exitV = 0;
  let recovered = null;
  let tackEnd = null;
  sailBoat('dinghy', {
    steps: 30 * 30,
    onStep: (b, t) => {
      if (Math.abs(t - 15) < 1e-6 || (t > 15 && t < 15 + 1 / 30)) {
        entry = b.v;
        b.tackReq = true;
      }
      if (b.man) tackEnd = null;
      if (!b.man && t > 15.2 && tackEnd === null && exitV === 0) {
        tackEnd = t;
        exitV = b.v;
      }
      if (tackEnd !== null && recovered === null && b.v >= 0.92 * b.target) recovered = t - tackEnd;
    },
  });
  assert.ok(entry > 0);
  const loss = 1 - exitV / entry;
  assert.ok(loss <= 0.26 && loss >= 0.2, `clean tack lost ${loss}`);
  assert.ok(recovered !== null && recovered <= 3, `recovered in ${recovered}`);
});

test('a tack straight after another is messy and loses about 45%', () => {
  let v0 = 0;
  let second = null;
  sailBoat('dinghy', {
    steps: 30 * 25,
    onStep: (b, t) => {
      if (t > 15 && t < 15.04) b.tackReq = true;
      if (t > 17 && t < 17.04) {
        v0 = b.v;
        b.tackReq = true;
        second = b;
      }
      if (second && !b.man && t > 17.1 && t < 19) second.exitV = second.exitV ?? b.v;
    },
  });
  assert.ok(second && second.stats.messy >= 1, 'counted messy');
  const loss = 1 - second.exitV / v0;
  assert.ok(loss > 0.4 && loss < 0.5, `messy tack lost ${loss}`);
});

test('pressing Tack while tacking does nothing', () => {
  const { b } = sailBoat('dinghy', {
    steps: 30 * 20,
    onStep: (b, t) => {
      if (t > 15 && t < 16.2) b.tackReq = true; // held for over a second
    },
  });
  assert.equal(b.stats.tacks, 1);
});

test('a boat steered into irons stops, and is sailing again within 4 s of bearing away', () => {
  let ironsAt = null;
  let out = null;
  sailBoat('dinghy', {
    steps: 30 * 40,
    onStep: (b, t) => {
      if (t > 10 && t < 14) {
        b.push = true;
        b.steer = b.side; // head up and keep going
      } else if (t >= 14 && t < 20) {
        if (ironsAt === null && b.irons) ironsAt = t;
        b.push = false;
        b.steer = -b.side; // bear away
      } else b.steer = 0;
      if (t >= 14 && out === null && !b.irons && b.v >= 0.4 * b.target && b.target > 0) out = t;
    },
  });
  assert.ok(ironsAt !== null && ironsAt < 14.1, 'was in irons when the helm went the other way');
  assert.ok(out !== null && out - 14 <= 4, `out of irons after ${out - 14}`);
});

test('the helm settles in the groove at the best upwind angle, through a header', () => {
  const b = makeBoat('a', 'dinghy', 0, 0, -Math.PI / 2 - 80 * DEG);
  const cur = { vx: 0, vy: 0 };
  let t = 0;
  for (let i = 0; i < 30 * 12; i++) {
    t += 1 / 30;
    const shift = t > 6 ? 8 * DEG : 0; // a veer heads starboard tack
    const wind = { vx: Math.cos(Math.PI / 2 + shift) * 6, vy: Math.sin(Math.PI / 2 + shift) * 6, kn: 6 / KN };
    b.steer = b.side; // holding "up" all along
    stepBoat(b, wind, cur, t, 1 / 30);
    if (t > 4 && t < 6) assert.ok(Math.abs(b.twa - 47.5) < 2.5, `in the groove at ${b.twa}`);
  }
  assert.ok(!b.irons && Math.abs(b.twa - 47.5) < 3, `after the header ${b.twa}`);
});

test('a boat 3-5 lengths straight downwind of another loses 15-35% of its speed', () => {
  for (const lengths of [3, 4, 5]) {
    const d = lengths * 4.5;
    const s = coneStrength(0, 0, 0, 1, 0, d);
    const kn = 12;
    const loss = 1 - targetSpeed(CLASSES.dinghy, 47, kn * (1 - s), false) / targetSpeed(CLASSES.dinghy, 47, kn, false);
    assert.ok(loss >= 0.15 && loss <= 0.35, `${lengths} lengths: ${loss}`);
  }
  assert.equal(coneStrength(0, 0, 0, 1, 0, SHADOW.len + 1), 0);
  assert.equal(coneStrength(0, 0, 0, 1, 20, 10), 0); // outside the cone
  assert.equal(coneStrength(0, 0, 0, 1, 0, -5), 0); // upwind of the sail
});

function meet(a, b) {
  for (const x of [a, b]) {
    x.wx = 0;
    x.wy = 6;
    readWind(x, 0, 6);
  }
  return giveWay(a, b);
}

test('racing rules: port gives way to starboard, windward to leeward, astern to ahead, a tacker to all', () => {
  // Starboard tack heads up-left (wind from the top of the chart), port up-right.
  const stbd = makeBoat('s', 'dinghy', 0, 0, -Math.PI / 2 - 47 * DEG);
  const port = makeBoat('p', 'dinghy', 3, 0, -Math.PI / 2 + 47 * DEG);
  assert.equal(meet(stbd, port), port);
  // Same tack, side by side: the one further upwind keeps clear.
  const lee = makeBoat('l', 'dinghy', 0, 0, -Math.PI / 2 - 47 * DEG);
  const wwd = makeBoat('w', 'dinghy', 1.5, -2.5, -Math.PI / 2 - 47 * DEG);
  assert.equal(meet(lee, wwd), wwd);
  // Same tack, one clear astern of the other.
  const ahead = makeBoat('a', 'dinghy', 0, 0, -Math.PI / 2 - 47 * DEG);
  const h = ahead.h;
  const astern = makeBoat('b', 'dinghy', -Math.cos(h) * 4.5, -Math.sin(h) * 4.5, h);
  assert.equal(meet(ahead, astern), astern);
  // A boat tacking keeps clear even of a port tacker.
  const tacking = makeBoat('t', 'dinghy', 0, 0, -Math.PI / 2 - 47 * DEG);
  tacking.man = { kind: 'tack' };
  const p2 = makeBoat('q', 'dinghy', 3, 0, -Math.PI / 2 + 47 * DEG);
  assert.equal(meet(tacking, p2), tacking);
});

test('angles turn the short way round', () => {
  assert.ok(Math.abs(angDiff(179 * DEG, -179 * DEG) - 2 * DEG) < 1e-9);
  assert.ok(Math.abs(angDiff(-179 * DEG, 179 * DEG) + 2 * DEG) < 1e-9);
});

test('seeded randomness is stable', () => {
  assert.equal(hash32(1, 2, 3), hash32(1, 2, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(1, 2, 4));
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
