// The room: how a boat travels in presence, how the host's rival skippers travel in room state, and the checks every
// number from another page goes through before it is used (anyone can send anything).

import { SETTINGS } from './sim/setup.js';
import { PATTERNS, FLAGS, WAKES } from './progress.js';
import { CLASS_IDS } from './sim/polar.js';

export const JOIN = { mode: 'regatta', maxPlayers: 10, minPlayers: 1, lobby: 'bar', settings: SETTINGS };

export const fin = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** A short, stable id for a match in presence and state. */
export const mshort = (mid) => String(mid ?? '').slice(-12);

/** The player's look as it travels: [livery, pattern, class, number, boat name index, flag, wake style]. */
export function encodeLook(look) {
  return [
    look.livery | 0,
    Math.max(0, PATTERNS.findIndex((p) => p.id === look.pattern)),
    Math.max(0, CLASS_IDS.indexOf(look.cls)),
    look.num | 0,
    look.name | 0,
    Math.max(0, FLAGS.findIndex((f) => f.id === look.flag)),
    Math.max(0, WAKES.findIndex((w) => w.id === look.wake)),
  ];
}

export function decodeLook(a) {
  if (!Array.isArray(a)) return null;
  return {
    livery: Math.floor(fin(a[0], 0, 9)),
    pattern: PATTERNS[Math.floor(fin(a[1], 0, PATTERNS.length - 1))]?.id ?? 'plain',
    cls: CLASS_IDS[Math.floor(fin(a[2], 0, CLASS_IDS.length - 1))] ?? 'dinghy',
    num: Math.floor(fin(a[3], 0, 99)),
    name: Math.floor(fin(a[4], 0, 40)),
    flag: FLAGS[Math.floor(fin(a[5], 0, FLAGS.length - 1))]?.id ?? 'none',
    wake: WAKES[Math.floor(fin(a[6], 0, WAKES.length - 1))]?.id ?? 'foam',
  };
}

/** My boat in presence: status 'r' racing, 'h' harbour, 'w' watching, 'l' sailing something of my own. */
export function boatPresence(b, mid, simT, look, back = false) {
  return {
    s: 'r',
    rd: back ? 1 : 0, // tapped Harbour on the results: ready to go back
    m: mshort(mid),
    t: r2(simT),
    x: r1(b.x),
    y: r1(b.y),
    h: r3(b.h),
    v: r2(b.v),
    sd: b.side,
    tw: Math.round(b.twa),
    lf: r1(b.luff),
    hk: b.hiking ? 1 : 0,
    mn: b.man ? (b.man.kind === 'tack' ? 1 : 2) : 0,
    pi: b.pi,
    w: b.wind,
    ts: b.track.side,
    o: b.ocs ? 1 : 0,
    st: b.started ? 1 : 0,
    sT: b.startT === null ? null : r2(b.startT),
    f: b.finished ? 1 : 0,
    ft: b.finishT === null ? null : r3(b.finishT),
    fl: b.foulFlag > 0 ? 1 : 0,
    pn: r1(b.penalty),
    gr: r1(b.grounded),
    sm: r2(b.stamina),
    lk: encodeLook(look),
  };
}

/**
 * Applies another player's presence to their boat (for drawing, shadows and contact), every number checked. The
 * pose itself comes from presenceAt (smoothed); everything else from the latest update. Returns false if the
 * presence is not a race presence for this match.
 */
export function applyBoatPresence(b, p, at, mid, race) {
  if (!p || typeof p !== 'object' || p.s !== 'r' || p.m !== mshort(mid)) return false;
  const B = race.course.bounds;
  const src = at && typeof at === 'object' ? at : p;
  b.x = fin(src.x, B.x0 - 60, B.x1 + 60, b.x);
  b.y = fin(src.y, B.y0 - 60, B.y1 + 60, b.y);
  b.h = fin(src.h, -10, 10, b.h);
  b.v = fin(p.v, 0, 15, 0);
  b.px = b.x;
  b.py = b.y;
  b.ph = b.h;
  b.drawX = b.x;
  b.drawY = b.y;
  b.drawH = b.h;
  b.side = p.sd === -1 ? -1 : 1;
  b.twa = fin(p.tw, 0, 180, 90);
  b.luff = fin(p.lf, 0, 1, 0);
  b.hiking = p.hk === 1;
  b.man = p.mn === 1 ? { kind: 'tack' } : p.mn === 2 ? { kind: 'gybe' } : null;
  b.pi = Math.floor(fin(p.pi, 0, race.course.targets.length, b.pi));
  b.wind = Math.floor(fin(p.w, -9, 9, 0));
  b.ocs = p.o === 1;
  b.started = p.st === 1;
  b.startT = p.sT === null ? null : fin(p.sT, 0, 3600, null);
  b.finished = p.f === 1 && Number.isFinite(p.ft);
  b.finishT = b.finished ? fin(p.ft, 0, 36000, null) : null;
  b.foulFlag = p.fl === 1 ? 1 : 0;
  b.penalty = fin(p.pn, 0, 5, 0);
  b.grounded = fin(p.gr, 0, 5, 0);
  b.stamina = fin(p.sm, 0, 1, 1);
  b.simT = fin(p.t, 0, 36000, 0);
  return true;
}

