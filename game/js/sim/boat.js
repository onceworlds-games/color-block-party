// One boat: helm, tacks and gybes, irons, hiking and speed. Fixed-step and allocation-free; the race supplies the wind
// at the boat (after shadows) and the current under it.

import { CLASSES, DEG, overpowered, targetSpeed, vmgAngles } from './polar.js';

export const BOAT_R = 2.4; // collision radius (m)
export const BOAT_LEN = 4.5;
const TAU_PI = Math.PI * 2;

/** The shortest signed difference between two angles (radians), in (-PI, PI]. */
export function angDiff(a, b) {
  let d = (b - a) % TAU_PI;
  if (d > Math.PI) d -= TAU_PI;
  else if (d <= -Math.PI) d += TAU_PI;
  return d;
}

/** Keeps an angle in (-PI, PI]. */
export function wrapAngle(a) {
  return angDiff(0, a);
}

export function makeBoat(id, clsId, x, y, h) {
  return {
    id: String(id),
    cls: CLASSES[clsId] ? clsId : 'dinghy',
    x, y, h: wrapAngle(h), v: 0,
    px: x, py: y, ph: h, // the previous step, for drawing between steps and crossing tests
    // Controls, written by the player's input or a skipper.
    steer: 0, // -1..1, positive turns clockwise on the chart
    push: false, // pass the helm's detent at once (stick pushed hard)
    tackReq: false,
    hikeReq: false,
    aim: null, // a skipper's wanted heading (radians); null for a person
    // State.
    man: null, // the tack or gybe under way
    lastMan: -99,
    stamina: 1, hiking: false, hikeLock: false,
    heel: 0, irons: false, ironsT: 0, luff: 0,
    holdTwa: null, // the wind angle the helm keeps when let go (beating or running)
    groove: 0, pressDir: 0, pressTwa: 90, wasSteering: false,
    // Wind and speed as last computed (the HUD and the skippers read these).
    twa: 90, side: 1, tws: 0, wx: 0, wy: 0, wkn: 0, shadow: 1, target: 0,
    // Race.
    pi: 0, wind: 0, track: { side: 0 }, ocs: false, started: false, startT: null, startV: 0,
    finished: false, finishT: null, place: 0,
    penalty: 0, foulFlag: 0, grounded: 0, groundImmune: 0, outside: 0,
    remote: false, retired: false, ghost: false, parked: false,
    trim: 1, // how well the sails are trimmed: people always get 1 (the boat trims itself); rival skippers by skill
    name: '', bot: null,
    stats: { clean: 0, messy: 0, tacks: 0, fouls: 0, ocs: 0, gustT: 0, steals: {}, stealT: {}, wrong: 0, grounds: 0 },
  };
}

/** Starts a tack or a gybe if the boat can. Returns the manoeuvre or null. */
export function startManoeuvre(b, t) {
  if (b.man || b.grounded > 0 || b.finished) return null;
  const cls = CLASSES[b.cls];
  const twa = b.twa;
  const best = vmgAngles(b.cls, b.wkn || 10);
  let kind;
  let dh;
  let clean;
  if (b.irons || twa < cls.nogo) {
    // Out of irons: through the wind to a close-hauled course on the other tack. Never clean.
    kind = 'tack';
    dh = b.side * (twa + best.up) * DEG;
    clean = false;
  } else if (twa < 90) {
    kind = 'tack';
    dh = b.side * 2 * twa * DEG; // head up through the wind to the same angle on the other tack
    clean = b.v >= 0.85 * b.target && t - b.lastMan >= 6;
  } else {
    kind = 'gybe';
    dh = -b.side * 2 * (180 - twa) * DEG; // bear away through dead downwind
    clean = b.v >= 0.85 * b.target && t - b.lastMan >= 6;
  }
  const turn = Math.abs(dh) / DEG;
  const baseDur = kind === 'tack' ? 1.4 : 1.2;
  const dur = baseDur * Math.max(0.75, Math.min(1.6, turn / 90)) / Math.sqrt(cls.turn);
  const losses = kind === 'tack' ? cls.tack : cls.gybe;
  b.man = { kind, t: 0, dur, h0: b.h, dh, v0: b.v, loss: clean ? losses[0] : losses[1], clean };
  b.holdTwa = null;
  b.stats.tacks++;
  if (clean) b.stats.clean++;
  else b.stats.messy++;
  return b.man;
}

const ease = (s) => (s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s));
const smoothS = (s) => s * s * (3 - 2 * s);

