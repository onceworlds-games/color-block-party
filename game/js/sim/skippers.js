// Rival skippers. They sail by the same polar, shadows and rules as everyone, and read the same deterministic wind,
// blurred by skill: slower reactions, noisier steering, a shorter look ahead, worse laylines and start timing.
// Personalities change the risks they take. They decide every 0.2 s and steer by setting a wanted heading.

import { headingFor, angDiff, wrapAngle } from './boat.js';
import { CLASSES, DEG, overpowered, targetSpeed, vmgAngles } from './polar.js';
import { rng, hash32 } from './rng.js';
import { collisionCourse, giveWay } from './rules.js';
import { inPolygon, inShoal } from './course.js';
import { windAt } from './wind.js';

export const SKILLS = [
  { id: 0, name: 'Deckhand', reaction: 0.5, noise: 4, look: 2, header: 12, confirm: 2, minLeg: 5, layErr: 14, startLate: 2.6, startErr: 1.6, angErr: 7, angBias: 4, trim: 0.8, respect: 0.7, hike: 0.3, clean: 0.3 },
  { id: 1, name: 'Mate', reaction: 0.35, noise: 3, look: 4, header: 8, confirm: 1.2, minLeg: 7, layErr: 8, startLate: 1.7, startErr: 0.9, angErr: 3.5, angBias: 2, trim: 0.91, respect: 0.88, hike: 0.6, clean: 0.65 },
  { id: 2, name: 'Skipper', reaction: 0.2, noise: 2, look: 7, header: 6, confirm: 0.8, minLeg: 8, layErr: 3.5, startLate: 1.0, startErr: 0.4, angErr: 1.5, angBias: 0.6, trim: 1, respect: 0.97, hike: 0.85, clean: 0.9 },
  { id: 3, name: 'Legend', reaction: 0.1, noise: 1, look: 10, header: 5, confirm: 0.5, minLeg: 8, layErr: 1.5, startLate: 0.65, startErr: 0.18, angErr: 0.5, angBias: 0, trim: 1, respect: 1, hike: 1, clean: 1 },
];

export const PERSONAS = {
  aggressive: { id: 'aggressive', name: 'Aggressive', cover: 0.85, pinch: -1.5, inset: 0, risk: 0.7, clearAir: 0.4, sideBias: 0 },
  cautious: { id: 'cautious', name: 'Cautious', cover: 0.15, pinch: 1.5, inset: 0.35, risk: 1.6, clearAir: 1, sideBias: 0 },
  gambler: { id: 'gambler', name: 'Gambler', cover: 0, pinch: 0, inset: 0.1, risk: 0.9, clearAir: 0.6, sideBias: 1 },
  textbook: { id: 'textbook', name: 'Textbook', cover: 0.5, pinch: 0, inset: 0.15, risk: 1.1, clearAir: 0.8, sideBias: 0 },
};
export const PERSONA_IDS = ['aggressive', 'cautious', 'gambler', 'textbook'];

/** Playful skipper names (never players'); a race draws its fleet's names from its seed. */
export const BOT_NAMES = [
  'Barnacle Bea', 'Old Tom Halyard', 'Captain Pip', 'Moira Mizzen', 'Salty Sven', 'Duffy Dory', 'Kit Cleat',
  'Nell Nautilus', 'Bosun Bob', 'Gus Gunwale', 'Rosie Reef', 'Finn Fathom', 'Mags Mainsheet', 'Ollie Outhaul',
  'Wren Windlass', 'Hattie Helm', 'Skip Scupper', 'Ned Bollard', 'Lulu Luff', 'Percy Port', 'Stella Starboard',
  'Jib Jameson', 'Tilly Tiller', 'Dot Davit', 'Morgan Mooring', 'Coral Keel', 'Iggy Isobar', 'Bess Beaufort',
];

/** A brain for a bot boat. */
export function makeBrain(seed, skill, persona) {
  const s = Math.max(0, Math.min(3, skill | 0));
  return {
    skill: s,
    persona: PERSONAS[persona] ? persona : 'textbook',
    r: rng(seed >>> 0),
    next: 0,
    phase: (seed % 1000) / 159,
    biasSign: (seed >>> 3) % 2 ? 1 : -1, // some skippers pinch, some sail too free
    startErr: 0,
    spot: null,
    layErr: 0,
    legPi: -1,
    duckUntil: 0,
    duckAim: 0,
    lastTackT: -99,
    lastCoverT: -99,
    shadowT: 0,
    hold: 1,
    hikeOn: false,
    ironsT: 0,
  };
}

const W = { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 };
const W2 = { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 };

/** Every bot that is due thinks; then all keep steering toward their wanted heading every step (the helm does that). */
export function thinkSkippers(race) {
  for (const b of race.boats) {
    if (!b.bot || b.remote || b.retired || b.finished) continue;
    const br = b.bot.brain;
    if (!br) continue;
    if (race.t < br.next) continue;
    br.next = race.t + 0.2;
    think(race, b, br);
  }
}

