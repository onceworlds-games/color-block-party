// A race: the course, the wind, the boats and the race officer. One fixed step moves every boat this page simulates;
// boats drawn from the network (remote) only cast shadows and take up room. Pure: no DOM, no clock of its own.

import { BOAT_R, makeBoat, stepBoat, angDiff } from './boat.js';
import { buildCourse, courseDef, courseScale, crossingStep, currentAt, distanceToGo, inPolygon, inShoal, nearestOnPolygon, startSide } from './course.js';
import { DEG, KN } from './polar.js';
import { resolveContacts } from './rules.js';
import { shadowFactor } from './shadow.js';
import { baseKnFor, makeWind, windAt } from './wind.js';

export const SIM_DT = 1 / 30;
export const HORNS = [60, 30, 10, 5, 4, 3, 2, 1];

/**
 * A new race.
 *  seed, courseId (1-12), laps, weather ('light'... 'classic'), rules ('casual' | 'racing'), preStart (s),
 *  entries: [{ id, cls, name, bot }] in slot order. trial: true for a time trial (no shadows, no contact).
 */
export function makeRace(o) {
  const seed = o.seed >>> 0;
  const weather = o.weather ?? 'moderate';
  const def = courseDef(o.courseId);
  const baseKn = baseKnFor(seed, weather);
  const fleet = Math.max(1, o.entries?.length ?? 1);
  const course = buildCourse(def, { laps: o.laps ?? 2, fleet, scale: courseScale(def, baseKn) });
  course.currentMul = Math.max(0.5, Math.min(1, baseKn / 12));
  const preStart = o.preStart ?? 60;
  const raceLen = course.total / 2.7 + 20;
  const wind = makeWind(seed, weather, course.bounds, preStart + raceLen);
  const race = {
    seed,
    mode: o.mode ?? 'fleet',
    rules: o.rules === 'racing' ? 'racing' : 'casual',
    weather,
    course,
    wind,
    boats: [],
    byId: new Map(),
    t: 0,
    gunT: preStart,
    phase: 'pre',
    events: [],
    contacts: new Map(),
    finishers: 0,
    firstFinishT: null,
    endT: null,
    hardLimit: preStart + Math.max(480, raceLen * 3.2),
    closeAfter: o.closeAfter ?? null, // seconds the finish stays open after the winner (default: 30% of the winner's time, at least 60)
    noShadows: !!o.trial,
    noCollisions: !!o.trial,
    trial: !!o.trial,
    hornNext: 0,
    gunFired: false,
    // Scratch records (no allocation per step).
    _w: { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 },
    _we: { vx: 0, vy: 0, kn: 0 },
    _cur: { vx: 0, vy: 0 },
    _near: { x: 0, y: 0, d: 0 },
  };
  for (const il of course.islands) il.wind = { vx: 0, vy: 0 };
  (o.entries ?? []).forEach((e, i) => addBoat(race, e, i));
  return race;
}

/** The starting box: two staggered rows below the line, every boat on starboard tack, close-reaching. */
export function spawnPoint(race, slot) {
  const half = race.course.halfLine;
  const row = Math.floor(slot / 5);
  const col = slot % 5;
  const span = Math.max(40, Math.min(half * 2.2, 90));
  const x = -span / 2 + (col + (row % 2) * 0.5 + 0.25) * (span / 5);
  const y = 30 + row * 12;
  return { x, y, h: -Math.PI / 2 - 65 * DEG };
}

export function addBoat(race, e, slot = race.boats.length) {
  const p = spawnPoint(race, slot);
  const b = makeBoat(e.id, e.cls ?? 'dinghy', p.x, p.y, p.h);
  b.name = e.name ?? '';
  b.bot = e.bot ?? null;
  if (b.bot) b.trim = b.bot.trim ?? 1;
  b.slot = slot;
  b.remote = !!e.remote;
  b.ghost = !!e.ghost || race.trial;
  b.v = 1.2;
  race.boats.push(b);
  race.byId.set(b.id, b);
  return b;
}

/** Race time: seconds since the gun (negative before it). */
export const raceTime = (race) => race.t - race.gunT;

/** Is this boat still racing (on the water, not finished, not retired)? */
export function racing(b) {
  return !b.finished && !b.retired;
}

const SHADOW_STEAL = 0.15;

