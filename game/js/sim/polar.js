// The boats: a polar speed table (how fast a boat sails at each angle to the wind), how speed follows the wind's
// strength, and the four classes. Pure data and maths: no DOM.

export const KN = 0.514; // metres per second in a knot
export const DEG = Math.PI / 180;

// The baseline dinghy: true wind angle (degrees off the bow) -> fraction of the wind's speed.
// Upwind VMG peaks near 46 degrees; downwind near 150, so gybing downwind beats a dead run.
const TABLE = [
  [0, 0], [28, 0], [32, 0.3], [38, 0.48], [45, 0.58], [52, 0.66], [60, 0.74], [75, 0.84], [90, 0.92],
  [105, 0.98], [120, 1.0], [135, 0.96], [150, 0.88], [165, 0.745], [180, 0.69],
];

/** Monotone cubic (Fritsch-Carlson) through the table: smooth, and never overshoots between points. */
function monotone(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const base = monotone(TABLE);
export const basePolar = base;

const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export { smooth as smoothstep };

/**
 * The four classes. None is strictly better: each has conditions it likes.
 *  factor(twa)  speed multiplier by angle; nogo: the edge of the no-go zone; stretch maps the class's angles onto the
 *  baseline polar (a wider no-go zone points lower); windExp: how speed follows the wind (<1 keeps going in lulls);
 *  tack/gybe: speed lost in a clean and a messy manoeuvre; tau: speed response (up, down) in seconds; turn: helm rate.
 */
export const CLASSES = {
  dinghy: {
    id: 'dinghy', name: 'Dinghy', nogo: 28, downStretch: 1, windExp: 1, tauUp: 2.0, tauDown: 3.5, turn: 1,
    tack: [0.24, 0.45], gybe: [0.12, 0.3], overpower: 0.1, plane: 0, planeFrom: 13, reach: 0, factor: 0.955,
  },
  skiff: {
    id: 'skiff', name: 'Skiff', nogo: 31, downStretch: 1, windExp: 1.03, tauUp: 1.6, tauDown: 3.0, turn: 1.25,
    tack: [0.33, 0.53], gybe: [0.15, 0.35], overpower: 0.13, plane: 0.09, planeFrom: 13.5, reach: 0, factor: 0.985,
  },
  catboat: {
    id: 'catboat', name: 'Catboat', nogo: 27, downStretch: 1, windExp: 0.97, tauUp: 3.2, tauDown: 5.0, turn: 0.8,
    tack: [0.24, 0.44], gybe: [0.1, 0.25], overpower: 0.09, plane: 0, planeFrom: 13, reach: 0, factor: 0.96,
  },
  cat: {
    id: 'cat', name: 'Catamaran', nogo: 34, downStretch: 1.25, windExp: 1.03, tauUp: 1.8, tauDown: 3.0, turn: 0.75,
    tack: [0.42, 0.58], gybe: [0.2, 0.4], overpower: 0.08, plane: 0, planeFrom: 13, reach: 0.12, factor: 1.022,
  },
};
export const CLASS_IDS = ['dinghy', 'skiff', 'catboat', 'cat'];

/** The class's polar fraction at a true wind angle (degrees), before wind-strength effects. */
export function classPolar(cls, twa) {
  let a = twa;
  if (a < 120) {
    if (a <= cls.nogo) return 0;
    a = 28 + ((a - cls.nogo) * 92) / (120 - cls.nogo);
  } else if (cls.downStretch !== 1) a = Math.min(180, 120 + (a - 120) * cls.downStretch);
  let f = base(a) * cls.factor;
  if (cls.reach) f *= 1 + cls.reach * Math.exp(-(((twa - 95) / 35) ** 2));
  return f;
}

// Lookup tables at quarter degrees, built once per class: the hot path never runs the spline.
const LUT_STEP = 4;
const LUTS = {};
for (const id of CLASS_IDS) {
  const lut = new Float32Array(180 * LUT_STEP + 1);
  for (let i = 0; i < lut.length; i++) lut[i] = classPolar(CLASSES[id], i / LUT_STEP);
  LUTS[id] = lut;
}

/** Fast polar fraction for a class id at twa degrees. */
export function polarAt(clsId, twa) {
  const lut = LUTS[clsId] ?? LUTS.dinghy;
  const x = Math.min(180, Math.max(0, twa)) * LUT_STEP;
  const i = Math.floor(x);
  if (i >= lut.length - 1) return lut[lut.length - 1];
  const f = x - i;
  return lut[i] * (1 - f) + lut[i + 1] * f;
}

/** Boats don't get faster forever: speed follows the wind, then saturates (hull speed). Knots in, knots out. */
export function effWind(kn) {
  return 18 * Math.tanh(Math.max(0, kn) / 18);
}
const EFF10 = effWind(10);

/** A class's effective wind (knots) for a true wind speed in knots. */
export function classWind(cls, kn) {
  const e = effWind(kn);
  if (cls.windExp === 1 || e <= 0) return e;
  return EFF10 * Math.pow(e / EFF10, cls.windExp);
}

/** Overpowered above about 14 knots, upwind and reaching: heels and slows unless the crew hikes. 0..1. */
export function overpowered(kn, twa) {
  return smooth(kn, 13, 15.5) * (1 - smooth(twa, 110, 135));
}

/**
 * Target boat speed in m/s.
 *  cls: a class object; twa degrees; kn: true wind speed in knots (after shadows); hiking: the crew is out.
 */
export function targetSpeed(cls, twa, kn, hiking) {
  const p = polarAt(cls.id, twa);
  if (p <= 0) return 0;
  let s = classWind(cls, kn) * KN * p;
  if (cls.plane) s *= 1 + cls.plane * smooth(kn, cls.planeFrom - 1.5, cls.planeFrom + 1.5) * smooth(twa, 65, 82);
  const over = overpowered(kn, twa);
  if (hiking) s *= 1.04;
  else if (over > 0) s *= 1 - cls.overpower * over;
  return s;
}

/** The angle (degrees) that gives the best VMG upwind (lo..hi range) or downwind, for a class at a wind speed. */
export function bestVmgAngle(cls, kn, upwind, hiking = false) {
  let best = 0;
  let bestAngle = upwind ? 45 : 150;
  const [lo, hi] = upwind ? [cls.nogo + 1, 80] : [110, 180];
  for (let a = lo; a <= hi; a += 0.25) {
    const v = targetSpeed(cls, a, kn, hiking) * (upwind ? Math.cos(a * DEG) : -Math.cos(a * DEG));
    if (v > best) {
      best = v;
      bestAngle = a;
    }
  }
  return { angle: bestAngle, vmg: best };
}

// Best angles per class, cached by whole knots (bots and the helm's groove ask often).
const VMG_CACHE = new Map();
export function vmgAngles(clsId, kn) {
  const k = Math.max(2, Math.min(30, Math.round(kn)));
  const key = `${clsId}:${k}`;
  let v = VMG_CACHE.get(key);
  if (!v) {
    const cls = CLASSES[clsId] ?? CLASSES.dinghy;
    const up = bestVmgAngle(cls, k, true);
    const down = bestVmgAngle(cls, k, false);
    v = { up: up.angle, upVmg: up.vmg, down: down.angle, downVmg: down.vmg };
    VMG_CACHE.set(key, v);
  }
  return v;
}