/** Maximum helm rate (rad/s) at a speed. */
export function turnRate(b) {
  const cls = CLASSES[b.cls];
  const k = Math.min(1, Math.max(0, b.v / 5));
  let deg = (55 - 27 * k) * cls.turn;
  if (b.irons || b.v < 0.6) deg = Math.max(deg, 25 * cls.turn);
  return deg * DEG;
}

/**
 * Wind angle and tack from the wind vector at the boat. Writes b.twa (degrees, 0..180) and b.side (+1: the wind comes
 * over the starboard side, the boat is on starboard tack; -1: port).
 */
export function readWind(b, wx, wy) {
  const ms = Math.hypot(wx, wy) || 1e-6;
  const fx = -wx / ms; // where the wind comes from
  const fy = -wy / ms;
  const hx = Math.cos(b.h);
  const hy = Math.sin(b.h);
  const c = Math.max(-1, Math.min(1, hx * fx + hy * fy));
  b.twa = Math.acos(c) / DEG;
  // Right-hand side of the boat on a y-down chart: (-sin h, cos h).
  const r = -hy * fx + hx * fy;
  b.side = r >= 0 ? 1 : -1;
}

/** The heading that sails `twa` degrees off the wind on tack `side`, for a wind vector (wx, wy). */
export function headingFor(wx, wy, twa, side) {
  const from = Math.atan2(-wy, -wx);
  return wrapAngle(from - side * twa * DEG);
}

/**
 * One fixed step for a boat. `wind` is the wind at the boat after shadows { vx, vy, kn }; `cur` the current { vx, vy };
 * `t` race time (s); `dt` the step (s); `slow` an extra factor on the target speed (outside the course: < 1).
 * Returns an event string or null ('tack', 'gybe', 'irons').
 */
export function stepBoat(b, wind, cur, t, dt, slow = 1) {
  const cls = CLASSES[b.cls];
  b.px = b.x;
  b.py = b.y;
  b.ph = b.h;
  b.wx = wind.vx;
  b.wy = wind.vy;
  b.wkn = wind.kn;
  readWind(b, wind.vx, wind.vy);
  let event = null;
  const best = vmgAngles(b.cls, wind.kn);

  // Tack or gybe on request (asked for while aground, it happens as soon as she floats).
  if (b.tackReq && !(b.grounded > 0 && !b.man && !b.finished)) {
    b.tackReq = false;
    const m = startManoeuvre(b, t);
    if (m) event = m.kind;
  }

  // Hiking: costs stamina; once spent, the crew rests until it has a quarter back.
  if (b.hikeReq && !b.hikeLock && b.stamina > 0 && !b.finished) {
    b.hiking = true;
    b.stamina = Math.max(0, b.stamina - dt / 10);
    if (b.stamina <= 0) b.hikeLock = true;
  } else {
    b.hiking = false;
    b.stamina = Math.min(1, b.stamina + dt / 18);
    if (b.hikeLock && b.stamina >= 0.25) b.hikeLock = false;
  }

  let turnLoss = 0;
  if (b.man) {
    const m = b.man;
    m.t += dt;
    const s = Math.min(1, m.t / m.dur);
    b.h = wrapAngle(m.h0 + m.dh * ease(s));
    b.v = m.v0 * (1 - m.loss * smoothS(s));
    if (s >= 1) {
      b.man = null;
      b.lastMan = t;
      readWind(b, wind.vx, wind.vy);
      b.holdTwa = b.twa < 65 || b.twa > 125 ? b.twa : null;
    }
  } else {
    const omega = helm(b, dt, best);
    b.h = wrapAngle(b.h + omega * dt);
    turnLoss = 0.05 * Math.abs(omega) * dt;
  }
  const sideWas = b.side;
  readWind(b, wind.vx, wind.vy);
  if (!b.man && b.side !== sideWas && event === null) {
    // Steered through the wind: downwind that is a gybe and costs like one; upwind the boat went through irons.
    if (b.twa > 110) {
      const clean = b.v >= 0.85 * b.target && t - b.lastMan >= 6;
      b.v *= 1 - cls.gybe[clean ? 0 : 1];
      b.stats.tacks++;
      if (clean) b.stats.clean++;
      else b.stats.messy++;
      event = 'gybe';
    } else if (b.twa < 70) {
      b.stats.tacks++;
      b.stats.messy++;
      event = 'tack';
    }
    b.lastMan = t;
    b.holdTwa = null;
  }

  // Speed.
  const wasIrons = b.irons;
  b.irons = !b.man && b.twa < cls.nogo + 0.5;
  if (b.irons) {
    b.ironsT += dt;
    if (!wasIrons) event = event ?? 'irons';
  } else b.ironsT = 0;
  b.luff = b.man ? Math.max(0, 1 - Math.abs((b.man.t / b.man.dur) * 2 - 1) * 1.2) : b.irons ? 1 : Math.max(0, (cls.nogo + 6 - b.twa) / 6);
  let target = b.irons ? 0 : targetSpeed(cls, b.twa, wind.kn, b.hiking) * slow * b.trim;
  let tau = target > b.v ? cls.tauUp : cls.tauDown;
  if (b.irons) tau = 1.6; // the sail flogs: a boat head to wind stops in a couple of lengths
  if (b.penalty > 0) {
    b.penalty = Math.max(0, b.penalty - dt);
    target = 0;
    tau = 0.9;
  }
  if (b.grounded > 0) {
    b.grounded = Math.max(0, b.grounded - dt);
    target = 0;
    tau = 0.5;
  }
  if (b.groundImmune > 0) b.groundImmune = Math.max(0, b.groundImmune - dt);
  if (b.foulFlag > 0) b.foulFlag = Math.max(0, b.foulFlag - dt);
  b.target = b.irons ? targetSpeed(cls, Math.max(b.twa, best.up), wind.kn, b.hiking) : target;
  if (!b.man) {
    b.v += (target - b.v) * (1 - Math.exp(-dt / tau));
    b.v = Math.max(0, b.v * (1 - turnLoss));
  }
  // Heel, for the picture: overpowered boats heel, hiking flattens them.
  const over = overpowered(wind.kn, b.twa);
  const heelT = Math.min(1, over * (b.hiking ? 0.35 : 1) + 0.25 * Math.min(1, b.v / 6)) * (b.irons ? 0.2 : 1);
  b.heel += (heelT - b.heel) * Math.min(1, dt * 3);

  b.x += (Math.cos(b.h) * b.v + cur.vx) * dt;
  b.y += (Math.sin(b.h) * b.v + cur.vy) * dt;
  return event;
}