/** One fixed step of everything this page simulates. Events for the picture and the sound go to race.events. */
export function stepRace(race, dt = SIM_DT) {
  const ev = race.events;
  const prevT = race.t;
  race.t += dt;
  const t = race.t;
  // The race officer: horns at 60, 30, 10 and 5-4-3-2-1, then the gun.
  while (race.hornNext < HORNS.length && t >= race.gunT - HORNS[race.hornNext]) {
    if (prevT < race.gunT - HORNS[race.hornNext] + 0.5) ev.push({ type: 'horn', n: HORNS[race.hornNext] });
    race.hornNext++;
  }
  const w = race.wind;
  const raw = race._w;
  // The air everywhere a sail is (shadows need every boat's wind, near or far, simulated here or not).
  for (const b of race.boats) {
    windAt(w, b.x, b.y, t, raw);
    if (b.remote || b.retired) {
      b.wx = raw.vx;
      b.wy = raw.vy;
      b.wkn = raw.kn;
    }
    b.rawGust = raw.gust;
    b.rawKn = raw.kn;
    b.rawVx = raw.vx;
    b.rawVy = raw.vy;
  }
  for (const il of race.course.islands) {
    windAt(w, il.x, il.y, t, raw);
    il.wind.vx = raw.vx;
    il.wind.vy = raw.vy;
  }
  const steal = (caster, receiver, s) => {
    if (s < SHADOW_STEAL || caster.remote) return;
    const st = caster.stats;
    st.stealT[receiver.id] = (st.stealT[receiver.id] ?? 0) + dt;
    if (st.stealT[receiver.id] >= 3 && !st.steals[receiver.id]) {
      st.steals[receiver.id] = true;
      ev.push({ type: 'steal', id: caster.id, from: receiver.id });
    }
  };
  for (const b of race.boats) {
    if (b.remote || b.retired) continue;
    const sf = b.finished ? 1 : shadowFactor(race, b, steal);
    b.shadow = sf;
    const we = race._we;
    we.vx = b.rawVx * sf;
    we.vy = b.rawVy * sf;
    we.kn = b.rawKn * sf;
    const cur = currentAt(race.course, b.x, b.y, race._cur);
    let slow = 1;
    const out = outsideBy(race.course.bounds, b.x, b.y);
    b.outside = out;
    if (out > 0) slow = 1 - 0.6 * Math.min(1, out / 20);
    if (b.finished) park(race, b);
    else if (b.parked) slow = 0;
    const was = b.gusting;
    b.gusting = b.rawGust > 1.15 && sf > 0.75;
    if (b.gusting) b.stats.gustT += dt;
    if (b.gusting && !was && !b.finished) ev.push({ type: 'gust', id: b.id });
    const e = stepBoat(b, we, cur, t, dt, b.finished ? (b.parked ? 0 : 0.55) : slow);
    if (e === 'tack' || e === 'gybe') ev.push({ type: e, id: b.id, clean: b.man?.clean ?? false });
    else if (e === 'irons') ev.push({ type: 'irons', id: b.id });
    obstacles(race, b, ev);
    keepInside(race.course.bounds, b);
    if (!b.finished) progress(race, b, ev);
  }
  // The gun: anyone with a bow over the line is OCS until they come back below it.
  if (!race.gunFired && t >= race.gunT) {
    race.gunFired = true;
    race.phase = 'race';
    ev.push({ type: 'gun' });
    for (const b of race.boats) {
      if (b.remote || b.retired) continue;
      const bowX = b.x + Math.cos(b.h) * 2.2;
      const bowY = b.y + Math.sin(b.h) * 2.2;
      if (startSide(race.course, bowX, bowY) > 0 && Math.abs(bowX) <= race.course.halfLine + 15) {
        b.ocs = true;
        b.stats.ocs++;
        ev.push({ type: 'ocs', id: b.id });
      }
    }
  }
  if (!race.noCollisions) resolveContacts(race, ev);
  // The officer closes the finish: everyone has finished, or long enough after the winner, or a hard limit.
  if (race.phase === 'race' && race.endT === null) {
    const still = race.boats.filter((b) => racing(b));
    const winner = race.firstFinishT;
    const lateLimit = winner !== null ? race.gunT + winner + (race.closeAfter ?? Math.max(60, 0.3 * winner)) : Infinity;
    if (race.boats.length > 0 && (still.length === 0 || t >= lateLimit || t >= race.hardLimit)) {
      race.endT = t;
      race.phase = 'done';
      ev.push({ type: 'end' });
    }
  }
}

