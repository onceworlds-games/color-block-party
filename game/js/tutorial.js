// Teaching in context: short prompts from the race officer at the moment they matter. The lesson (a first race) walks
// through every one; in ordinary races each hint shows its first few times only (counted in the profile).

import { notify } from './hints.js';
import { vmgAngles } from './sim/polar.js';

/** Hints: id -> [keyboard text, touch text]. Five words or fewer. */
export const HINTS = {
  steer: ['A and D steer', 'The stick steers'],
  irons: ["Can't sail into the wind", "Can't sail into the wind"],
  line: ['Cross the line after the gun', 'Cross the line after the gun'],
  tack: ['Space tacks', 'Tap Tack'],
  groove: ['Hold to settle upwind', 'Hold to settle upwind'],
  gust: ['Dark water: more wind', 'Dark water: more wind'],
  shadow: ['Their shadow slows you', 'Their shadow slows you'],
  port: ['Leave red marks to port', 'Leave red marks to port'],
  starboard: ['Leave yellow marks to starboard', 'Leave yellow marks to starboard'],
  gybe: ['Downwind, Space gybes', 'Downwind, Tack gybes'],
  hike: ['Shift hikes: too much wind', 'Hike: too much wind'],
  layline: ['Dotted lines: tack there', 'Dotted lines: tack there'],
  headed: ['Headed: tack to the other side', 'Headed: tap Tack'],
  chart: ['Tab shows the whole course', ''],
  finish: ['Finish between the flags', 'Finish between the flags'],
};

export function makeTeacher(profile, lesson) {
  return { profile, lesson, shown: {}, steered: false, beatT: 0, lastHint: -99 };
}

/**
 * Looks at the race and shows the next useful hint. `limit`: how many times a hint shows in ordinary races.
 * Returns true when the profile changed (a hint was counted).
 */
export function teach(tc, s, b, notices, now, touch, limit = 2, dt = 0.016, lift = null) {
  if (!b || b.finished) return false;
  const race = s.race;
  const p = tc.profile;
  const show = (id, cond) => {
    if (!cond || tc.shown[id]) return false;
    if (!tc.lesson && (p.hints[id] ?? 0) >= limit) return false;
    if (now - tc.lastHint < 4) return false;
    const txt = HINTS[id][touch ? 1 : 0];
    if (!txt) return false;
    tc.shown[id] = true;
    tc.lastHint = now;
    p.hints[id] = (p.hints[id] ?? 0) + 1;
    notify(notices, now, txt, { kind: 'hint', dur: 3.4, prio: 4 });
    return true;
  };
  if (Math.abs(b.steer) > 0.2) tc.steered = true;
  const pre = race.t < race.gunT;
  const tl = race.gunT - race.t;
  const tg = race.course.targets[b.pi];
  const best = vmgAngles(b.cls, b.wkn || 10);
  if (pre) {
    if (show('steer', tl < race.gunT - 2 && !tc.steered)) return true;
    if (show('irons', b.twa < 34)) return true;
    if (show('line', tl < 20 && tl > 8)) return true;
    return false;
  }
  if (b.twa < best.up + 12 && !b.irons) tc.beatT += dt;
  else tc.beatT = 0;
  if (show('irons', b.irons)) return true;
  if (show('groove', b.pi === 1 && tc.beatT > 3)) return true;
  if (show('tack', b.pi >= 1 && tc.beatT > 9)) return true;
  if (show('gust', b.gusting)) return true;
  if (lift && show('headed', lift.headedT > 3 && b.pi >= 1 && b.twa < 70 && b.v > 1 && !b.man)) return true;
  if (show('shadow', b.shadow < 0.85)) return true;
  if (tg && tg.type === 'mark') {
    const d = Math.hypot(tg.x - b.x, tg.y - b.y);
    if (show(tg.side === 'port' ? 'port' : 'starboard', d < 45)) return true;
    if (show('layline', d < 90 && b.twa < best.up + 15)) return true;
  }
  if (show('gybe', b.pi >= 2 && b.twa > 130)) return true;
  if (show('hike', b.wkn > 14.5 && b.twa < 120 && !b.hiking)) return true;
  if (tg && tg.type === 'finish' && show('finish', Math.hypot(tg.x - b.x, tg.y - b.y) < 60)) return true;
  if (show('chart', !touch && b.pi >= 2)) return true;
  return false;
}
