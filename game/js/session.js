// A race on screen: the simulation stepped at a fixed rate toward a clock (the room's match clock, or a local one for
// solo races), the player's input applied to their boat, poses interpolated for drawing, events collected.
// A page simulates its own boat (and, as host, the rival skippers); everyone else's boat is drawn from the network.

import { makeRace, stepRace, SIM_DT, standings, gapSeconds, raceTime } from './sim/race.js';
import { thinkSkippers, placeFleet } from './sim/skippers.js';
import { vmgAngles, CLASSES, KN } from './sim/polar.js';
import { windAt, windSample } from './sim/wind.js';
import { distanceToGo } from './sim/course.js';

const W = windSample();

/**
 * opts: race options for makeRace (seed, courseId, laps, weather, rules, entries, preStart, trial), plus
 *  meId: the player's boat id (or null to watch), local: ids this page simulates (default: every boat),
 *  looks: { [id]: { livery, pattern, num, name } }
 */
export function makeSession(opts) {
  const race = makeRace(opts);
  placeFleet(race);
  const local = new Set(opts.local ?? race.boats.map((b) => b.id));
  for (const b of race.boats) b.remote = !local.has(b.id);
  const s = {
    race,
    meId: opts.meId ?? null,
    local,
    looks: opts.looks ?? {},
    simT: 0, // seconds of race clock simulated
    acc: 0,
    events: [],
    paused: false,
    over: false,
    kind: opts.kind ?? 'race',
  };
  decorate(s);
  return s;
}

/** Gives every boat its look (colour, number, name) for drawing. */
export function decorate(s) {
  let n = 0;
  for (const b of s.race.boats) {
    const look = s.looks[b.id] ?? {};
    b.livery = look.livery ?? n % 10;
    b.pattern = look.pattern ?? 'plain';
    b.flag = look.flag ?? 'none';
    b.wake = look.wake ?? 'foam';
    b.num = look.num ?? n + 1;
    if (look.name) b.name = look.name;
    b.drawX = b.x;
    b.drawY = b.y;
    b.drawH = b.h;
    b.alpha = 1;
    n++;
  }
}

export function me(s) {
  return s.meId ? s.race.byId.get(s.meId) ?? null : null;
}

/**
 * Advances the simulation toward `target` (seconds of race clock). A page that fell behind (a hidden tab) catches up
 * at most `maxSteps` steps per frame, so it never jumps; `input` drives the player's boat.
 */
export function advance(s, target, input, maxSteps = 6) {
  const race = s.race;
  const mine = me(s);
  if (mine && input && !mine.remote) {
    mine.steer = input.steer;
    mine.push = input.push;
    mine.hikeReq = input.hike;
    if (input.tack) mine.tackReq = true;
  }
  let steps = 0;
  while (s.simT + SIM_DT <= target + 1e-9 && steps < maxSteps) {
    thinkSkippers(race);
    stepRace(race, SIM_DT);
    s.simT += SIM_DT;
    for (const e of race.events) s.events.push(e);
    race.events.length = 0;
    steps++;
    if (mine) mine.tackReq = false;
  }
  // Interpolate between the last two steps for a smooth picture at any frame rate.
  const alpha = Math.max(0, Math.min(1, (target - s.simT) / SIM_DT));
  for (const b of race.boats) {
    if (b.remote) continue;
    const dh = ((b.h - b.ph + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    b.drawX = b.px + (b.x - b.px) * (steps ? alpha : 1);
    b.drawY = b.py + (b.y - b.py) * (steps ? alpha : 1);
    b.drawH = b.ph + dh * (steps ? alpha : 1);
  }
  return steps;
}

/** What the HUD shows about the player's boat and the race (plain numbers, built once per frame). */
export function hudData(s, t) {
  const race = s.race;
  const b = me(s);
  const out = { pre: race.t < race.gunT, gunIn: race.gunT - race.t, raceT: Math.max(0, raceTime(race)), leg: '' };
  if (!b) return out;
  const tg = race.course.targets[b.pi];
  const nLegs = race.course.targets.length - 1;
  if (b.finished) out.leg = 'Finished';
  else if (b.pi === 0) out.leg = b.ocs ? 'Over the line' : 'Start';
  else out.leg = `Leg ${b.pi} of ${nLegs} · ${tg?.name ?? ''}`;
  windAt(race.wind, b.x, b.y, race.t, W);
  const kn = W.kn;
  const best = vmgAngles(b.cls, kn * (b.shadow || 1));
  out.wind = { kn: kn * (b.shadow || 1), shift: W.shift, gusting: W.gust > 1.12 };
  out.best = best;
  out.nogo = CLASSES[b.cls].nogo;
  out.fromAngle = Math.atan2(-W.vy, -W.vx);
  out.speed = b.v / KN;
  if (tg && !b.finished) {
    const ang = Math.atan2(tg.y - b.y, tg.x - b.x);
    out.markAngle = ang;
    out.vmg = (Math.cos(b.h - ang) * b.v) / KN;
  } else {
    out.markAngle = null;
    out.vmg = null;
  }
  out.stamina = b.stamina;
  return out;
}

/** Standings rows for the HUD: place, name, gap. */
export function standingRows(s) {
  const race = s.race;
  const list = standings(race);
  const lead = list[0];
  return list.map((b, i) => {
    let gap = '';
    if (b.finished) gap = i === 0 ? fmt(b.finishT) : `+${(b.finishT - lead.finishT).toFixed(1)}`;
    else if (b.retired) gap = 'ret';
    else if (race.t < race.gunT) gap = '';
    else if (b.pi === 0) gap = b.ocs ? 'OCS' : '—';
    else if (i === 0) gap = '';
    else {
      const g = gapSeconds(race, lead, b);
      gap = Number.isFinite(g) ? `+${Math.max(0, g).toFixed(1)}` : '';
    }
    return { id: b.id, place: i + 1, name: b.name || b.id, livery: b.livery, gap, away: b.retired || b.away };
  });
}

function fmt(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

export { distanceToGo };
