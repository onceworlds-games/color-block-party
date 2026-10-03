// Courses: marks, gates, lines, islands, shoals and current, laid out in the course frame (metres, the wind from the
// top: -y is upwind). Twelve hand-made courses; "Auto" picks one from the race seed. Pure data: no DOM.

import { hashf, rng } from './rng.js';

export const COURSE_COUNT = 12;

// Shorthand: m(x, y, name, side) a mark ('port' | 'starboard' | 'auto'); g(x, y, w, name) a gate across the leg.
const m = (x, y, name, side = 'auto') => ({ type: 'mark', x, y, name, side });
const g = (x, y, w, name) => ({ type: 'gate', x, y, w, name });
const isl = (x, y, r, seed, sx = 1, sy = 1, rot = 0) => ({ x, y, r, seed, sx, sy, rot });
const shoal = (x, y, rx, ry, rot = 0) => ({ x, y, rx, ry, rot });
const cur = (x, y, w, h, vx, vy, rot = 0) => ({ x, y, w, h, vx, vy, rot });

/**
 * The twelve courses. `lap` repeats `laps` times when `lapped`; `finish` is the finish line { x, y, w } (horizontal
 * unless `rot`), crossed in the direction of the last leg. Sizes were tuned in scripts/balance.mjs.
 */