/** The wind a bot believes in: sampled a reaction time ago, looking ahead by its skill, with a steady personal error. */
function perceivedWind(race, b, br, x, y, out) {
  const sk = SKILLS[br.skill];
  const t0 = Math.max(0, race.t - sk.reaction);
  windAt(race.wind, x, y, t0, out);
  if (sk.look > 0) {
    windAt(race.wind, x, y, race.t + sk.look * 0.5, W2);
    // Blend in the forecast: better skippers trust it more.
    const k = 0.15 + 0.1 * br.skill;
    out.vx = out.vx * (1 - k) + W2.vx * k;
    out.vy = out.vy * (1 - k) + W2.vy * k;
  }
  // Skill blur: a slow wobble in how they read the direction.
  const err = sk.noise * 0.6 * Math.sin(race.t * 0.13 + br.phase * 3.1) * DEG;
  const c = Math.cos(err);
  const s = Math.sin(err);
  const vx = out.vx * c - out.vy * s;
  const vy = out.vx * s + out.vy * c;
  out.vx = vx;
  out.vy = vy;
  out.kn = Math.hypot(vx, vy) / 0.514;
  return out;
}

function think(race, b, br) {
  b.race = race;
  const sk = SKILLS[br.skill];
  const pe = PERSONAS[br.persona];
  const t = race.t;
  const cls = CLASSES[b.cls];
  const wind = perceivedWind(race, b, br, b.x, b.y, W);
  // The tactical read: the wind smoothed over a few seconds (quicker for better skippers).
  const k = 1 - Math.exp(-0.2 / (2 + (3 - br.skill)));
  if (br.ewx === undefined) {
    br.ewx = wind.vx;
    br.ewy = wind.vy;
  }
  br.ewx += (wind.vx - br.ewx) * k;
  br.ewy += (wind.vy - br.ewy) * k;
  // The mean wind over the last half-minute or so: shifts are measured against it.
  const km = 1 - Math.exp(-0.2 / 35);
  if (br.mwx === undefined) {
    br.mwx = wind.vx;
    br.mwy = wind.vy;
  }
  br.mwx += (wind.vx - br.mwx) * km;
  br.mwy += (wind.vy - br.mwy) * km;
  const best = vmgAngles(b.cls, Math.max(3, wind.kn * b.shadow));
  const from = Math.atan2(-wind.vy, -wind.vx);

  // Out of irons first (unless stopping there on purpose before the start): bear away, and tack if that fails.
  if (b.irons && !br.brake) {
    br.ironsT += 0.2;
    if (br.ironsT > 2 && !b.man) b.tackReq = true;
  } else br.ironsT = 0;
  br.brake = false;

  // Hiking: when overpowered or chasing speed in a gust, while the crew has something left.
  const over = overpowered(b.wkn, b.twa);
  const wants = over > 0.25 || (b.gusting && b.v < b.target * 0.97 && b.twa < 120);
  if (br.hikeOn) br.hikeOn = wants && b.stamina > 0.08;
  else br.hikeOn = wants && b.stamina > 0.55 - 0.3 * sk.hike && br.r.next() < sk.hike + 0.2;
  b.hikeReq = br.hikeOn;

  let aim;
  if (t < race.gunT) aim = preStart(race, b, br, sk, pe, wind, best, from);
  else if (b.ocs) aim = headingFor(wind.vx, wind.vy, 150, b.side); // back below the line: bear away and run down
  else aim = sail(race, b, br, sk, pe, wind, best, from);

  // Keep clear: give way to boats with rights, and don't sail into anyone from behind.
  aim = avoid(race, b, br, sk, aim, wind, best, from);
  // A steady hand, or not.
  const wob = sk.noise * Math.sin(t * 0.9 + br.phase) * DEG;
  b.aim = wrapAngle(aim + wob);
  // Never steer into the no-go zone by accident.
  const rel = angDiff(from, b.aim);
  const twaAim = Math.abs(rel) / DEG;
  if (br.brake) {
    // Stopping on purpose: luffing or head to wind, never a change of tack.
  } else if (twaAim < cls.nogo + 1 && !b.man) b.aim = headingFor(wind.vx, wind.vy, cls.nogo + 1.5, b.side);
  // A wanted heading on the other tack: change tack with a manoeuvre, never by steering through the wind.
  else if (!b.man && !b.tackReq && twaAim > cls.nogo + 1 && twaAim < 174 && -Math.sign(rel) !== b.side) b.tackReq = true;
}

const clampLine = (race, x) => Math.max(-race.course.halfLine + 4, Math.min(race.course.halfLine - 4, x));

/**
 * Heading to a point. When the point is upwind (or dead downwind) the course is close-hauled (or deep) on whichever tack
 * points nearer it, keeping the current tack unless the other is clearly better.
 */
function toPoint(b, p, wind, best, from) {
  const brg = Math.atan2(p.y - b.y, p.x - b.x);
  const off = Math.abs(angDiff(from, brg)) / DEG;
  let angle = 0;
  if (off < best.up) angle = best.up;
  else if (off > best.down + 4) angle = best.down;
  else return brg;
  const cur = headingFor(wind.vx, wind.vy, angle, b.side);
  const other = headingFor(wind.vx, wind.vy, angle, -b.side);
  const dc = Math.abs(angDiff(cur, brg));
  const doo = Math.abs(angDiff(other, brg));
  return doo < dc - 12 * DEG ? other : cur;
}