/**
 * The helm: a skipper steers to `aim`. A person turns at a rate, with a soft detent at the best upwind and downwind
 * angles: a turn that arrives there settles into the groove and follows the wind's shifts for as long as it is held.
 * A fresh press while already in the groove (or the stick pushed hard) goes past it. Let go while beating or running
 * and the boat keeps its angle to the wind; let go on a reach and it keeps its compass course.
 */
function helm(b, dt, best) {
  const max = turnRate(b);
  if (b.aim !== null && b.aim !== undefined) {
    const d = angDiff(b.h, b.aim);
    return Math.max(-max, Math.min(max, d / Math.max(dt, 0.15)));
  }
  const input = Math.max(-1, Math.min(1, b.steer || 0));
  if (Math.abs(input) < 0.05) {
    if (b.wasSteering) {
      b.wasSteering = false;
      b.holdTwa = !b.irons && (b.twa < 65 || b.twa > 125) ? b.twa : null;
    }
    b.groove = 0;
    if (b.holdTwa === null || b.irons) return 0;
    const want = headingFor(b.wx, b.wy, b.holdTwa, b.side);
    const d = angDiff(b.h, want);
    return Math.max(-max * 0.7, Math.min(max * 0.7, d / 0.25));
  }
  const dir = Math.sign(input);
  if (!b.wasSteering || dir !== b.pressDir) {
    b.wasSteering = true;
    b.pressDir = dir;
    b.pressTwa = b.twa; // where this press began: only a turn that arrives at the detent settles there
    b.groove = 0;
  }
  b.holdTwa = null;
  let omega = input * max;
  const upward = dir === b.side; // turning toward the wind
  const step = (Math.abs(omega) * dt) / DEG;
  if (b.push) b.groove = 0;
  else if (upward && b.groove !== 2 && b.pressTwa > best.up + 1 && b.twa - step <= best.up) b.groove = 1;
  else if (!upward && b.groove !== 1 && b.pressTwa < best.down - 1 && b.twa + step >= best.down) b.groove = 2;
  if (b.groove === 1) {
    // Turning up reduces the wind angle: steer so it lands on the best upwind angle, whichever way the wind moved.
    omega = b.side * Math.max(-max, Math.min(max, ((b.twa - best.up) * DEG) / Math.max(dt, 0.1)));
  } else if (b.groove === 2) {
    omega = -b.side * Math.max(-max, Math.min(max, ((best.down - b.twa) * DEG) / Math.max(dt, 0.1)));
  }
  return omega;
}