export const COURSES = [
  {
    id: 1, name: 'Pilot Bank', kind: 'Windward-leeward', lapped: true, scalable: true,
    lap: [m(0, -175, 'Windward', 'port'), g(0, -18, 22, 'Gate')],
    lastLap: [m(0, -175, 'Windward', 'port')],
    finish: { x: 0, y: -12, w: 30 },
  },
  {
    id: 2, name: 'Long Reach', kind: 'Triangle', lapped: true, scalable: true,
    lap: [m(0, -165, 'Windward', 'port'), m(-150, -95, 'Wing', 'port'), m(0, -22, 'Leeward', 'port')],
    lastLap: [m(0, -165, 'Windward', 'port'), m(-150, -95, 'Wing', 'port')],
    finish: { x: -40, y: -40, w: 30, rot: -0.9 },
  },
  {
    id: 3, name: 'Gannet Sound', kind: 'Coastal', lapped: false, scalable: false,
    lap: [m(-30, -215, 'Gannet', 'port'), m(-175, -160, 'Heron', 'port'), m(-150, -40, 'Bell', 'port'), m(-20, -105, 'Saddle', 'starboard')],
    finish: { x: 60, y: -105, w: 30, rot: 1.3 },
    islands: [isl(-97, -134, 30, 11, 1.25, 0.9, 0.4), isl(60, -190, 26, 12, 1, 1.2, -0.2)],
    shoals: [shoal(-192, -98, 16, 8, 1.2)],
  },
  {
    id: 4, name: 'The Narrows', kind: 'Channel', lapped: true, scalable: false,
    lap: [m(0, -185, 'Windward', 'port'), g(0, -18, 22, 'Gate')],
    lastLap: [m(0, -185, 'Windward', 'port')],
    finish: { x: 0, y: -10, w: 30 },
    islands: [isl(-150, -100, 48, 21, 0.55, 2.4, 0.08), isl(150, -110, 46, 22, 0.55, 2.5, -0.06)],
    shoals: [shoal(-92, -40, 12, 22, 0.1), shoal(96, -170, 12, 24, -0.1)],
  },
  {
    id: 5, name: 'Gull Rock', kind: 'Coastal', lapped: false, scalable: false,
    lap: [m(40, -230, 'Gull', 'port'), m(-110, -215, 'Tern', 'port'), m(-150, -60, 'Kittiwake', 'port'), m(-25, -25, 'Puffin', 'port')],
    lastLap: null,
    finish: { x: 60, y: -40, w: 30, rot: 1.57 },
    islands: [isl(-60, -130, 46, 31, 1.1, 1.0, 0.2)],
    shoals: [shoal(-5, -150, 14, 8, 0.6)],
  },
  {
    id: 6, name: 'Slalom Bay', kind: 'Slalom', lapped: true, scalable: true,
    lap: [g(-40, -60, 18, 'Gate 1'), g(40, -120, 18, 'Gate 2'), m(0, -180, 'Top', 'port'), g(45, -120, 18, 'Gate 3'), g(-45, -60, 18, 'Gate 4'), g(0, -15, 22, 'Bottom')],
    lastLap: [g(-40, -60, 18, 'Gate 1'), g(40, -120, 18, 'Gate 2'), m(0, -180, 'Top', 'port'), g(45, -120, 18, 'Gate 3'), g(-45, -60, 18, 'Gate 4')],
    finish: { x: 0, y: -12, w: 30 },
  },
  {
    id: 7, name: 'Sprint', kind: 'Sprint', lapped: false, scalable: true,
    lap: [m(0, -215, 'Windward', 'port')],
    finish: { x: 0, y: -10, w: 30 },
  },
  {
    id: 8, name: 'Shoal Water', kind: 'Windward-leeward', lapped: true, scalable: false,
    lap: [m(0, -180, 'Windward', 'port'), g(0, -18, 22, 'Gate')],
    lastLap: [m(0, -180, 'Windward', 'port')],
    finish: { x: 0, y: -10, w: 30 },
    shoals: [shoal(-95, -125, 26, 12, 0.5), shoal(100, -70, 24, 11, -0.4), shoal(55, -205, 16, 8, 0.2)],
    currents: [cur(0, -95, 420, 46, 0.55, 0, 0)],
  },
  {
    id: 9, name: 'Lighthouse Point', kind: 'Coastal', lapped: false, scalable: false,
    lap: [m(-60, -170, 'Lantern', 'port'), m(-170, -250, 'Cormorant', 'starboard'), m(-20, -300, 'Light', 'starboard'), m(110, -190, 'Skerry', 'starboard'), m(70, -60, 'Ledge', 'starboard'), m(-20, -50, 'Buoy', 'starboard')],
    finish: { x: -45, y: -110, w: 30, rot: 0.2 },
    islands: [isl(84, -289, 40, 41, 1.6, 0.8, 0.5), isl(-120, -100, 22, 42, 1, 1, 0)],
    shoals: [shoal(142, -118, 15, 10, 0.4)],
    currents: [cur(40, -175, 70, 220, 0, 0.5, 0.3)],
  },
  {
    id: 10, name: 'Trapezoid', kind: 'Trapezoid', lapped: true, scalable: true,
    lap: [m(0, -165, 'Windward', 'port'), m(-125, -150, 'Offset', 'port'), m(-125, -30, 'Bottom', 'port'), m(0, -12, 'Leeward', 'port')],
    lastLap: [m(0, -165, 'Windward', 'port'), m(-125, -150, 'Offset', 'port')],
    finish: { x: -125, y: -85, w: 30, rot: 0 },
  },
  {
    id: 11, name: 'Tidal Race', kind: 'Windward-leeward', lapped: true, scalable: false,
    lap: [m(0, -190, 'Windward', 'port'), g(0, -18, 22, 'Gate')],
    lastLap: [m(0, -190, 'Windward', 'port')],
    finish: { x: 0, y: -10, w: 30 },
    currents: [cur(-20, -120, 90, 520, 0, 0.75, 0.55), cur(60, -40, 300, 40, -0.35, 0, 0)],
    islands: [isl(-175, -230, 24, 51, 1.2, 0.9, 0)],
  },
  {
    id: 12, name: 'Archipelago', kind: 'Coastal', lapped: false, scalable: false,
    lap: [m(10, -235, 'Petrel', 'port'), m(-145, -195, 'Shag', 'port'), m(-60, -95, 'Auk', 'starboard'), m(-150, -20, 'Fulmar', 'port')],
    finish: { x: -75, y: 5, w: 30, rot: 1.94 },
    islands: [isl(-40, -165, 16, 61), isl(55, -125, 18, 62, 1.2, 0.8), isl(-128, -118, 15, 63), isl(122, -52, 13, 64), isl(-195, -95, 17, 65, 0.9, 1.3), isl(90, -215, 14, 66)],
    shoals: [shoal(-80, -36, 12, 7, 0.9)],
  },
];

/** A course by id (1-12); anything else is course 1. */
export function courseDef(id) {
  return COURSES.find((c) => c.id === id) ?? COURSES[0];
}