// ------------------------------------------------------------------------------------------------- the start

/**
 * The start: pick a spot on the line (the favoured end, spread out by personality and by who else went there), loiter
 * below it, run in to a set-up point two lengths below the line, sit there luffing, and go at full speed so the bow
 * reaches the line as the gun fires. Timing errors grow as skill falls.
 */
function preStart(race, b, br, sk, pe, wind, best, from) {
  const tl = race.gunT - race.t; // time left
  if (!br.spot) planStart(race);
  if (!br.spot) return toPoint(b, { x: b.x, y: 30 }, wind, best, from);
  const home = br.home;
  br.mode = 'below';
  if (b.y < 1.5) return headingFor(wind.vx, wind.vy, 150, b.side); // over the line early: bear away back below
  // The run: up the starboard close-hauled line into the slot. Go when the time it takes (turning, accelerating)
  // meets the clock, a little late by design; once going, luff when early, stop dead if the bow would be over.
  if (!br.going) br.runSide = 0; // the run's side is only remembered once under way
  const runH = startHeading(race, b, wind, best);
  const need = timeToLine(b, runH, best);
  const slack = tl + br.startErr - need;
  if (need < 99 && (br.going || slack <= 0)) {
    br.going = true;
    br.mode = 'go';
    if (tl > 0.2 && slack > 0.3 + 0.2 * (3 - br.skill) && br.r.next() < sk.respect) {
      if (b.y - 2.4 < 1.2 + b.v * 1.7) return brake(br, wind, b, 10);
      return brake(br, wind, b, CLASSES[b.cls].nogo + 3);
    }
    return runH;
  }
  // Until then: loops in the lane (a port reach out, a gybe, a starboard close reach back), and a wait at home.
  br.mode = 'home';
  const dH = Math.hypot(home.x - b.x, home.y - b.y);
  const t = race.t;
  if (br.loopOut > t) return headingFor(wind.vx, wind.vy, 125, -1);
  if (br.held && t > br.loopAt && tl > need + 14 && dH < 6 && !crowded(race, b, 12)) {
    br.loopOut = t + 2.5 + br.r.next() * 1.5;
    br.loopAt = t + 14 + br.r.next() * 8;
    br.held = false;
    return headingFor(wind.vx, wind.vy, 125, -1);
  }
  if (br.held || dH < 1.2 + b.v * 1.7) {
    br.held = dH < 8;
    if (br.held) return brake(br, wind, b, 10, 1); // bow just to starboard of the wind: ready to go on starboard
  }
  if (b.v > 1 + dH / 1.8 && dH < 16) return brake(br, wind, b, CLASSES[b.cls].nogo + 1);
  return toPoint(b, home, wind, best, from);
}

/** Seconds for this boat to put its bow on the start line on heading h: turn there, then accelerate along it. */
export function timeToLine(b, h, best) {
  const sy = Math.sin(h);
  if (sy > -0.25) return 99;
  const L = Math.max(0, b.y / -sy - 2.2); // the bow is 2.2 m ahead of the centre
  const cls = CLASSES[b.cls];
  const twa = Math.abs(angDiff(Math.atan2(-b.wy, -b.wx), h)) / DEG;
  const T = Math.max(0.5, targetSpeed(cls, Math.max(twa, cls.nogo + 1), b.wkn || 10, false));
  const turnDeg = Math.abs(angDiff(b.h, h)) / DEG;
  // A run on the other tack needs a tack first (unless the boat is head to wind and can just fall off).
  const hSide = -Math.sign(angDiff(Math.atan2(-b.wy, -b.wx), h)) || 1;
  const extra = hSide !== b.side && b.twa > cls.nogo ? 2.5 : 0;
  const turn = turnDeg / (Math.max(25, 50 - 25 * Math.min(1, b.v / 5)) * cls.turn);
  let v = b.v * (1 - 0.05 * turnDeg * DEG);
  let x = v * turn * Math.cos(Math.min(Math.PI / 2, turnDeg * DEG * 0.5));
  let t = turn;
  const kUp = 1 - Math.exp(-0.05 / cls.tauUp);
  const kDn = 1 - Math.exp(-0.05 / cls.tauDown);
  while (x < L && t < 40) {
    v += (T - v) * (T > v ? kUp : kDn);
    x += v * 0.05;
    t += 0.05;
  }
  return t + extra;
}

/**
 * The fleet's start plan, made once: the line is cut into slots a boat-and-a-half apart; each bot (best skippers
 * first) takes the free slot nearest the end it likes, so the run-in is a row of boats, not a pile-up.
 */
