// The wind field W(x, y, t): a pure function of a race's seed and its clock, so every page sees the same air without
// sending any of it. Course frame: metres, y grows downwind (the wind blows toward +y, "up the screen" is upwind).
// Directions are kept as vectors; an angle only ever describes a small offset from the base direction.

import { KN, DEG, smoothstep } from './polar.js';
import { hashf, hash32 } from './rng.js';

export const WEATHER_IDS = ['light', 'moderate', 'fresh', 'shifty', 'squall', 'fog'];

/** Presets: base speed (kn), oscillations (deg, s), persistent shift (deg), gust cells. Classic is the time trial's. */
export const PRESETS = {
  light: {
    name: 'Light Airs', kn: [6, 8], osc1: [5, 9], per1: [60, 110], osc2: [2, 4], per2: [25, 45], persist: [-12, 12],
    cells: [6, 8], gustFrac: 0.68, gust: [0.3, 0.55], lull: [0.25, 0.4], veer: [6, 12], radius: [22, 40],
  },
  moderate: {
    name: 'Moderate', kn: [10, 14], osc1: [5, 9], per1: [50, 100], osc2: [2, 3], per2: [22, 40], persist: [-15, 15],
    cells: [4, 6], gustFrac: 0.6, gust: [0.2, 0.4], lull: [0.25, 0.32], veer: [6, 12], radius: [18, 36],
  },
  fresh: {
    name: 'Fresh', kn: [15, 20], osc1: [4, 8], per1: [40, 80], osc2: [2, 3], per2: [20, 35], persist: [-10, 10],
    cells: [6, 8], gustFrac: 0.66, gust: [0.25, 0.45], lull: [0.25, 0.3], veer: [8, 14], radius: [18, 32],
  },
  shifty: {
    name: 'Shifty', kn: [9, 13], osc1: [10, 15], per1: [40, 70], osc2: [3, 5], per2: [18, 30], persist: [-6, 6],
    cells: [3, 4], gustFrac: 0.6, gust: [0.2, 0.3], lull: [0.25, 0.3], veer: [6, 10], radius: [18, 30],
  },
  squall: {
    name: 'Squall', kn: [8, 11], osc1: [4, 7], per1: [50, 90], osc2: [2, 3], per2: [20, 35], persist: [-5, 5],
    cells: [4, 6], gustFrac: 0.62, gust: [0.25, 0.45], lull: [0.25, 0.35], veer: [6, 12], radius: [20, 36],
    front: { mul: [1.6, 1.8], veer: [20, 35], at: [0.38, 0.5] },
  },
  fog: {
    name: 'Fog', kn: [7, 11], osc1: [5, 10], per1: [50, 100], osc2: [2, 3], per2: [22, 40], persist: [-20, 20],
    cells: [3, 5], gustFrac: 0.6, gust: [0.2, 0.4], lull: [0.25, 0.35], veer: [6, 12], radius: [20, 36], visibility: 90,
  },
  classic: {
    name: 'Classic', kn: [12, 12], osc1: [7, 7], per1: [75, 75], osc2: [2, 2], per2: [31, 31], persist: [0, 0],
    cells: [5, 5], gustFrac: 0.6, gust: [0.3, 0.3], lull: [0.28, 0.28], veer: [8, 8], radius: [26, 30],
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
const pickIn = (range, u) => lerp(range[0], range[1], u);

/** The base wind speed (knots) a race's seed gives a weather: known before the course is laid. */
export function baseKnFor(seed, weatherId) {
  const p = PRESETS[weatherId] ?? PRESETS.moderate;
  return pickIn(p.kn, hashf(seed >>> 0, 7919, 1));
}

/**
 * Builds the wind for a race. `area` is the course's extent { x0, y0, x1, y1 } (gusts cross it), `raceLen` the expected
 * race length in seconds (a squall front arrives part-way through).
 */
export function makeWind(seed, weatherId, area, raceLen = 280) {
  const p = PRESETS[weatherId] ?? PRESETS.moderate;
  const s = seed >>> 0;
  const u = (k) => hashf(s, 7919, k);
  const kn = baseKnFor(s, weatherId);
  const ms = kn * KN;
  const w = {
    seed: s,
    weather: PRESETS[weatherId] ? weatherId : 'moderate',
    baseKn: kn,
    baseMs: ms,
    advect: 0.9 * ms,
    area: { ...area },
    osc1: { amp: pickIn(p.osc1, u(2)) * DEG * (u(3) < 0.5 ? -1 : 1), per: pickIn(p.per1, u(4)), ph: u(5) * Math.PI * 2 },
    osc2: { amp: pickIn(p.osc2, u(6)) * DEG, per: pickIn(p.per2, u(7)), ph: u(8) * Math.PI * 2 },
    persist: { amp: pickIn(p.persist, u(9)) * DEG, start: 20 + u(10) * 80, dur: 160 + u(11) * 200 },
    breathe: { amp: 0.05, per: 70 + u(12) * 60, ph: u(13) * Math.PI * 2 },
    gradient: (u(14) - 0.5) * 0.16,
    visibility: p.visibility ?? Infinity,
    cells: [],
    front: null,
  };
  // The ring of gust and lull cells: each slot crosses the course downwind, then comes back with new numbers.
  const n = Math.round(pickIn(p.cells, u(15)));
  const span = area.y1 - area.y0 + 2 * 44;
  for (let k = 0; k < n; k++) {
    const speed = w.advect * (0.88 + 0.24 * u(100 + k));
    const period = span / speed;
    w.cells.push({ k, period, offset: (k / n) * period + u(200 + k) * period * 0.3, speed });
  }
  w.cellParams = { gustFrac: p.gustFrac, gust: p.gust, lull: p.lull, veer: p.veer, radius: p.radius };
  if (p.front) {
    w.front = {
      t0: raceLen * pickIn(p.front.at, u(20)),
      mul: pickIn(p.front.mul, u(21)),
      veer: pickIn(p.front.veer, u(22)) * DEG * (u(23) < 0.5 ? -1 : 1),
      speed: ms * 1.1,
      width: 26,
    };
  }
  return w;
}

/** The persistent shift alone (radians) at a time. */
function persistAt(w, t) {
  return w.persist.amp * smoothstep(t, w.persist.start, w.persist.start + w.persist.dur);
}

/** Squall front position (y of its leading edge) at time t, or -Infinity before it forms. */
export function frontY(w, t) {
  if (!w.front) return -Infinity;
  return w.area.y0 - 90 + (t - w.front.t0) * w.front.speed;
}

// One cell at a time: writes into `c` (no allocation in the hot path). Returns false when the slot is empty.
const CELL = { x: 0, y: 0, r: 0, s: 0, veer: 0, env: 0, gust: true };
function cellAt(w, slot, t, c) {
  const q = (t + slot.offset) / slot.period;
  const cycle = Math.floor(q);
  const f = q - cycle;
  const s = w.seed;
  const k = slot.k;
  const P = w.cellParams;
  const gust = hashf(s, k, cycle, 2) < P.gustFrac;
  c.gust = gust;
  c.r = pickIn(P.radius, hashf(s, k, cycle, 3));
  const mag = gust ? pickIn(P.gust, hashf(s, k, cycle, 4)) : -pickIn(P.lull, hashf(s, k, cycle, 4));
  const veerSign = hashf(s, k, cycle, 5) < 0.5 ? -1 : 1;
  c.veer = (gust ? 1 : 0.5) * veerSign * pickIn(P.veer, hashf(s, k, cycle, 6)) * DEG;
  const a = w.area;
  const span = a.y1 - a.y0 + 2 * 44;
  const tSpawn = (cycle * slot.period - slot.offset);
  const drift = Math.tan(persistAt(w, tSpawn) * 0.8);
  c.y = a.y0 - 44 + f * span;
  c.x = a.x0 - 20 + hashf(s, k, cycle, 1) * (a.x1 - a.x0 + 40) - (c.y - (a.y0 - 44)) * drift;
  c.env = Math.pow(Math.sin(Math.PI * f), 0.5);
  c.s = mag * c.env;
  // Squall: cells behind the front blow harder.
  if (w.front) {
    const b = smoothstep(frontY(w, t) - c.y, -20, 20);
    if (b > 0 && gust) c.s *= 1 + 0.4 * b;
  }
  return true;
}

/** The cells live at time t (for drawing the dark ripple patches). Reuses `out` (array of plain objects). */
export function cellsAt(w, t, out = []) {
  out.length = 0;
  for (const slot of w.cells) {
    const c = { x: 0, y: 0, r: 0, s: 0, veer: 0, env: 0, gust: true };
    cellAt(w, slot, t, c);
    out.push(c);
  }
  return out;
}

/**
 * The wind at (x, y) at time t (seconds of race time). Writes into `out` and returns it:
 *  vx, vy: the air's velocity (m/s); ms: speed (m/s); kn: speed (knots); shift: radians off the base direction
 *  (+ veers: clockwise on the chart); gust: the cells' speed factor at this point (1 = none).
 */
export function windAt(w, x, y, t, out) {
  const tau = t - (y - w.area.y0) / w.advect; // shifts roll downwind: the upwind side sees them first
  let shift =
    persistAt(w, t) +
    w.osc1.amp * Math.sin((2 * Math.PI * tau) / w.osc1.per + w.osc1.ph) +
    w.osc2.amp * Math.sin((2 * Math.PI * tau) / w.osc2.per + w.osc2.ph);
  const cx = (w.area.x0 + w.area.x1) / 2;
  const half = Math.max(1, (w.area.x1 - w.area.x0) / 2);
  let speed = w.baseMs * (1 + w.breathe.amp * Math.sin((2 * Math.PI * t) / w.breathe.per + w.breathe.ph));
  speed *= 1 + w.gradient * Math.max(-1.2, Math.min(1.2, (x - cx) / half));
  let gustF = 1;
  for (let i = 0; i < w.cells.length; i++) {
    cellAt(w, w.cells[i], t, CELL);
    const dx = x - CELL.x;
    const dy = y - CELL.y;
    const d2 = dx * dx + dy * dy;
    const r2 = CELL.r * CELL.r;
    if (d2 >= r2) continue;
    const g = (1 - d2 / r2) ** 2;
    gustF *= 1 + CELL.s * g;
    shift += CELL.veer * g * CELL.env;
  }
  if (w.front) {
    const fy = frontY(w, t);
    const behind = smoothstep(fy - y, -w.front.width / 2, w.front.width / 2);
    const ahead = Math.exp(-(((y - fy - 30) / 30) ** 2)); // the calm before it
    speed *= 1 + (w.front.mul - 1) * behind - 0.25 * ahead * (1 - behind);
    shift += w.front.veer * behind;
  }
  speed *= Math.max(0.05, gustF);
  const dir = Math.PI / 2 + shift;
  out.vx = Math.cos(dir) * speed;
  out.vy = Math.sin(dir) * speed;
  out.ms = speed;
  out.kn = speed / KN;
  out.shift = shift;
  out.gust = gustF;
  return out;
}

/** A tiny scratch record for callers that only need one sample. */
export function windSample() {
  return { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 };
}

/** Deterministic id for a race's wind (handy in tests). */
export function windKey(w) {
  return hash32(w.seed, Math.round(w.baseKn * 100), w.cells.length);
}