/** "Auto": a course from the race seed. */
export function autoCourse(seed) {
  return 1 + Math.floor(hashf(seed >>> 0, 4242) * COURSE_COUNT);
}

/** An island's coastline: a closed polygon, wobbly but deterministic. */
export function islandPolygon(il, steps = 28) {
  const pts = [];
  const r = rng(il.seed * 7919 + 13);
  const bumps = [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)];
  const amps = [r.range(0.08, 0.16), r.range(0.04, 0.1), r.range(0.02, 0.05)];
  const c = Math.cos(il.rot);
  const s = Math.sin(il.rot);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = 1 + amps[0] * Math.sin(2 * a + bumps[0]) + amps[1] * Math.sin(3 * a + bumps[1]) + amps[2] * Math.sin(7 * a + bumps[2]);
    const lx = Math.cos(a) * il.r * il.sx * k;
    const ly = Math.sin(a) * il.r * il.sy * k;
    pts.push([il.x + lx * c - ly * s, il.y + lx * s + ly * c]);
  }
  return pts;
}

/** The race's scale for a course: open-water courses shrink in light air and stretch a little in a breeze. */
export function courseScale(def, baseKn) {
  if (!def.scalable) return 1;
  return Math.max(0.72, Math.min(1.1, 0.55 + 0.0375 * baseKn));
}

/**
 * Builds a race's course: the target list (start, marks, finish) with crossing geometry, the line, obstacles and the
 * boundary. `laps` 1-3 for lapped courses; `fleet` sizes the start line; `scale` from courseScale().
 */