function planStart(race) {
  const c = race.course;
  windAt(race.wind, 0, 0, race.gunT, W2);
  const favRight = -W2.vx >= 0; // the wind comes from the right: the committee (right) end is further upwind
  const bots = race.boats.filter((o) => o.bot?.brain && !o.remote).sort((p, q) => q.bot.brain.skill - p.bot.brain.skill || (p.id < q.id ? -1 : 1));
  // Slots far enough apart that two starboard runs side by side don't touch.
  const gap = Math.max(8.5, (2 * c.halfLine - 8) / Math.max(1, race.boats.length));
  const slots = [];
  for (let x = -c.halfLine + 4; x <= c.halfLine - 4 + 0.01; x += gap) slots.push({ x, taken: false });
  const s55 = Math.sin(55 * DEG);
  const c55 = Math.cos(55 * DEG);
  bots.forEach((o, i) => {
    const br = o.bot.brain;
    const sk = SKILLS[br.skill];
    const pe = PERSONAS[br.persona];
    // Lesser skippers misjudge the favoured end now and then.
    const right = br.r.next() < 0.12 * (3 - br.skill) ? !favRight : favRight;
    const end = right ? c.halfLine - 4 : -c.halfLine + 4;
    const want = end + (right ? -1 : 1) * (pe.inset * c.halfLine * 1.2 + br.r.next() * 4);
    let pick = null;
    for (const sl of slots) if (!sl.taken && (!pick || Math.abs(sl.x - want) < Math.abs(pick.x - want))) pick = sl;
    if (!pick) pick = { x: want + (br.r.next() - 0.5) * 6 };
    pick.taken = true;
    br.spot = { x: pick.x, y: 0 };
    br.burnUntil = 0;
    br.loopOut = 0;
    br.loopAt = 4 + br.r.next() * 10;
    // Home: back down a starboard close reach that ends in the slot (still fetchable after a header), staggered so
    // neighbours aren't abreast.
    const back = 26 + (i % 3) * 9;
    br.home = { x: pick.x + s55 * back, y: c55 * back };
    const g = (br.r.next() + br.r.next() + br.r.next() - 1.5) * 2; // roughly normal, sd ~1
    br.startErr = sk.startLate * pe.risk + g * sk.startErr;
  });
}

/**
 * The course for the line at the gun: straight at the slot when it can be reached on starboard, else close-hauled on
 * starboard if that crosses between the ends, else on port. Sticky: the side chosen stays chosen while it still works.
 */
function startHeading(race, b, wind, best) {
  const half = race.course.halfLine;
  const br = b.bot.brain;
  const from = Math.atan2(-wind.vy, -wind.vx);
  const spot = br.spot;
  const brg = Math.atan2(spot.y - 1 - b.y, spot.x - b.x);
  const rel = angDiff(from, brg); // < 0: the slot lies to the left of the wind's eye (a starboard course)
  if (br.runSide !== -1 && rel < -(best.up + 1) * DEG && rel > -100 * DEG) {
    br.runSide = 1;
    return brg;
  }
  const cross = (side) => {
    const h = headingFor(wind.vx, wind.vy, best.up, side);
    const sy = Math.sin(h);
    if (sy >= -0.05) return { h };
    return { h, xc: b.x + (Math.cos(h) * -b.y) / sy };
  };
  if (br.runSide) {
    const c = cross(br.runSide);
    if (c.xc !== undefined && Math.abs(c.xc) < half + 3) return c.h;
  }
  for (const side of [1, -1]) {
    const c = cross(side);
    if (c.xc !== undefined && Math.abs(c.xc) < half - 0.5) {
      br.runSide = side;
      return c.h;
    }
  }
  br.runSide = 0;
  return Math.atan2(-6 - b.y, -b.x * 0.5);
}

