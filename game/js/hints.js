// Notices: one short line at a time under the clock, in the race officer's voice. Events from the race become notices
// for the player's own boat; higher priority wins, and the same line never stacks.

import { timeToLine } from './sim/skippers.js';
import { vmgAngles } from './sim/polar.js';
import { headingFor } from './sim/boat.js';

const ORDINAL = ['', '1st', '2nd', '3rd'];
export const ordinal = (n) => ORDINAL[n] ?? `${n}th`;

export function makeNotices() {
  return { cur: null, last: '' };
}

/** Shows a notice unless a more important one is still up. kind: 'good' | 'bad' | 'info'. */
export function notify(n, now, text, { sub = '', kind = 'info', dur = 2.2, prio = 1 } = {}) {
  const c = n.cur;
  if (c && now < c.until - 0.3 && c.prio > prio) return;
  if (c && c.text === text && now < c.until) {
    c.until = now + dur;
    return;
  }
  n.cur = { text, sub, kind, at: now, until: now + dur, prio };
}

export function currentNotice(n, now) {
  return n.cur && now < n.cur.until ? n.cur : null;
}

/** The officer's horns and the gun. */
const HORN_LINES = {
  60: ['One minute', 'Please look busy.'],
  30: ['Thirty seconds', ''],
  10: ['Ten seconds', 'Hold your nerve.'],
};

/**
 * Turns a race event into a notice when it concerns the player. Returns a sound cue name for the audio layer
 * (or null).
 */
export function eventNotice(n, e, meId, now, ctx = {}) {
  const mine = e.id === meId;
  switch (e.type) {
    case 'horn': {
      const l = HORN_LINES[e.n];
      if (l) notify(n, now, l[0], { sub: l[1], dur: 2.4, prio: 2 });
      return e.n >= 10 ? 'hornLong' : 'hornShort';
    }
    case 'gun':
      notify(n, now, 'Racing', { sub: '', dur: 1.6, prio: 2 });
      return 'gun';
    case 'start':
      if (!mine) return null;
      if (e.late <= 1 && e.speed >= 0.85) notify(n, now, 'Perfect start', { kind: 'good', prio: 3 });
      else if (e.late <= 4) notify(n, now, 'Away cleanly', { prio: 2 });
      else notify(n, now, `Started ${e.late.toFixed(0)}s late`, { prio: 2 });
      return 'start';
    case 'ocs':
      if (!mine) return 'ocsOther';
      notify(n, now, 'Over early: go back', { sub: 'Below the line, then cross again.', kind: 'bad', dur: 4, prio: 6 });
      return 'ocs';
    case 'ocsClear':
      if (mine) notify(n, now, 'Clear: cross the line', { kind: 'good', dur: 2.5, prio: 5 });
      return null;
    case 'tack':
    case 'gybe':
      if (!mine) return null;
      if (e.clean) notify(n, now, 'Clean', { kind: 'good', dur: 1.1, prio: 1 });
      else notify(n, now, e.type === 'tack' ? 'Messy tack' : 'Messy gybe', { sub: ctx.slow ? 'Build speed first.' : 'Too soon after the last.', dur: 1.6, prio: 1 });
      return e.clean ? 'clean' : 'messy';
    case 'irons':
      if (mine) notify(n, now, 'In irons', { sub: 'Bear away, or tack out.', kind: 'bad', dur: 2.2, prio: 3 });
      return mine ? 'irons' : null;
    case 'foul':
      if (mine) {
        const why = e.other === 'mark' ? 'You touched the mark.' : ctx.foulWhy ?? 'You had to keep clear.';
        notify(n, now, 'Foul', { sub: why, kind: 'bad', dur: 3, prio: 5 });
        return 'foul';
      }
      if (e.other === meId) notify(n, now, 'Fouled', { sub: 'They pay for it.', dur: 2, prio: 4 });
      return e.other === meId ? 'bump' : null;
    case 'bump':
      return e.a === meId || e.b === meId ? 'bump' : null;
    case 'gust':
      if (mine) notify(n, now, 'Gust', { dur: 1.2, prio: 0 });
      return mine ? 'gust' : null;
    case 'round':
      if (!mine) return null;
      notify(n, now, e.name, { sub: 'Rounded.', dur: 1.6, prio: 2 });
      return 'bell';
    case 'wrong':
      if (mine) notify(n, now, 'Wrong side', { sub: 'Unwind it, please.', kind: 'bad', dur: 3, prio: 5 });
      return mine ? 'wrong' : null;
    case 'ground':
      if (mine) notify(n, now, 'Aground', { sub: 'The chart did mention it.', kind: 'bad', dur: 2.6, prio: 5 });
      return mine ? 'ground' : null;
    case 'finish':
      if (mine) {
        if (e.place === 1) notify(n, now, 'Line honours', { sub: 'Try to look surprised.', kind: 'good', dur: 4, prio: 7 });
        else notify(n, now, `Finished ${ordinal(e.place)}`, { sub: '', kind: 'good', dur: 3.5, prio: 7 });
        return 'finish';
      }
      return 'finishOther';
    case 'steal':
      if (mine) notify(n, now, 'Wind stolen', { sub: 'They are in your shadow.', kind: 'good', dur: 1.8, prio: 1 });
      return mine ? 'steal' : null;
    case 'end':
      return 'end';
    default:
      return null;
  }
}

/** Before the gun: how long the player's boat would take to reach the line, close-hauled on its tack (or null). */
export function timeToLineFor(b, race) {
  if (b.y < 0.5 || b.pi > 0) return null;
  const best = vmgAngles(b.cls, b.wkn || 10);
  const h = Math.sin(b.h) < -0.25 ? b.h : headingFor(b.wx, b.wy, best.up, b.side);
  const t = timeToLine(b, h, best);
  return t >= 99 ? null : t;
}


/** How far the wind has swung from its mean at the boat, as a sailor reads it: + lifted (a free turn toward the mark), - headed. */
export function makeLift() {
  return { now: null, mean: null, deg: 0, headedT: 0, side: 1 };
}

export function updateLift(L, shift, side, dt) {
  if (!Number.isFinite(shift)) return L.deg;
  if (L.now === null || side !== L.side) {
    if (L.now === null) L.now = L.mean = shift;
    L.side = side;
  }
  L.now += (shift - L.now) * (1 - Math.exp(-dt / 2.2));
  L.mean += (shift - L.mean) * (1 - Math.exp(-dt / 40));
  // A veer (clockwise) heads the starboard tack and lifts the port one.
  L.deg = -((L.now - L.mean) * 180 / Math.PI) * side;
  L.headedT = L.deg < -6 ? L.headedT + dt : 0;
  return L.deg;
}