export function buildCourse(def, { laps = 2, fleet = 6, scale = 1 } = {}) {
  const S = (v) => v * scale;
  const lapsUsed = def.lapped ? Math.max(1, Math.min(3, laps | 0)) : 1;
  const seq = [];
  for (let i = 0; i < lapsUsed; i++) {
    const last = i === lapsUsed - 1;
    const marks = last && def.lastLap ? def.lastLap : def.lap;
    for (const mk of marks) seq.push({ ...mk, x: S(mk.x), y: S(mk.y), w: mk.w });
  }
  const half = Math.max(22, (fleet * 6.75 + 20) / 2);
  const start = { type: 'start', x: 0, y: 0, x1: -half, y1: 0, x2: half, y2: 0, name: 'Start', fx: 0, fy: -1 };
  const fin = def.finish;
  const fr = fin.rot ?? 0;
  const fx = S(fin.x);
  const fy = S(fin.y);
  const fhw = fin.w / 2;
  const finish = { type: 'finish', x: fx, y: fy, x1: fx - Math.cos(fr) * fhw, y1: fy - Math.sin(fr) * fhw, x2: fx + Math.cos(fr) * fhw, y2: fy + Math.sin(fr) * fhw, name: 'Finish' };
  const targets = [start, ...seq.map((t) => ({ ...t })), finish];
  // Leg directions, lengths, the rounding geometry of every mark and the crossing direction of every line.
  for (let i = 1; i < targets.length; i++) {
    const a = targets[i - 1];
    const b = targets[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    b.legLen = len;
    b.ax = dx / len;
    b.ay = dy / len;
  }
  start.legLen = 0;
  start.ax = 0;
  start.ay = -1;
  for (let i = 1; i < targets.length; i++) {
    const t = targets[i];
    const next = targets[i + 1];
    if (t.type === 'gate') {
      // A gate is a short line across the leg, crossed in the leg's direction.
      const px = -t.ay;
      const py = t.ax;
      const hw = (t.w ?? 20) / 2;
      t.x1 = t.x - px * hw;
      t.y1 = t.y - py * hw;
      t.x2 = t.x + px * hw;
      t.y2 = t.y + py * hw;
      t.fx = t.ax;
      t.fy = t.ay;
    } else if (t.type === 'finish') {
      // Crossed in the direction that comes from the last mark.
      const lx = t.x2 - t.x1;
      const ly = t.y2 - t.y1;
      let nx = -ly;
      let ny = lx;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      if (nx * t.ax + ny * t.ay < 0) {
        nx = -nx;
        ny = -ny;
      }
      t.fx = nx;
      t.fy = ny;
    } else if (t.type === 'mark') {
      const bx = next ? next.x - t.x : t.ax;
      const by = next ? next.y - t.y : t.ay;
      const bl = Math.hypot(bx, by) || 1;
      const ox = bx / bl;
      const oy = by / bl;
      t.bx = ox;
      t.by = oy;
      // Turn direction: cross(a, b) > 0 turns clockwise on screen (right), < 0 counter-clockwise (left).
      const turn = t.ax * oy - t.ay * ox;
      if (t.side === 'auto') t.side = turn > 0 ? 'starboard' : 'port';
      const dx = t.ax - ox;
      const dy = t.ay - oy;
      const dl = Math.hypot(dx, dy);
      if (dl > 0.3) {
        t.rx = dx / dl;
        t.ry = dy / dl;
      } else {
        // Barely a turn: the ray points to the side the boat passes on (right of the leg for a port mark).
        const s = t.side === 'port' ? 1 : -1;
        t.rx = -t.ay * s;
        t.ry = t.ax * s;
      }
      t.rayLen = 55;
    }
  }
  // Obstacles.
  const islands = (def.islands ?? []).map((il) => ({ ...il, x: il.x, y: il.y, poly: islandPolygon(il), rr: il.r * Math.max(il.sx, il.sy) * 1.12, sr: il.r * Math.sqrt(il.sx * il.sy) }));
  const shoals = (def.shoals ?? []).map((s) => ({ ...s, c: Math.cos(s.rot), s: Math.sin(s.rot) }));
  const currents = (def.currents ?? []).map((c) => ({ ...c, c: Math.cos(c.rot), s: Math.sin(c.rot) }));
  // The boundary: the marks, the lines and the starting area, with room to manoeuvre.
  let x0 = -half - 30;
  let x1 = half + 30;
  let y0 = 0;
  let y1 = 80;
  for (const t of targets) {
    x0 = Math.min(x0, t.x - 70);
    x1 = Math.max(x1, t.x + 70);
    y0 = Math.min(y0, t.y - 55);
    y1 = Math.max(y1, t.y + 40);
  }
  // Wide enough to tack across the laylines of the longest beat.
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < height * 0.95) {
    const grow = (height * 0.95 - width) / 2;
    x0 -= grow;
    x1 += grow;
  }
  const bounds = { x0, y0, x1, y1 };
  const total = targets.reduce((sum, t) => sum + (t.legLen || 0), 0);
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    laps: lapsUsed,
    lapped: !!def.lapped,
    scale,
    targets,
    start,
    finish,
    halfLine: half,
    committee: { x: half + 3.5, y: 0, r: 3.2 },
    pin: { x: -half, y: 0, r: 0.9 },
    islands,
    shoals,
    currents,
    bounds,
    total,
  };
}

// ---------------------------------------------------------------------------------------------- crossing geometry

/**
 * Where the segment p0 -> p1 crosses the segment a -> b: the fraction along p0 -> p1, or -1. Touching counts.
 */
export function segCross(p0x, p0y, p1x, p1y, ax, ay, bx, by) {
  const rx = p1x - p0x;
  const ry = p1y - p0y;
  const sx = bx - ax;
  const sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const qx = ax - p0x;
  const qy = ay - p0y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return t;
}

const BAND = 1; // metres either side of a ray or line where a boat's side is not decided (jitter-proof)

/**
 * Which side of a target a point is on, and whether it is within the target's reach: writes { side, d, within } into
 * out. Marks: the side of the rounding ray (+1 is the side a port rounding starts from). Lines: -1 before, +1 after.
 */
export function targetSide(t, x, y, out) {
  if (t.type === 'mark') {
    const dx = x - t.x;
    const dy = y - t.y;
    const d = t.rx * dy - t.ry * dx; // cross(ray, p - mark)
    const along = t.rx * dx + t.ry * dy;
    out.d = d;
    out.within = along >= -0.5 && along <= t.rayLen;
  } else {
    const lx = t.x2 - t.x1;
    const ly = t.y2 - t.y1;
    const l2 = lx * lx + ly * ly || 1;
    const k = ((x - t.x1) * lx + (y - t.y1) * ly) / l2;
    out.d = (x - t.x1) * t.fx + (y - t.y1) * t.fy;
    out.within = k >= -0.02 && k <= 1.02;
  }
  out.side = out.d > BAND ? 1 : out.d < -BAND ? -1 : 0;
  return out;
}