/** Is any other boat within `r` metres? */
function crowded(race, b, r) {
  for (const o of race.boats) {
    if (o === b || o.finished || o.retired || o.ghost) continue;
    const dx = o.x - b.x;
    const dy = o.y - b.y;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Stopping on purpose: head up to a wind angle (just luffing, or right into the wind to stop dead). */
function brake(br, wind, b, twa, side = b.side) {
  br.brake = true;
  return headingFor(wind.vx, wind.vy, twa, side);
}

const cls_nogo = (b) => CLASSES[b.cls].nogo;

// ------------------------------------------------------------------------------------------------- racing

function sail(race, b, br, sk, pe, wind, best, from) {
  const c = race.course;
  if (b.pi === 0) {
    // Not started yet: across the line between the ends, from below (a boat that got above it some other way, round
    // an end, goes back below first).
    if (b.track.side > 0) return headingFor(wind.vx, wind.vy, 150, b.side);
    return toPoint(b, { x: clampLine(race, b.x), y: -8 }, wind, best, from);
  }
  const tg = c.targets[b.pi];
  if (br.legPi !== b.pi) {
    br.legPi = b.pi;
    br.layErr = (br.r.next() - 0.35) * sk.layErr;
    br.headT = 0;
  }
  const P = routeAround(race, b, aimPoint(b, tg));
  const brg = Math.atan2(P.y - b.y, P.x - b.x);
  const offA = Math.abs(angDiff(from, brg)) / DEG;
  const dist = Math.hypot(P.x - b.x, P.y - b.y);
  if (offA < best.up + 1.5) return beat(race, b, br, sk, pe, wind, best, P, dist);
  if (offA > best.down - 2 && dist > 12) return run(race, b, br, sk, pe, wind, best, P, dist);
  return brg;
}

/**
 * Where to steer for a target. A mark: from the side a correct rounding starts on, alongside it and then across its
 * rounding ray; from the wrong side, round the back of it first (and unwind a wrong rounding the same way).
 * A gate or a line: the nearest part of it, kept off the ends.
 */
function aimPoint(b, tg) {
  if (tg.type === 'mark') {
    const nx = -tg.ry; // +1 side of the rounding ray
    const ny = tg.rx;
    const app = tg.side === 'port' ? 1 : -1; // the side a correct rounding starts from
    const dx = b.x - tg.x;
    const dy = b.y - tg.y;
    const side = Math.sign(dx * nx + dy * ny) || app;
    const along = dx * tg.rx + dy * tg.ry;
    if (side === app || b.wind < 0) {
      if (along < -6) return { x: tg.x + nx * app * 7 - tg.rx * 2, y: tg.y + ny * app * 7 - tg.ry * 2 };
      return { x: tg.x + tg.rx * 7, y: tg.y + tg.ry * 7 };
    }
    // Wrong side: go round behind the mark to the side the rounding starts from.
    if (along > -4) return { x: tg.x - tg.rx * 9 + nx * app * 3, y: tg.y - tg.ry * 9 + ny * app * 3 };
    return { x: tg.x + nx * app * 7 - tg.rx * 2, y: tg.y + ny * app * 7 - tg.ry * 2 };
  }
  const lx = tg.x2 - tg.x1;
  const ly = tg.y2 - tg.y1;
  const l2 = lx * lx + ly * ly || 1;
  const len = Math.sqrt(l2);
  let k = ((b.x - tg.x1) * lx + (b.y - tg.y1) * ly) / l2;
  const pad = Math.min(0.45, 3.5 / len);
  k = Math.max(pad, Math.min(1 - pad, k));
  return { x: tg.x1 + lx * k + tg.fx * 3, y: tg.y1 + ly * k + tg.fy * 3 };
}

/**
 * Upwind. Laylines from the smoothed wind; tack on a header that lasts (the other tack points nearer the mark by more
 * than the skipper's threshold, for their confirm time, once the last leg was long enough); tack for clear air, to
 * cover, or before an obstacle.
 */
function beat(race, b, br, sk, pe, wind, best, P, dist) {
  const t = race.t;
  const up = Math.max(CLASSES[b.cls].nogo + 3, best.up + pe.pinch + angleError(br, t));
  const cur = b.side;
  const curH = headingFor(wind.vx, wind.vy, up, cur);
  if (b.man) return curH;
  const since = t - br.lastTackT;
  const clean = t - b.lastMan >= 6.2 && b.v >= b.target * 0.86;
  const ready = since > sk.minLeg && (clean || br.r.next() > sk.clean);
  const fromE = Math.atan2(-br.ewy, -br.ewx);
  const brgP = Math.atan2(P.y - b.y, P.x - b.x);
  const offE = angDiff(fromE, brgP) / DEG; // + : the point lies to the right of the wind's eye
  const lay = up + br.layErr;
  if ((cur > 0 ? offE >= lay : offE <= -lay) && since > 3) return doTack(b, br, t, wind, up, true);
  // Fetching: steer straight for it (or close-hauled if it is just above).
  if (cur > 0 ? offE <= -(lay - 1) : offE >= lay - 1) return toPoint(b, P, wind, best, Math.atan2(-wind.vy, -wind.vx));
  const curOff = Math.abs(angDiff(headingFor(br.ewx, br.ewy, up, cur), brgP)) / DEG;
  const otherOff = Math.abs(angDiff(headingFor(br.ewx, br.ewy, up, -cur), brgP)) / DEG;
  // Headed against the mean wind (a veer heads starboard tack, a back heads port), for long enough: tack.
  const headed = shiftOf(br) * cur;
  if (headed > sk.header) br.headT += 0.2;
  else br.headT = 0;
  if (ready && br.headT >= sk.confirm && otherOff < curOff + 8) return doTack(b, br, t, wind, up);
  // Too far out to one side (the mark well round on the other tack): come back toward the middle.
  const cone = 22 + pe.risk * 6 + (pe.sideBias ? 12 : 0);
  if (ready && (cur > 0 ? offE > cone : offE < -cone) && dist > 30) return doTack(b, br, t, wind, up);
  if (since > 2.5 && blocked(race, b, curH, 10 + b.v * 3)) return doTack(b, br, t, wind, up, true);
  // Dirty air: tack away when it lasts.
  if (b.shadow < 0.86) br.shadowT += 0.2;
  else br.shadowT = Math.max(0, br.shadowT - 0.4);
  if (ready && br.shadowT > 3 / pe.clearAir && otherOff < curOff + 25) {
    br.shadowT = 0;
    return doTack(b, br, t, wind, up);
  }
  // Cover: stay between the nearest rival behind and the mark.
  if (pe.cover > 0 && ready && t - br.lastCoverT > 12 && dist > 45) {
    const rival = nearestRivalBehind(race, b);
    if (rival && rival.side !== cur && br.r.next() < pe.cover * (0.3 + 0.2 * br.skill)) {
      br.lastCoverT = t;
      if (otherOff < curOff + 15) return doTack(b, br, t, wind, up);
    }
  }
  // A gambler goes looking for pressure.
  if (pe.sideBias && ready && dist > 60 && br.r.next() < 0.03) {
    const sideP = pressureSide(race, b);
    if (sideP !== 0 && sideP !== (cur > 0 ? -1 : 1) && otherOff < curOff + 30) return doTack(b, br, t, wind, up);
  }
  return curH;
}

/** Downwind: the same thinking with gybes, on the downwind laylines. */
function run(race, b, br, sk, pe, wind, best, P, dist) {
  const t = race.t;
  const down = Math.min(178, best.down + Math.abs(angleError(br, t)) * 1.6);
  const cur = b.side;
  const curH = headingFor(wind.vx, wind.vy, down, cur);
  if (b.man) return curH;
  const since = t - br.lastTackT;
  const ready = since > sk.minLeg * 1.2;
  const fromE = Math.atan2(-br.ewy, -br.ewx);
  const brgP = Math.atan2(P.y - b.y, P.x - b.x);
  const offE = angDiff(fromE, brgP) / DEG; // +: right of the wind's eye, so the mark lies right of dead downwind
  const offDown = 180 - Math.abs(offE); // 0: dead downwind
  const lay = 180 - down + br.layErr * 0.5;
  const markRight = offE > 0;
  // Starboard tack (wind over the right side) runs down to the left; port to the right.
  const onFavoured = cur > 0 ? !markRight : markRight;
  if (!onFavoured && offDown >= lay && since > 3) return doTack(b, br, t, wind, down, true);
  if (onFavoured && offDown >= lay - 1) return toPoint(b, P, wind, best, Math.atan2(-wind.vy, -wind.vx));
  // Downwind a veer helps starboard and a back helps port: gybe when the current gybe is the one that lost out.
  const lifted = -shiftOf(br) * cur;
  if (lifted > sk.header * 1.3) br.headT += 0.2;
  else br.headT = 0;
  if (ready && br.headT >= sk.confirm * 1.5) return doTack(b, br, t, wind, down);
  if (ready && offDown > 180 - down - 8 && !onFavoured && dist > 30) return doTack(b, br, t, wind, down);
  if (since > 2.5 && blocked(race, b, curH, 10 + b.v * 3)) return doTack(b, br, t, wind, down, true);
  return curH;
}

/** How far off the best angle this skipper sails right now (degrees): a slow drift plus a habit. */
function angleError(br, t) {
  const sk = SKILLS[br.skill];
  return sk.angErr * Math.sin(t * 0.07 + br.phase * 2.3) + sk.angBias * br.biasSign;
}

/** How far (degrees) the smoothed wind has turned from the mean: + is a veer (clockwise on the chart). */
function shiftOf(br) {
  const a = Math.atan2(br.ewy, br.ewx);
  const m = Math.atan2(br.mwy, br.mwx);
  return angDiff(m, a) / DEG;
}

/** Tack (or gybe) onto the other side, if that is clear of other boats; `force` waits at most a couple of seconds. */
function doTack(b, br, t, wind, angle, force = false) {
  const h = headingFor(wind.vx, wind.vy, angle, -b.side);
  if (!tackSafe(b.race, b, h)) {
    if (!force || t - (br.waitT ?? t) < 4) {
      br.waitT = br.waitT ?? t;
      return headingFor(wind.vx, wind.vy, angle, b.side);
    }
  }
  br.waitT = null;
  br.lastTackT = t;
  br.headT = 0;
  b.tackReq = true;
  return h;
}

/** The course's islands and shoals as circles to steer round (centre, radius with a margin). */
function obstaclesOf(race) {
  if (race._obst) return race._obst;
  const c = race.course;
  race._obst = [
    ...c.islands.map((il) => ({ x: il.x, y: il.y, r: il.rr + 6 })),
    ...c.shoals.map((sh) => ({ x: sh.x, y: sh.y, r: Math.max(sh.rx, sh.ry) + 5 })),
  ];
  return race._obst;
}

/** Does the segment a -> b pass through a circle? */
function segHitsCircle(ax, ay, bx, by, o) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / l2));
  const px = ax + dx * t - o.x;
  const py = ay + dy * t - o.y;
  return px * px + py * py < o.r * o.r;
}