function outsideBy(bounds, x, y) {
  const dx = Math.max(bounds.x0 - x, 0, x - bounds.x1);
  const dy = Math.max(bounds.y0 - y, 0, y - bounds.y1);
  return Math.max(dx, dy);
}

/** The course boundary is soft, then firm: 25 m past it a boat goes no further. */
function keepInside(bounds, b) {
  const m = 25;
  b.x = Math.max(bounds.x0 - m, Math.min(bounds.x1 + m, b.x));
  b.y = Math.max(bounds.y0 - m, Math.min(bounds.y1 + m, b.y));
}

/** Islands, shoals, marks, the committee boat and the pin. */
function obstacles(race, b, ev) {
  const c = race.course;
  if (b.finished) return;
  for (const il of c.islands) {
    const dx = b.x - il.x;
    const dy = b.y - il.y;
    if (dx * dx + dy * dy > (il.rr + BOAT_R + 2) ** 2) continue;
    const inside = inPolygon(il.poly, b.x, b.y);
    const near = nearestOnPolygon(il.poly, b.x, b.y, race._near);
    if (inside || near.d < BOAT_R * 0.8) {
      // Ashore: back to the water's edge, stopped for a moment.
      let nx = b.x - near.x;
      let ny = b.y - near.y;
      let nl = Math.hypot(nx, ny);
      if (inside || nl < 1e-6) {
        nx = near.x - il.x;
        ny = near.y - il.y;
        nl = Math.hypot(nx, ny) || 1;
      }
      b.x = near.x + (nx / nl) * BOAT_R * 0.85;
      b.y = near.y + (ny / nl) * BOAT_R * 0.85;
      ground(b, ev);
    }
  }
  for (const s of c.shoals) {
    if (inShoal(s, b.x, b.y)) ground(b, ev);
  }
  // Marks and the committee boat are solid; touching a mark under racing rules is a foul.
  for (const tg of c.targets) {
    if (tg.type === 'mark') bumpPost(race, b, tg.x, tg.y, 1.0, race.rules === 'racing', ev);
    else if (tg.type === 'gate' || tg.type === 'finish') {
      bumpPost(race, b, tg.x1, tg.y1, 0.9, false, ev);
      bumpPost(race, b, tg.x2, tg.y2, 0.9, false, ev);
    }
  }
  bumpPost(race, b, c.committee.x, c.committee.y, c.committee.r, false, ev);
  bumpPost(race, b, c.pin.x, c.pin.y, c.pin.r, false, ev);
}

function ground(b, ev) {
  if (b.groundImmune > 0) return;
  b.grounded = 2;
  b.groundImmune = 4;
  b.stats.grounds++;
  ev.push({ type: 'ground', id: b.id, x: b.x, y: b.y });
}

function bumpPost(race, b, x, y, r, foul, ev) {
  const dx = b.x - x;
  const dy = b.y - y;
  const min = r + BOAT_R * 0.7;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 0.01;
  b.x = x + (dx / d) * min;
  b.y = y + (dy / d) * min;
  const key = `post|${b.id}|${x.toFixed(1)}`;
  const last = race.contacts.get(key);
  race.contacts.set(key, race.t);
  if (last !== undefined && race.t - last < 1.5) return;
  b.v *= 0.9;
  // Pushed onto the buoy by another boat a moment ago: no foul.
  if (foul && b.penalty <= 0 && race.t - b.touchT > 1.5) {
    b.penalty = 2;
    b.foulFlag = 6;
    b.stats.fouls++;
    ev.push({ type: 'foul', id: b.id, other: 'mark', x, y });
  } else ev.push({ type: 'bump', a: b.id, b: 'mark', x, y });
}