const SIDE = { side: 0, d: 0, within: false };

/**
 * The change in a boat's rounding count for its current target after a move: +1 a crossing the right way (round a
 * mark on its side, a line forwards), -1 the wrong way, 0 nothing. `state` keeps the boat's last decided side
 * ({ side }); sides inside the 1 m band don't count, so a boat jostled along a ray or a line never counts twice.
 */
export function crossingStep(t, state, x, y) {
  targetSide(t, x, y, SIDE);
  if (SIDE.side === 0) return 0;
  const was = state.side;
  state.side = SIDE.side;
  if (was === 0 || was === SIDE.side || !SIDE.within) return 0;
  if (t.type === 'mark') {
    const ccw = was > 0; // +1 -> -1 sweeps counter-clockwise on the chart: a port rounding
    return (t.side === 'port') === ccw ? 1 : -1;
  }
  return SIDE.side > 0 ? 1 : -1;
}

/** Signed distance from a point to the start line: positive on the course side (upwind of it). */
export function startSide(course, x, y) {
  return course.start.y - y;
}

/** Inside an island's polygon? (even-odd rule) */
export function inPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The nearest point on a polygon's edge to (x, y): writes { x, y, d } into out. */
export function nearestOnPolygon(poly, x, y, out) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0];
    const ay = poly[j][1];
    const bx = poly[i][0];
    const by = poly[i][1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    const px = ax + ex * t;
    const py = ay + ey * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      out.x = px;
      out.y = py;
    }
  }
  out.d = best;
  return out;
}

/** Inside a shoal (an ellipse)? */
export function inShoal(s, x, y) {
  const dx = x - s.x;
  const dy = y - s.y;
  const lx = dx * s.c + dy * s.s;
  const ly = -dx * s.s + dy * s.c;
  return (lx * lx) / (s.rx * s.rx) + (ly * ly) / (s.ry * s.ry) <= 1;
}

/**
 * The current at a point (m/s), summed over the course's zones with soft edges, scaled by `course.currentMul` (slacker
 * in light airs, so a stream never holds a fleet still). Writes { vx, vy } into out.
 */
export function currentAt(course, x, y, out) {
  out.vx = 0;
  out.vy = 0;
  for (const c of course.currents) {
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = dx * c.c + dy * c.s;
    const ly = -dx * c.s + dy * c.c;
    const ex = Math.abs(lx) - c.w / 2;
    const ey = Math.abs(ly) - c.h / 2;
    const edge = 14;
    const fx = ex <= -edge ? 1 : ex >= 0 ? 0 : -ex / edge;
    const fy = ey <= -edge ? 1 : ey >= 0 ? 0 : -ey / edge;
    const f = fx * fy;
    if (f <= 0) continue;
    // The zone's flow is given in its own frame: rotate it into the course frame.
    const k = f * (course.currentMul ?? 1);
    out.vx += (c.vx * c.c - c.vy * c.s) * k;
    out.vy += (c.vx * c.s + c.vy * c.c) * k;
  }
  return out;
}

/** Distance still to sail for a boat heading to target index `pi` at (x, y): used for standings and gaps. */
export function distanceToGo(course, pi, x, y) {
  const T = course.targets;
  if (pi >= T.length) return 0;
  let rest = 0;
  for (let j = pi + 1; j < T.length; j++) rest += T[j].legLen;
  const t = T[pi];
  const dx = t.x - x;
  const dy = t.y - y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return rest;
  // Beats and runs are measured on the wind's ladder (a boat out on a layline isn't behind one in the middle).
  const up = -dy / d; // cos of the bearing off the wind's direction
  let leg;
  if (up > 0.6947) leg = (d * up) / 0.6947; // within 46 degrees of dead upwind
  else if (up < -0.866) leg = (d * -up) / 0.866; // within 30 degrees of dead downwind
  else leg = d;
  return rest + leg;
}