/**
 * The way to a point round any island or shoal in between: the point itself when the way is clear, else the best
 * waypoint on a ring round the obstacle (shortest total way with a clear first leg).
 */
function routeAround(race, b, P) {
  const obs = obstaclesOf(race);
  if (!obs.length) return P;
  const blocking = obs.filter((o) => segHitsCircle(b.x, b.y, P.x, P.y, o));
  if (!blocking.length) return P;
  let best = null;
  let bestCost = Infinity;
  for (const o of blocking) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const W = { x: o.x + Math.cos(a) * (o.r + 3), y: o.y + Math.sin(a) * (o.r + 3) };
      if (obs.some((q) => (W.x - q.x) ** 2 + (W.y - q.y) ** 2 < q.r * q.r)) continue;
      if (obs.some((q) => segHitsCircle(b.x, b.y, W.x, W.y, q))) continue;
      const second = obs.some((q) => segHitsCircle(W.x, W.y, P.x, P.y, q)) ? 60 : 0;
      const cost = Math.hypot(W.x - b.x, W.y - b.y) + Math.hypot(P.x - W.x, P.y - W.y) + second;
      if (cost < bestCost) {
        bestCost = cost;
        best = W;
      }
    }
  }
  return best ?? P;
}

/** Would sailing `h` for `ahead` metres leave the course or run aground? */
function blocked(race, b, h, ahead) {
  const c = race.course;
  const x = b.x + Math.cos(h) * ahead;
  const y = b.y + Math.sin(h) * ahead;
  const B = c.bounds;
  if (x < B.x0 + 6 || x > B.x1 - 6 || y < B.y0 + 6 || y > B.y1 - 4) return true;
  for (const il of c.islands) {
    const dx = x - il.x;
    const dy = y - il.y;
    if (dx * dx + dy * dy < (il.rr + 4) ** 2 && (inPolygon(il.poly, x, y) || Math.hypot(dx, dy) < il.sr + 3)) return true;
  }
  for (const s of c.shoals) if (inShoal(s, x, y)) return true;
  return false;
}

