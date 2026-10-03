// The lobby's settings and what a race is built from: every page derives the same course, weather and fleet from the
// match's seed, its participants and the host's settings, so nothing about the race itself is sent. Pure; tested.

import { COURSES, COURSE_COUNT, autoCourse } from './course.js';
import { CLASS_IDS } from './polar.js';
import { hash32, hashf, rng } from './rng.js';
import { botEntries } from './skippers.js';

/**
 * The six lobby settings (the platform allows six of 2-8 choices). Twelve courses plus Auto don't fit one setting, so
 * the course is two: `course` (Auto, 1-7) and `courseHi` (+7 for courses 8-12); rules and class share one.
 */
export const SETTINGS = [
  { id: 'course', label: 'Course', options: [0, 1, 2, 3, 4, 5, 6, 7].map((v) => ({ value: v, label: v ? String(v) : 'Auto' })), default: 0 },
  { id: 'courseHi', label: 'Courses', options: [{ value: 0, label: '1-7' }, { value: 1, label: '8-12' }], default: 0 },
  { id: 'laps', label: 'Laps', options: [1, 2, 3].map((v) => ({ value: v, label: String(v) })), default: 2 },
  {
    id: 'weather',
    label: 'Weather',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'light', label: 'Light Airs' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'fresh', label: 'Fresh' },
      { value: 'shifty', label: 'Shifty' },
      { value: 'squall', label: 'Squall' },
      { value: 'fog', label: 'Fog' },
    ],
    default: 'auto',
  },
  {
    id: 'fleet',
    label: 'Fleet',
    options: [
      { value: 'six', label: 'Fill to 6' },
      { value: 'ten', label: 'Fill to 10' },
      { value: 'humans', label: 'Humans only' },
      { value: 'trial', label: 'Time trial' },
    ],
    default: 'six',
  },
  {
    id: 'rules',
    label: 'Rules',
    options: [
      { value: 'casual', label: 'Casual' },
      { value: 'racing', label: 'Racing' },
      { value: 'casual-mixed', label: 'Casual, mixed' },
      { value: 'racing-mixed', label: 'Racing, mixed' },
    ],
    default: 'casual',
  },
];

/** The course index (0 = Auto, 1-12) from the two course settings. */
export function courseIndex(s) {
  const lo = Number(s?.course) || 0;
  const hi = Number(s?.courseHi) || 0;
  if (!hi) return Math.max(0, Math.min(7, lo));
  if (!lo) return 0;
  return Math.min(COURSE_COUNT, lo + 7);
}

/** The two course settings for a course index. */
export function courseSettings(index) {
  const i = Math.max(0, Math.min(COURSE_COUNT, index | 0));
  if (i <= 7) return { course: i, courseHi: 0 };
  return { course: i - 7, courseHi: 1 };
}

/** Plain values for every setting, defaults filled in, anything unknown replaced. */
export function cleanSettings(s) {
  const out = {};
  for (const st of SETTINGS) {
    const v = s?.[st.id];
    out[st.id] = st.options.some((o) => o.value === v) ? v : st.default;
  }
  return out;
}

export const WEATHER_NAMES = { light: 'Light Airs', moderate: 'Moderate', fresh: 'Fresh', shifty: 'Shifty', squall: 'Squall', fog: 'Fog', classic: 'Classic' };

/** Auto weather: mostly the everyday breezes, now and then something dramatic. */
export function autoWeather(seed) {
  const r = hashf(seed >>> 0, 911);
  if (r < 0.3) return 'moderate';
  if (r < 0.5) return 'shifty';
  if (r < 0.66) return 'fresh';
  if (r < 0.8) return 'light';
  if (r < 0.9) return 'squall';
  return 'fog';
}

/** The skills of the rival skippers that fill a fleet: a spread, so newcomers can beat some and experts are pushed. */
export function fillSkills(n, seed) {
  const pool = n <= 3 ? [1, 2, 3] : n <= 5 ? [0, 1, 1, 2, 3] : [0, 1, 1, 2, 2, 2, 3, 3, 1];
  const r = rng(hash32(seed >>> 0, 404));
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fixed conditions per course for time trials: the same wind for everyone, every time, so the boards are fair. */
export const trialSeed = (courseId) => 900001 + courseId * 7919;

/**
 * Everything a race is built from. `humans`: the participants' ids in a fixed order; `looks`: their chosen look per
 * id ({ livery, pattern, cls, num, name }); the result's entries list humans first, then rival skippers.
 */
export function raceSetup(settings, seed, humans, looks = {}) {
  const st = cleanSettings(settings);
  const trial = st.fleet === 'trial';
  let courseId = courseIndex(st);
  if (!courseId) courseId = autoCourse(seed);
  const weather = trial ? 'classic' : st.weather === 'auto' ? autoWeather(seed) : st.weather;
  const mixed = st.rules.endsWith('mixed');
  const rules = st.rules.startsWith('racing') ? 'racing' : 'casual';
  const ids = humans.slice().sort();
  const target = st.fleet === 'six' ? 6 : st.fleet === 'ten' ? 10 : ids.length;
  const nBots = trial ? 0 : Math.max(0, target - ids.length);
  // Liveries: each person's choice unless someone earlier in the order has it; then the next free one.
  const used = new Set();
  const entries = ids.map((id, i) => {
    const lk = looks[id] ?? {};
    let livery = Number.isInteger(lk.livery) && lk.livery >= 0 && lk.livery < 10 ? lk.livery : i % 10;
    while (used.has(livery)) livery = (livery + 1) % 10;
    used.add(livery);
    const cls = mixed && CLASS_IDS.includes(lk.cls) ? lk.cls : 'dinghy';
    return { id, name: String(lk.name ?? '').slice(0, 24) || 'Sailor', cls, livery, pattern: lk.pattern ?? 'plain', num: lk.num ?? i + 1, flag: lk.flag ?? 'none', wake: lk.wake ?? 'foam' };
  });
  const skills = fillSkills(nBots, seed);
  const r = rng(hash32(seed >>> 0, 17));
  const bots = botEntries(seed, nBots, skills, () => (mixed ? CLASS_IDS[Math.floor(r.next() * CLASS_IDS.length)] : 'dinghy'));
  for (const b of bots) {
    let livery = 0;
    while (used.has(livery) && used.size < 10) livery++;
    used.add(livery);
    b.livery = livery;
    b.num = 20 + Number(b.id.replace('bot', ''));
    b.pattern = 'plain';
    // Some rival skippers fly a burgee.
    const fr = r.next();
    b.flag = fr < 0.55 ? 'none' : ['pennant', 'swallow', 'chequer', 'cross'][Math.floor((fr - 0.55) / 0.1125) % 4];
    b.wake = 'foam';
  }
  const def = COURSES.find((c) => c.id === courseId);
  return {
    seed: trial ? trialSeed(courseId) : seed >>> 0,
    courseId,
    courseName: def?.name ?? '',
    laps: def?.lapped ? (trial ? 2 : st.laps) : 1, // a time trial is always two laps, so the boards compare
    weather,
    rules: trial ? 'casual' : rules,
    trial,
    mixed,
    preStart: trial ? 30 : 60,
    entries: [...entries, ...bots],
    humans: ids,
  };
}
