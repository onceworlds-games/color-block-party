// Races of your own, outside the room's matches: the lesson, Career races, and a quick race when the game runs with no
// room at all. All boats are sailed on this page with its own clock, which stops while the game is paused.

import { makeSession, me, advance } from './session.js';
import { raceSetup } from './sim/setup.js';
import { standings } from './sim/race.js';
import { botEntries } from './sim/skippers.js';
import { CUPS, careerBots, careerSeed, addRace, table, medalForPlace } from './career.js';
import { classOpen } from './progress.js';

/** The lesson: one lap of Pilot Bank in a moderate breeze, two friendly rivals, a shorter sequence. */
export function lessonSession(look) {
  const entries = [{ id: 'me', name: 'You', cls: 'dinghy' }, ...botEntries(2024, 2, [0, 0])];
  const s = makeSession({ seed: 31337, courseId: 1, laps: 1, weather: 'moderate', rules: 'casual', entries, meId: 'me', preStart: 30, looks: looksFor(entries, look), kind: 'lesson' });
  return wrap(s, { kind: 'lesson' });
}

/** A Career race: the cup's fleet, the race's fixed conditions. */
export function careerSession(profile, look, cup, race) {
  const c = CUPS[cup];
  const r = c.races[race];
  const cls = c.mixed && classOpen(profile, look.cls) ? look.cls : 'dinghy';
  const entries = [{ id: 'me', name: 'You', cls }, ...careerBots(cup)];
  const s = makeSession({ seed: careerSeed(cup, race), courseId: r.course, laps: r.laps, weather: r.weather, rules: c.rules, entries, meId: 'me', preStart: 45, looks: looksFor(entries, look), kind: 'career' });
  return wrap(s, { kind: 'career', cup, race });
}

/** A race with no room (the game opened on its own): the harbour's settings against rival skippers. */
export function quickSession(settings, look, seed) {
  const setup = raceSetup(settings, seed, ['me'], { me: { ...look, name: 'You' } });
  const s = makeSession({ ...setup, meId: 'me', kind: setup.trial ? 'trial' : 'race', looks: Object.fromEntries(setup.entries.map((e) => [e.id, { livery: e.livery, pattern: e.pattern, num: e.num, name: e.name, flag: e.flag, wake: e.wake }])) });
  return wrap(s, { kind: 'quick', setup });
}

function looksFor(entries, look) {
  const out = {};
  let next = 0;
  entries.forEach((e, i) => {
    if (e.id === 'me') out.me = { livery: look.livery, pattern: look.pattern, num: 7, name: 'You', flag: look.flag, wake: look.wake };
    else {
      if (next === look.livery) next++;
      out[e.id] = { livery: next % 10, num: 20 + i, name: e.name };
      next++;
    }
  });
  return out;
}

function wrap(session, info) {
  return { session, ...info, clock: 0, paused: false, done: false, finishedAt: null, results: null };
}

/** Steps a solo race. Ends a while after the player finishes (or when everyone has). */
export function tickSolo(so, dt, input) {
  if (so.paused || so.done) return [];
  so.clock += dt;
  const s = so.session;
  const b = me(s);
  advance(s, so.clock, b && !b.finished ? input : null, 4);
  const ev = s.events.splice(0);
  const race = s.race;
  if (b?.finished && so.finishedAt === null) so.finishedAt = so.clock;
  const allIn = race.boats.every((x) => x.finished || x.retired);
  if (race.phase === 'done' || allIn || (so.finishedAt !== null && so.clock - so.finishedAt > 25)) so.done = true;
  return ev;
}

/** The final order of a solo race: finishers by time, then by how far they got. */
export function soloOrder(so) {
  const list = standings(so.session.race);
  const fins = list.filter((b) => b.finished).sort((a, b) => a.finishT - b.finishT || (a.id < b.id ? -1 : 1));
  return [...fins, ...list.filter((b) => !b.finished)];
}

/** Adds a career race to the cup and returns the table (and the medal when the cup is over). */
export function settleCareer(profile, so) {
  const order = soloOrder(so).map((b) => b.id);
  const cur = profile.career.cur && profile.career.cur.cup === so.cup ? profile.career.cur : { cup: so.cup, race: 0, pts: {} };
  const pts = addRace(cur.pts, order);
  const tbl = table(pts, order);
  const last = so.race >= CUPS[so.cup].races.length - 1;
  let medal = 0;
  if (last) {
    const place = tbl.findIndex((r) => r.id === 'me') + 1;
    medal = medalForPlace(place);
    profile.career.cups[so.cup] = Math.max(profile.career.cups[so.cup] ?? 0, medal);
    profile.career.cur = null;
  } else profile.career.cur = { cup: so.cup, race: so.race + 1, pts };
  return { order, table: tbl, last, medal };
}