/** +1 if the right of the course has more wind ahead, -1 the left, 0 even (sampled where the boat could be soon). */
function pressureSide(race, b) {
  const t = race.t + 6;
  windAt(race.wind, b.x + 30, b.y - 20, t, W2);
  const r = W2.kn;
  windAt(race.wind, b.x - 30, b.y - 20, t, W2);
  const l = W2.kn;
  if (Math.abs(r - l) < 0.4) return 0;
  return r > l ? 1 : -1;
}

function nearestRivalBehind(race, b) {
  let best = null;
  let bd = 45 * 45;
  for (const o of race.boats) {
    if (o === b || o.finished || o.retired || o.pi !== b.pi) continue;
    const dx = o.x - b.x;
    const dy = o.y - b.y;
    const d2 = dx * dx + dy * dy;
    // Behind on a beat = further downwind (larger y on this chart).
    if (d2 < bd && dy > 4) {
      bd = d2;
      best = o;
    }
  }
  return best;
}

/**
 * Give way: when a meeting with a boat that has the right of way is coming (any boat, under casual rules), find the
 * smallest change of course that passes clear of it (bearing away first, then heading up), checking the new course
 * against everyone close; if nothing works, luff and stop. Returns the corrected heading.
 */
function avoid(race, b, br, sk, aim, wind, best, from) {
  const t = race.t;
  if (br.brake && b.v < 1.2) return aim; // stopped on purpose: hold still and let boats under way keep clear
  if (t < br.duckUntil) return br.duckAim;
  let threat = null;
  let soonest = Infinity;
  for (const o of race.boats) {
    if (o === b || o.finished || o.retired || o.parked || o.ghost) continue;
    const dx = o.x - b.x;
    const dy = o.y - b.y;
    if (dx * dx + dy * dy > 34 * 34) continue;
    const cc = collisionCourse(b, o, 4.5, t);
    // Close and closing (boats sailing side by side, a length apart, are fine).
    const rvx = Math.cos(o.h) * o.v - Math.cos(b.h) * b.v;
    const rvy = Math.sin(o.h) * o.v - Math.sin(b.h) * b.v;
    const near = dx * dx + dy * dy < 6 * 6 && dx * rvx + dy * rvy < -0.3;
    if (!cc && !near) continue;
    const gw = cc ? cc.giveWay : giveWay(b, o, t);
    const mustAvoid = race.rules !== 'racing' || gw === b || gw === null;
    const when = cc ? cc.t : 4;
    if (mustAvoid && when < soonest) {
      soonest = when;
      threat = o;
    }
  }
  // Marks (and the committee boat) are obstacles too: under racing rules touching one is a foul.
  if (!threat && clearance(race, b, b.h, true) < 3.2) threat = 'mark';
  if (!threat || br.r.next() > sk.respect) return aim; // a Deckhand doesn't always look
  const cls = CLASSES[b.cls];
  const away = -b.side; // turning this way bears away from the wind
  let bestH = null;
  let bestC = -1;
  for (let k = 1; k <= 12; k++) {
    for (const dir of [away, -away]) {
      const h = wrapAngle(b.h + dir * k * 6 * DEG);
      const twa = Math.abs(angDiff(from, h)) / DEG;
      if (twa < cls.nogo + 1.5 || -Math.sign(angDiff(from, h)) !== b.side) continue; // no tacking by the helm
      const c = clearance(race, b, h);
      if (c >= 0) {
        b.tackReq = false;
        br.duckUntil = t + 0.8;
        br.duckAim = h;
        return h;
      }
      if (c > bestC) {
        bestC = c;
        bestH = h;
      }
    }
  }
  b.tackReq = false;
  if (bestH !== null && bestC >= -2.5) {
    br.duckUntil = t + 0.6;
    br.duckAim = bestH;
    return bestH;
  }
  br.duckUntil = t + 0.6;
  br.duckAim = headingFor(wind.vx, wind.vy, 12, b.side); // nothing clears: stop, head to wind
  br.brake = true;
  return br.duckAim;
}

