// Movement, pushes and falling for one dancer. Pure: players, bots and the tests all step characters with these functions.
import { COLS, ROWS, TOP_SPEED } from './rules.js';

export const DT = 1 / 60;
export const R = 0.32; // collision radius, in tiles
export const ACCEL = 30; // tiles/s²
export const FRICTION = 34; // stopping from top speed takes about 0.15 s
export const PUSH_TIME = 0.25;
export const PUSH_CD = 1.5;
export const LUNGE_DIST = 0.8;
export const KNOCK_DIST = 1.6;
export const KNOCK_TIME = 0.3;
export const FALL_TIME = 0.85; // spinning down into the dark, then a ghost
export const GHOST_SPEED = 3.2;
export const REACH = 2 * R + 0.26; // how far a pusher's fists reach, centre to centre
const LUNGE_V = LUNGE_DIST / PUSH_TIME;
const KNOCK_V0 = (2 * KNOCK_DIST) / KNOCK_TIME; // the knock slows down evenly: the average speed is half of this
const SEPARATE = 0.5;

/** A dancer. `st`: 0 standing, 1 falling, 2 ghost. `evPush` is set for one step when a push starts (the caller clears it). */
export function newChar(x = COLS / 2, y = ROWS / 2) {
  return { x, y, vx: 0, vy: 0, fx: 0, fy: 1, pushT: 0, cd: 0, knockT: 0, kx: 0, ky: 0, st: 0, stT: 0, hits: [], evPush: false, id: '', tgt: -1 };
}

/** A floor for the simulation: `voidOn` once tiles have dropped, `stand` the tiles still there (1) or gone (0). */
export function newFloor() {
  return { voidOn: false, stand: new Uint8Array(COLS * ROWS) };
}

/** Whether a point (give or take `tol` tiles) is over floor: inside the arena, and over a tile that stayed after a drop. */
export function onFloor(floor, x, y, tol = 0) {
  if (!floor.voidOn) return x >= 0 && x <= COLS && y >= 0 && y <= ROWS;
  const c0 = Math.floor(x - tol);
  const c1 = Math.floor(x + tol);
  const r0 = Math.floor(y - tol);
  const r1 = Math.floor(y + tol);
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = c0; c <= c1; c++) {
      if (c >= 0 && c < COLS && floor.stand[r * COLS + c]) return true;
    }
  }
  return false;
}

/** A dancer judged safe by a hair (within `tol` of a tile that stayed) is moved onto that tile, so the dark never takes them after the verdict. */
export function snapToFloor(floor, c, tol = 0.1) {
  if (!floor.voidOn || onFloor(floor, c.x, c.y, 0)) return;
  const c0 = Math.floor(c.x - tol);
  const c1 = Math.floor(c.x + tol);
  const r0 = Math.floor(c.y - tol);
  const r1 = Math.floor(c.y + tol);
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let col = c0; col <= c1; col++) {
      if (col < 0 || col >= COLS || !floor.stand[r * COLS + col]) continue;
      c.x = Math.min(col + 0.999, Math.max(col + 0.001, c.x));
      c.y = Math.min(r + 0.999, Math.max(r + 0.001, c.y));
      return;
    }
  }
}

function approach(c, tx, ty, step) {
  const dx = tx - c.vx;
  const dy = ty - c.vy;
  const d = Math.hypot(dx, dy);
  if (d <= step) {
    c.vx = tx;
    c.vy = ty;
  } else {
    c.vx += (dx / d) * step;
    c.vy += (dy / d) * step;
  }
}

/** Moves a dancer, held inside the arena and, once tiles have dropped, on the tiles that are left. */
function move(c, mx, my, floor) {
  let nx = c.x + mx;
  let ny = c.y + my;
  if (nx < R) {
    nx = R;
    if (c.vx < 0) c.vx = 0;
  } else if (nx > COLS - R) {
    nx = COLS - R;
    if (c.vx > 0) c.vx = 0;
  }
  if (ny < R) {
    ny = R;
    if (c.vy < 0) c.vy = 0;
  } else if (ny > ROWS - R) {
    ny = ROWS - R;
    if (c.vy > 0) c.vy = 0;
  }
  if (floor.voidOn && onFloor(floor, c.x, c.y, 0) && !onFloor(floor, nx, ny, 0)) {
    if (onFloor(floor, nx, c.y, 0)) {
      ny = c.y;
      c.vy = 0;
    } else if (onFloor(floor, c.x, ny, 0)) {
      nx = c.x;
      c.vx = 0;
    } else {
      nx = c.x;
      ny = c.y;
      c.vx = 0;
      c.vy = 0;
    }
  }
  c.x = nx;
  c.y = ny;
}

