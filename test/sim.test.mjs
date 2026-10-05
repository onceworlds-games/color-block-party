import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, TOP_SPEED } from '../game/rules.js';
import {
  ACCEL, DT, FALL_TIME, KNOCK_DIST, KNOCK_TIME, LUNGE_DIST, PUSH_CD, PUSH_TIME, R, REACH,
  applyKnock, newChar, newFloor, onFloor, pushContact, resetChar, separate, snapToFloor, startFall, stepChar,
} from '../game/sim.js';

const run = (c, ix, iy, seconds, floor = newFloor(), push = false) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepChar(c, ix, iy, push && i === 0, DT, floor);
};

test('top speed is 5 tiles a second, reached in about 0.17 s', () => {
  const c = newChar(2, 4);
  run(c, 1, 0, 0.1);
  assert.ok(c.vx > 2.5 && c.vx < 3.2, `accelerating at ${ACCEL}: ${c.vx}`);
  run(c, 1, 0, 0.2);
  assert.ok(Math.abs(c.vx - TOP_SPEED) < 1e-9);
  const x0 = c.x;
  run(c, 1, 0, 1);
  assert.ok(Math.abs(c.x - x0 - TOP_SPEED) < 0.01 || c.x >= COLS - R - 1e-9);
});

test('stopping takes about 0.15 s', () => {
  const c = newChar(2, 4);
  run(c, 1, 0, 0.5);
  let steps = 0;
  while (Math.hypot(c.vx, c.vy) > 1e-9 && steps < 100) {
    stepChar(c, 0, 0, false, DT, newFloor());
    steps++;
  }
  assert.ok(steps * DT >= 0.12 && steps * DT <= 0.18, `stopped in ${steps * DT}`);
});

test('diagonals are no faster than straight lines', () => {
  const c = newChar(6, 4);
  run(c, 1, 1, 0.5);
  assert.ok(Math.hypot(c.vx, c.vy) <= TOP_SPEED + 1e-9);
});

test('nobody leaves the floor', () => {
  const c = newChar(6, 4);
  run(c, 1, 0.3, 6);
  assert.ok(c.x <= COLS - R + 1e-9 && c.y <= ROWS - R + 1e-9);
  run(c, -1, -1, 8);
  assert.ok(c.x >= R - 1e-9 && c.y >= R - 1e-9);
});

test('a push lunges 0.8 tiles forward in 0.25 s, with a 1.5 s cooldown', () => {
  const c = newChar(3, 4);
  c.fx = 1;
  c.fy = 0;
  stepChar(c, 0, 0, true, DT, newFloor());
  assert.ok(c.evPush && c.pushT > 0);
  const x0 = c.x - (c.fx * LUNGE_DIST) / PUSH_TIME * DT; // the first step already moved
  let steps = 1;
  while (c.pushT > 0 && steps < 100) {
    stepChar(c, 0, 0, false, DT, newFloor());
    steps++;
  }
  assert.ok(Math.abs(c.x - x0 - LUNGE_DIST) < 0.06, `lunged ${c.x - x0}`);
  assert.ok(Math.abs(steps * DT - PUSH_TIME) < 0.04);
  // a second push inside the cooldown does nothing
  c.evPush = false;
  stepChar(c, 0, 0, true, DT, newFloor());
  assert.ok(!c.evPush);
  run(c, 0, 0, PUSH_CD);
  stepChar(c, 0, 0, true, DT, newFloor());
  assert.ok(c.evPush);
});

test('a knock moves 1.6 tiles in 0.3 s, and the dancer cannot steer meanwhile', () => {
  const c = newChar(3, 4);
  assert.ok(applyKnock(c, 2, 0));
  assert.ok(!applyKnock(c, 2, 0), 'no double knock while flying');
  const x0 = c.x;
  let steps = 0;
  while (c.knockT > 0 && steps < 100) {
    stepChar(c, -1, 0, false, DT, newFloor()); // steering the other way does nothing
    steps++;
  }
  assert.ok(Math.abs(c.x - x0 - KNOCK_DIST) < 0.08, `knocked ${c.x - x0}`);
  assert.ok(Math.abs(steps * DT - KNOCK_TIME) < 0.04);
  assert.ok(Math.abs(c.vx) < 1e-9);
});

test('pushes reach what is in front, not behind', () => {
  const p = newChar(5, 4);
  p.fx = 1;
  p.fy = 0;
  assert.ok(pushContact(p, 5 + REACH - 0.05, 4));
  assert.ok(!pushContact(p, 5 + REACH + 0.2, 4));
  assert.ok(!pushContact(p, 4.4, 4), 'behind');
  assert.ok(pushContact(p, 5.5, 4.4));
});

test('after a drop dancers are held on the tiles that stayed', () => {
  const floor = newFloor();
  floor.voidOn = true;
  floor.stand[4 * COLS + 5] = 1; // one tile at column 5, row 4
  floor.stand[4 * COLS + 6] = 1;
  const c = newChar(5.5, 4.5);
  run(c, -1, 0, 1, floor);
  assert.ok(c.x >= 5 - 1e-9, 'stopped at the edge of the tiles');
  run(c, 1, 0, 1, floor);
  assert.ok(c.x < 7 + 1e-9 && c.x > 6.5, 'can cross from tile to tile');
  run(c, 0, 1, 1, floor);
  assert.ok(c.y < 5 + 1e-9);
  assert.ok(onFloor(floor, c.x, c.y, 0));
});

test('who falls: over a tile that stays, with a hair of leeway, and the near-miss is moved onto it', () => {
  const floor = newFloor();
  floor.voidOn = true;
  floor.stand[3 * COLS + 3] = 1;
  assert.ok(onFloor(floor, 3.5, 3.5, 0));
  assert.ok(!onFloor(floor, 5.5, 3.5, 0.1));
  assert.ok(onFloor(floor, 2.95, 3.5, 0.1));
  const c = newChar(2.95, 3.5);
  snapToFloor(floor, c);
  assert.ok(onFloor(floor, c.x, c.y, 0));
  const far = newChar(8, 6);
  snapToFloor(floor, far);
  assert.equal(far.x, 8);
});

test('falling spins down into the dark and then floats as a ghost that can drift', () => {
  const c = newChar(3, 3);
  startFall(c);
  assert.equal(c.st, 1);
  run(c, 0, 0, FALL_TIME + 0.05);
  assert.equal(c.st, 2);
  const x0 = c.x;
  run(c, 1, 0, 1);
  assert.ok(c.x > x0 + 1.5, 'a ghost drifts');
  run(c, 1, 0, 10);
  assert.ok(c.x <= COLS + 0.2 + 1e-9);
  resetChar(c, 4, 4);
  assert.equal(c.st, 0);
});

test('dancers standing on each other drift apart softly', () => {
  const a = newChar(5, 4);
  const b = newChar(5.1, 4);
  const floor = newFloor();
  for (let i = 0; i < 60; i++) {
    separate(a, [a, b], 2, floor, 1);
    separate(b, [a, b], 2, floor, 2);
  }
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * R - 0.02);
  const c = newChar(7, 4);
  const d = newChar(7, 4);
  for (let i = 0; i < 80; i++) {
    separate(c, [c, d], 2, floor, 1);
    separate(d, [c, d], 2, floor, 2);
  }
  assert.ok(Math.hypot(c.x - d.x, c.y - d.y) >= 2 * R - 0.02, 'even exactly on top of each other');
  assert.ok(Number.isFinite(c.x) && Number.isFinite(d.y));
});