/**
 * How well a heading keeps clear over the next 4.5 s: the worst, over every boat close by, of (closest approach minus
 * what is wanted), where the wanted gap is 7.5 m, or the present gap for a boat already closer (never closer than
 * now, never under 4.9 m). >= 0 is clear. Marks, gate buoys, the committee boat and the pin count as standing
 * obstacles wanted 3.5 m off. `marksOnly` returns the closest approach to those alone (m).
 */
function clearance(race, b, h, marksOnly = false) {
  const sp = Math.max(1.5, b.v);
  const vx = Math.cos(h) * sp;
  const vy = Math.sin(h) * sp;
  let worst = Infinity;
  let postMin = Infinity;
  const c = race.course;
  const post = (px, py) => {
    const rx = px - b.x;
    const ry = py - b.y;
    if (rx * rx + ry * ry > 20 * 20) return;
    const tc = Math.max(0, Math.min(2.5, (rx * vx + ry * vy) / (sp * sp)));
    const d = Math.hypot(rx - vx * tc, ry - vy * tc);
    postMin = Math.min(postMin, d);
    worst = Math.min(worst, d - 3.5);
  };
  const tg = c.targets[b.pi];
  if (tg && tg.type === 'mark') post(tg.x, tg.y);
  else if (tg && tg.x1 !== undefined) {
    post(tg.x1, tg.y1);
    post(tg.x2, tg.y2);
  }
  if (race.t < race.gunT + 30) {
    post(c.committee.x, c.committee.y);
    post(c.pin.x, c.pin.y);
  }
  if (marksOnly) return postMin;
  for (const o of race.boats) {
    if (o === b || o.finished || o.retired || o.parked || o.ghost) continue;
    const rx = o.x - b.x;
    const ry = o.y - b.y;
    const now = Math.sqrt(rx * rx + ry * ry);
    if (now > 34) continue;
    const ovx = Math.cos(o.h) * o.v - vx;
    const ovy = Math.sin(o.h) * o.v - vy;
    const vv = ovx * ovx + ovy * ovy;
    const tc = vv < 1e-6 ? 0 : Math.max(0, Math.min(4.5, -(rx * ovx + ry * ovy) / vv));
    const closest = Math.hypot(rx + ovx * tc, ry + ovy * tc);
    worst = Math.min(worst, closest - Math.min(7.5, Math.max(4.9, now)));
  }
  return worst;
}

/** Would tacking (or gybing) onto heading `h` now run into anyone in the next few seconds? */
function tackSafe(race, b, h, except = null) {
  const vx = Math.cos(h) * b.v * 0.7;
  const vy = Math.sin(h) * b.v * 0.7;
  for (const o of race.boats) {
    if (o === b || o === except || o.finished || o.retired || o.parked || o.ghost) continue;
    const rx = o.x - b.x;
    const ry = o.y - b.y;
    if (rx * rx + ry * ry > 22 * 22) continue;
    const ovx = Math.cos(o.h) * o.v - vx;
    const ovy = Math.sin(o.h) * o.v - vy;
    const vv = ovx * ovx + ovy * ovy;
    const tc = vv < 1e-6 ? 0 : Math.max(0, Math.min(3.5, -(rx * ovx + ry * ovy) / vv));
    const cx = rx + ovx * tc;
    const cy = ry + ovy * tc;
    if (cx * cx + cy * cy < 7 * 7) return false;
  }
  return true;
}

/**
 * Puts the race's skippers where they mean to start from: the fleet's start plan is made and every bot begins in its
 * own lane, at its home point, head to wind. (People start in the starting box.)
 */
export function placeFleet(race) {
  planStart(race);
  for (const b of race.boats) {
    const br = b.bot?.brain;
    if (!br?.home || b.remote) continue;
    windAt(race.wind, br.home.x, br.home.y, 0, W2);
    b.x = b.px = br.home.x;
    b.y = b.py = br.home.y;
    b.h = b.ph = headingFor(W2.vx, W2.vy, 12, 1);
    b.v = 0;
    br.held = true;
  }
}

/** Fills a race with bots: `count` of them at the given skills (list) and seeded personalities and names. */
export function botEntries(seed, count, skills, clsFor = () => 'dinghy') {
  const names = BOT_NAMES.slice();
  const r = rng(hash32(seed >>> 0, 77));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const skill = skills[i % skills.length];
    const persona = PERSONA_IDS[Math.floor(r.next() * PERSONA_IDS.length)];
    out.push({ id: `bot${i + 1}`, name: names[i % names.length], cls: clsFor(i), bot: { skill, persona, trim: SKILLS[skill].trim, brain: makeBrain(hash32(seed, i, 5), skill, persona) } });
  }
  return out;
}