/** One 60 Hz step of a dancer with (ix, iy) as the stick (length up to 1) and whether a push is wanted. */
export function stepChar(c, ix, iy, wantPush, dt, floor) {
  if (c.st === 1) {
    c.stT += dt;
    const k = Math.exp(-3 * dt);
    c.vx *= k;
    c.vy *= k;
    c.x = Math.min(COLS + 1, Math.max(-1, c.x + c.vx * dt));
    c.y = Math.min(ROWS + 1, Math.max(-1, c.y + c.vy * dt));
    if (c.stT >= FALL_TIME) {
      c.st = 2;
      c.stT = 0;
      c.vx *= 0.3;
      c.vy *= 0.3;
    }
    return;
  }
  const len0 = Math.hypot(ix, iy);
  if (len0 > 1) {
    ix /= len0;
    iy /= len0;
  }
  const len = Math.min(1, len0);
  if (c.st === 2) {
    approach(c, ix * GHOST_SPEED, iy * GHOST_SPEED, 12 * dt);
    c.stT += dt;
    c.x = Math.min(COLS + 0.2, Math.max(-0.2, c.x + c.vx * dt));
    c.y = Math.min(ROWS + 0.2, Math.max(-0.2, c.y + c.vy * dt));
    return;
  }
  c.cd = c.cd > dt ? c.cd - dt : 0;
  const knocked = c.knockT > 0;
  if (!knocked) {
    if (len > 0.12) {
      c.fx = ix / len;
      c.fy = iy / len;
    }
    if (wantPush && c.cd <= 0 && c.pushT <= 0) {
      c.pushT = PUSH_TIME;
      c.cd = PUSH_CD;
      c.hits.length = 0;
      c.evPush = true;
    }
    approach(c, ix * TOP_SPEED, iy * TOP_SPEED, (len > 0.01 ? ACCEL : FRICTION) * dt);
  } else {
    approach(c, 0, 0, FRICTION * dt);
  }
  let mx = c.vx * dt;
  let my = c.vy * dt;
  if (c.pushT > 0) {
    mx += c.fx * LUNGE_V * dt;
    my += c.fy * LUNGE_V * dt;
    c.pushT = c.pushT > dt + 1e-9 ? c.pushT - dt : 0;
  }
  if (knocked) {
    const v = (KNOCK_V0 * Math.max(0, c.knockT - dt * 0.5)) / KNOCK_TIME;
    mx += c.kx * v * dt;
    my += c.ky * v * dt;
    c.knockT = c.knockT > dt + 1e-9 ? c.knockT - dt : 0;
  }
  move(c, mx, my, floor);
}

/** Softly pushes this dancer out of anyone standing on it (everyone does their own half, so it looks even). */
export function separate(c, others, n, floor, salt = 0) {
  if (c.st !== 0) return;
  for (let i = 0; i < n; i++) {
    const o = others[i];
    if (o === c || o.st !== 0) continue;
    let dx = c.x - o.x;
    let dy = c.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 4 * R * R) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-4) {
      const a = (salt + i) * 2.399963;
      dx = Math.cos(a);
      dy = Math.sin(a);
      d = 0;
    } else {
      dx /= d;
      dy /= d;
    }
    const push = (2 * R - d) * 0.5 * SEPARATE;
    move(c, dx * push, dy * push, floor);
  }
}

/** Whether a pusher's fists reach a point: close enough and in front. */
export function pushContact(p, tx, ty) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d > REACH) return false;
  if (d < 1e-6) return true;
  return (dx * p.fx + dy * p.fy) / d > 0.1;
}

/** Knocks a dancer away along (dx, dy). They can't steer for KNOCK_TIME. False if they're already flying or out. */
export function applyKnock(c, dx, dy) {
  if (c.st !== 0 || c.knockT > 0) return false;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-6)) {
    c.kx = c.fx;
    c.ky = c.fy;
  } else {
    c.kx = dx / d;
    c.ky = dy / d;
  }
  c.knockT = KNOCK_TIME;
  c.pushT = 0;
  return true;
}

export function startFall(c) {
  if (c.st !== 0) return;
  c.st = 1;
  c.stT = 0;
  c.pushT = 0;
  c.knockT = 0;
}

/** A dancer back on their feet, in a new place (a new round, a new lobby). */
export function resetChar(c, x, y) {
  c.x = x;
  c.y = y;
  c.vx = c.vy = 0;
  c.pushT = c.cd = c.knockT = 0;
  c.st = 0;
  c.stT = 0;
  c.hits.length = 0;
  c.evPush = false;
  c.tgt = -1;
}