// Bot snapshots: [x, y, h, v, flags, pi, wind, twa, luff*10, finishT|-1]
const F = { hike: 1, tack: 2, gybe: 4, ocs: 8, foul: 16, fin: 32, started: 64, side: 128, parked: 256 };

export function packBots(race, bots, mid, nowMs) {
  return {
    m: mshort(mid),
    t: Math.round(nowMs),
    b: bots.map((b) => [
      r1(b.x),
      r1(b.y),
      r3(b.h),
      r2(b.v),
      (b.hiking ? F.hike : 0) | (b.man?.kind === 'tack' ? F.tack : 0) | (b.man?.kind === 'gybe' ? F.gybe : 0) | (b.ocs ? F.ocs : 0) | (b.foulFlag > 0 ? F.foul : 0) | (b.finished ? F.fin : 0) | (b.started ? F.started : 0) | (b.side > 0 ? F.side : 0) | (b.parked ? F.parked : 0),
      b.pi,
      b.wind,
      Math.round(b.twa),
      Math.round(b.luff * 10),
      b.finished ? r3(b.finishT) : -1,
      r2(b.stamina),
    ]),
  };
}

/** Checks a bots snapshot from the room; returns it or null. */
export function readBots(v, mid, n) {
  if (!v || typeof v !== 'object' || v.m !== mshort(mid) || !Array.isArray(v.b) || v.b.length !== n || !Number.isFinite(v.t)) return null;
  for (const row of v.b) if (!Array.isArray(row) || row.length < 10 || row.slice(0, 10).some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  return v;
}

/** Writes one bot row (interpolated between two snapshots by k) into a boat. */
export function applyBotRow(b, a, c, k, race) {
  const B = race.course.bounds;
  const lerp = (i) => a[i] + (c[i] - a[i]) * k;
  b.x = fin(lerp(0), B.x0 - 60, B.x1 + 60, b.x);
  b.y = fin(lerp(1), B.y0 - 60, B.y1 + 60, b.y);
  let dh = c[2] - a[2];
  dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  b.h = fin(a[2] + dh * k, -10, 10, b.h);
  b.v = fin(lerp(3), 0, 15, 0);
  const f = c[4] | 0;
  b.hiking = (f & F.hike) !== 0;
  b.man = f & F.tack ? { kind: 'tack' } : f & F.gybe ? { kind: 'gybe' } : null;
  b.ocs = (f & F.ocs) !== 0;
  b.foulFlag = f & F.foul ? 1 : 0;
  b.finished = (f & F.fin) !== 0;
  b.started = (f & F.started) !== 0;
  b.side = f & F.side ? 1 : -1;
  b.parked = (f & F.parked) !== 0;
  b.pi = Math.floor(fin(c[5], 0, race.course.targets.length, b.pi));
  b.wind = Math.floor(fin(c[6], -9, 9, 0));
  b.twa = fin(c[7], 0, 180, 90);
  b.luff = fin(c[8], 0, 10, 0) / 10;
  b.finishT = b.finished ? fin(c[9], 0, 36000, null) : null;
  b.stamina = fin(c[10], 0, 1, 1);
  b.drawX = b.x;
  b.drawY = b.y;
  b.drawH = b.h;
  b.px = b.x;
  b.py = b.y;
  b.ph = b.h;
}

/** The race record the host keeps: who finished when, who retired, and the results once it is over. */
export function readRecord(v, mid) {
  if (!v || typeof v !== 'object' || v.m !== mshort(mid)) return null;
  const finT = {};
  for (const [id, t] of Object.entries(v.fin && typeof v.fin === 'object' ? v.fin : {})) if (typeof id === 'string' && id.length < 64 && Number.isFinite(t) && t > 0) finT[id] = t;
  const rows = Array.isArray(v.res) ? v.res.slice(0, 12).filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : null;
  return {
    m: v.m,
    by: typeof v.by === 'string' ? v.by : '',
    fin: finT,
    done: v.done === true,
    endAt: Number.isFinite(v.endAt) ? v.endAt : null,
    res: rows,
    first: Number.isFinite(v.first) ? v.first : null,
  };
}