/** Start, marks and finish, from where the boat was to where it is. */
function progress(race, b, ev) {
  const c = race.course;
  if (b.pi === 0) {
    // The start line's side is tracked from the first second, so a boat idling just below it at the gun still counts.
    const step = crossingStep(c.start, b.track, b.x, b.y);
    if (!race.gunFired) return;
    if (b.ocs) {
      // Back below the line (the whole boat) clears it.
      if (startSide(c, b.x, b.y) < -1.5) {
        b.ocs = false;
        ev.push({ type: 'ocsClear', id: b.id });
      }
      return;
    }
    if (step === 1) {
      b.pi = 1;
      b.track.side = 0;
      b.started = true;
      b.startT = Math.max(0, race.t - race.gunT - bowLead(b, c.start));
      b.startV = b.target > 0 ? b.v / b.target : 0;
      ev.push({ type: 'start', id: b.id, late: b.startT, speed: b.startV });
    }
    return;
  }
  const tg = c.targets[b.pi];
  if (!tg) return;
  const step = crossingStep(tg, b.track, b.x, b.y);
  if (step === 0) return;
  b.wind += step;
  if (tg.type !== 'mark' && b.wind < 0) b.wind = 0; // a line crossed backwards needs no unwinding
  if (step < 0) {
    if (tg.type === 'mark') {
      b.stats.wrong++;
      ev.push({ type: 'wrong', id: b.id, pi: b.pi });
    }
    return;
  }
  if (b.wind < 1) return;
  b.wind = 0;
  if (tg.type === 'finish') {
    finish(race, b, ev);
    return;
  }
  b.pi++;
  b.track.side = 0;
  ev.push({ type: 'round', id: b.id, pi: b.pi - 1, name: tg.name, x: tg.x, y: tg.y });
}

/**
 * How long ago the bow crossed a line that the centre has just cleared (lines count from the first part of the hull to
 * touch them): the centre is past the line by the band; the bow, 2.2 m ahead, got there earlier.
 */
function bowLead(b, line) {
  const vf = (Math.cos(b.h) * b.v) * line.fx + (Math.sin(b.h) * b.v) * line.fy;
  if (vf < 0.3) return 0;
  const along = Math.max(0, Math.cos(b.h) * line.fx + Math.sin(b.h) * line.fy);
  const past = (b.x - line.x1) * line.fx + (b.y - line.y1) * line.fy;
  return Math.min(3, Math.max(0, (past + 2.2 * along) / vf));
}

function finish(race, b, ev) {
  b.pi = race.course.targets.length;
  b.finished = true;
  b.finishT = race.t - race.gunT - bowLead(b, race.course.finish);
  race.finishers++;
  b.place = race.finishers;
  if (race.firstFinishT === null) race.firstFinishT = b.finishT;
  ev.push({ type: 'finish', id: b.id, t: b.finishT, place: b.place });
}

/**
 * A finished boat sails clear of the line to a parking circle beside it and stops there: it no longer shades or
 * touches anyone.
 */
export function parkingSpot(race, b) {
  const f = race.course.finish;
  const side = f.x <= 0 ? 1 : -1;
  const k = (b.place || b.slot || 0) % 10;
  return { x: f.x + side * (32 + (k % 5) * 7), y: f.y + 18 + Math.floor(k / 5) * 8 };
}

function park(race, b) {
  const p = parkingSpot(race, b);
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 6) b.parked = true;
  b.aim = b.parked ? b.h : Math.atan2(dy, dx);
  b.steer = 0;
  b.tackReq = false;
  b.hikeReq = false;
}

/** The order of the fleet now: finishers by time, then everyone else by the distance they still have to sail. */
export function standings(race) {
  const list = race.boats.filter((b) => !b.retired || b.finished);
  for (const b of list) b.dtg = b.finished ? 0 : distanceToGo(race.course, b.pi, b.x, b.y);
  list.sort((a, b) => {
    if (a.finished && b.finished) return a.finishT - b.finishT || (a.place || 0) - (b.place || 0) || (a.id < b.id ? -1 : 1);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.pi - a.pi || a.dtg - b.dtg || (a.id < b.id ? -1 : 1);
  });
  return list;
}

/** Seconds behind the leader (rough: distance over a typical speed for the day). */
export function gapSeconds(race, leader, b) {
  if (b.finished && leader.finished) return b.finishT - leader.finishT;
  const typical = Math.max(1.5, race.wind.baseKn * KN * 0.42);
  const lead = leader.finished ? 0 : leader.dtg;
  const behind = (b.dtg - lead) / typical;
  return leader.finished ? raceTime(race) - leader.finishT + b.dtg / typical : behind;
}

/** The race's live record for a boat, as plain numbers (presence, tests). */
export function boatRecord(b) {
  return { x: b.x, y: b.y, h: b.h, v: b.v, pi: b.pi, w: b.wind, ocs: b.ocs, fin: b.finished, ft: b.finishT };
}

export { angDiff };
