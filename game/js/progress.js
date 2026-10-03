// The player's profile: experience and Captain levels, unlocks, medals, bests and ghosts. Parsed defensively (missing,
// empty, corrupt, older or newer saves all load) and versioned. Pure functions; the app saves it through the platform.

export const PROFILE_KEY = 'profile';
export const VERSION = 1;

export const PATTERNS = [
  { id: 'plain', name: 'Plain', level: 1 },
  { id: 'band', name: 'Band', level: 2 },
  { id: 'dot', name: 'Spot', level: 4 },
  { id: 'stripes', name: 'Stripes', level: 6 },
  { id: 'chevron', name: 'Chevron', level: 8 },
  { id: 'leech', name: 'Leech', level: 11 },
  { id: 'split', name: 'Split', level: 14 },
  { id: 'star', name: 'Star', level: 18 },
];

/** Masthead burgees: a shape and two colours (index into the chart palette), opened by level. */
export const FLAGS = [
  { id: 'none', name: 'None', level: 1 },
  { id: 'pennant', name: 'Pennant', level: 3, shape: 'pennant', c: ['#C2412F', '#C2412F'] },
  { id: 'swallow', name: 'Swallowtail', level: 5, shape: 'swallow', c: ['#2F55A4', '#EFE6D2'] },
  { id: 'chequer', name: 'Chequer', level: 9, shape: 'square', c: ['#1E2A33', '#EFE6D2'] },
  { id: 'cross', name: 'Saltire', level: 13, shape: 'saltire', c: ['#EFE6D2', '#2F55A4'] },
  { id: 'gold', name: 'Gold', level: 17, shape: 'swallow', c: ['#D7A332', '#1E2A33'] },
];

/** Wake styles, opened by level. */
export const WAKES = [
  { id: 'foam', name: 'Foam', level: 1 },
  { id: 'ribbon', name: 'Ribbon', level: 4 },
  { id: 'pearls', name: 'Pearls', level: 8 },
  { id: 'twin', name: 'Twin', level: 12 },
];

/** Your horn at the finish (and in the harbour when you pick it), opened by level. */
export const HORNS = [
  { id: 'brass', name: 'Brass', level: 1 },
  { id: 'fog', name: 'Foghorn', level: 6 },
  { id: 'whistle', name: 'Whistle', level: 10 },
  { id: 'conch', name: 'Conch', level: 15 },
];

/** Liveries open by level: four to start, the rest one a level. */
export const LIVERY_LEVELS = [1, 1, 1, 1, 2, 3, 4, 5, 6, 7];

export const CLASS_UNLOCKS = {
  dinghy: { level: 1, cup: -1 },
  skiff: { level: 4, cup: 1 },
  catboat: { level: 7, cup: 3 },
  cat: { level: 10, cup: 5 },
};

/** Boat names, earned with levels, shown on the results card. */
export const BOAT_NAMES = [
  'Tern', 'Little Auk', 'Ninepins', 'Saltmarsh', 'Kestrel', 'Long Shot', 'Fair Isle', 'Weatherly', 'Jackdaw', 'Second Wind',
  'Dogwatch', 'Fetch', 'Gull Rock', 'Heave To', 'Sea Room', 'Close Call', 'Quiet Water', 'Last Light', 'Overstand', 'Port Wine',
];

export const BADGES = [
  { id: 'first-race', name: 'First Race', description: 'Finish a race.' },
  { id: 'clean-tack', name: 'Clean Tack', description: 'Ten clean tacks in one race.' },
  { id: 'wind-thief', name: 'Wind Thief', description: 'Slow three boats with your shadow in one race.' },
  { id: 'photo-finish', name: 'Photo Finish', description: 'Win by under half a second.' },
  { id: 'perfect-start', name: 'Perfect Start', description: 'Cross within half a second of the gun at full speed.' },
  { id: 'no-fouls', name: 'No Fouls', description: 'Finish a race under racing rules without a foul.' },
  { id: 'gust-rider', name: 'Gust Rider', description: 'Sail a full minute in gusts in one race.' },
  { id: 'ghost-buster', name: 'Ghost Buster', description: 'Beat your own ghost in a time trial.' },
  { id: 'par-excellence', name: 'Par Excellence', description: 'Win a gold medal on any course.' },
  { id: 'cup-winner', name: 'Cup Winner', description: 'Win a Career cup.' },
  { id: 'every-weather', name: 'Every Weather', description: 'Race in all six weathers.' },
  { id: 'captain', name: 'Captain', description: 'Reach Captain level 10.' },
];

/** A fresh profile. */
export function newProfile() {
  return {
    v: VERSION,
    xp: 0,
    races: 0,
    wins: 0,
    points: 0,
    tutorial: false,
    look: { livery: 0, pattern: 'plain', cls: 'dinghy', name: 0, flag: 'none', wake: 'foam', horn: 'brass' },
    medals: {},
    best: {},
    weathers: {},
    career: { cups: {}, cur: null },
    hints: {},
    badges: {},
    stats: { cleanTacks: 0, steals: 0, starts: 0 },
    lastRace: '',
  };
}

const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Reads any saved value into a valid profile (never throws). */
export function parseProfile(raw) {
  const p = newProfile();
  let r = raw;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch {
      r = null;
    }
  }
  if (!r || typeof r !== 'object') return p;
  // Newer versions keep the fields this one knows; older ones are upgraded field by field.
  p.xp = num(r.xp, 0, 1e9);
  p.races = Math.floor(num(r.races, 0, 1e7));
  p.wins = Math.floor(num(r.wins, 0, 1e7));
  p.points = Math.floor(num(r.points, 0, 1e9));
  p.tutorial = r.tutorial === true;
  const lk = obj(r.look);
  p.look.livery = Math.floor(num(lk.livery, 0, 9));
  p.look.pattern = PATTERNS.some((x) => x.id === lk.pattern) ? lk.pattern : 'plain';
  p.look.cls = ['dinghy', 'skiff', 'catboat', 'cat'].includes(lk.cls) ? lk.cls : 'dinghy';
  p.look.name = Math.floor(num(lk.name, 0, BOAT_NAMES.length - 1));
  p.look.flag = FLAGS.some((x) => x.id === lk.flag) ? lk.flag : 'none';
  p.look.wake = WAKES.some((x) => x.id === lk.wake) ? lk.wake : 'foam';
  p.look.horn = HORNS.some((x) => x.id === lk.horn) ? lk.horn : 'brass';
  for (const [k, v] of Object.entries(obj(r.medals))) if (/^\d{1,2}$/.test(k)) p.medals[k] = Math.floor(num(v, 0, 3));
  for (const [k, v] of Object.entries(obj(r.best))) if (/^\d{1,2}$/.test(k) && num(v, 1, 36000, 0) > 0) p.best[k] = num(v, 1, 36000);
  for (const k of ['light', 'moderate', 'fresh', 'shifty', 'squall', 'fog']) if (obj(r.weathers)[k] === true) p.weathers[k] = true;
  const car = obj(r.career);
  for (const [k, v] of Object.entries(obj(car.cups))) if (/^\d$/.test(k)) p.career.cups[k] = Math.floor(num(v, 0, 3));
  const cur = obj(car.cur);
  if (Number.isInteger(cur.cup) && cur.cup >= 0 && cur.cup < 8 && Number.isInteger(cur.race) && cur.race >= 0 && cur.race < 3) {
    const pts = {};
    for (const [k, v] of Object.entries(obj(cur.pts))) if (typeof k === 'string' && k.length < 40) pts[k] = Math.floor(num(v, 0, 999));
    p.career.cur = { cup: cur.cup, race: cur.race, pts };
  }
  for (const [k, v] of Object.entries(obj(r.hints))) if (k.length < 32) p.hints[k] = Math.floor(num(v, 0, 99));
  for (const [k, v] of Object.entries(obj(r.badges))) if (k.length < 32 && v === true) p.badges[k] = true;
  const st = obj(r.stats);
  for (const k of Object.keys(p.stats)) p.stats[k] = Math.floor(num(st[k], 0, 1e9));
  if (typeof r.lastRace === 'string' && r.lastRace.length < 80) p.lastRace = r.lastRace;
  return p;
}

// ------------------------------------------------------------------------------------------------ levels

/** Total experience needed for a Captain level (level 1 at 0). */
export function xpFor(level) {
  const L = Math.max(1, level);
  return 25 * (L - 1) * (L + 4);
}

export function levelOf(xp) {
  let L = 1;
  while (L < 40 && xp >= xpFor(L + 1)) L++;
  return L;
}

/** Progress within the current level, 0..1. */
export function levelProgress(xp) {
  const L = levelOf(xp);
  const a = xpFor(L);
  const b = xpFor(L + 1);
  return Math.max(0, Math.min(1, (xp - a) / (b - a)));
}

export function liveryOpen(p, i) {
  return levelOf(p.xp) >= (LIVERY_LEVELS[i] ?? 99);
}

/** Is a flag, wake style or horn from one of the lists above open at this profile's level? */
export function cosmeticOpen(p, list, id) {
  const it = list.find((x) => x.id === id);
  return !!it && levelOf(p.xp) >= it.level;
}

export function patternOpen(p, id) {
  const pt = PATTERNS.find((x) => x.id === id);
  return !!pt && levelOf(p.xp) >= pt.level;
}

export function classOpen(p, cls) {
  const u = CLASS_UNLOCKS[cls];
  if (!u) return false;
  if (levelOf(p.xp) >= u.level) return true;
  return u.cup >= 0 && (p.career.cups[u.cup] ?? 0) >= 1;
}

export function nameOpen(p, i) {
  return i < 2 + Math.floor(levelOf(p.xp) / 2) * 2;
}

/** What one finished race is worth: experience, fleet points, and the parts of both (for the results card). */
export function raceReward({ place, fleet, cleanTacks = 0, steals = 0, perfectStart = false, medal = 0, finished = true }) {
  const parts = [];
  if (!finished) return { xp: 10, points: 0, parts: [['Sailed', 10]] };
  parts.push(['Finished', 40]);
  const beat = Math.max(0, fleet - place);
  if (beat) parts.push([`Beat ${beat}`, beat * 8]);
  if (place === 1 && fleet > 1) parts.push(['Won', 30]);
  if (cleanTacks) parts.push(['Clean tacks', Math.min(20, cleanTacks * 2)]);
  if (steals) parts.push(['Wind stolen', Math.min(25, steals * 5)]);
  if (perfectStart) parts.push(['Perfect start', 15]);
  if (medal) parts.push([['', 'Bronze', 'Silver', 'Gold'][medal], [0, 15, 25, 40][medal]]);
  const xp = parts.reduce((a, [, v]) => a + v, 0);
  const points = fleet > 1 ? ([0, 10, 8, 6, 5, 4, 3, 2, 1][place] ?? 1) : 0;
  return { xp, points, parts };
}

// ------------------------------------------------------------------------------------------------ medals

/**
 * Par times (s) per course in time-trial conditions (Classic, fixed wind): a Skipper's time, measured with
 * scripts/balance.mjs. Gold within par, silver within 6%, bronze within 14%.
 */
export const PARS = { 1: 274, 2: 293, 3: 228, 4: 294, 5: 239, 6: 314, 7: 159, 8: 270, 9: 309, 10: 308, 11: 299, 12: 230 };

export function medalFor(courseId, t) {
  const par = PARS[courseId];
  if (!par || !Number.isFinite(t)) return 0;
  if (t <= par) return 3;
  if (t <= par * 1.06) return 2;
  if (t <= par * 1.14) return 1;
  return 0;
}

// ------------------------------------------------------------------------------------------------ ghosts

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

function fromB64(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A');
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return out;
}

export const GHOST_HZ = 4;

/** Packs a path sampled at 4 Hz ([{x, y}]) as decimetre steps in signed bytes (big steps are split over samples). */
export function packGhost(points, time, cls) {
  if (!points.length) return null;
  const bytes = [];
  let px = Math.round(points[0].x * 10);
  let py = Math.round(points[0].y * 10);
  const x0 = px;
  const y0 = py;
  for (let i = 1; i < points.length; i++) {
    const tx = Math.round(points[i].x * 10);
    const ty = Math.round(points[i].y * 10);
    const dx = Math.max(-127, Math.min(127, tx - px));
    const dy = Math.max(-127, Math.min(127, ty - py));
    px += dx;
    py += dy;
    bytes.push(dx & 255, dy & 255);
  }
  return { v: 1, t: Math.round(time * 1000) / 1000, cls, x0, y0, d: toB64(bytes) };
}

/** Unpacks a ghost into points (metres), or null if it is not one. */
export function unpackGhost(g) {
  if (!g || typeof g !== 'object' || typeof g.d !== 'string' || g.d.length > 60000) return null;
  if (!Number.isFinite(g.x0) || !Number.isFinite(g.y0) || !Number.isFinite(g.t)) return null;
  const bytes = fromB64(g.d);
  const pts = [{ x: g.x0 / 10, y: g.y0 / 10 }];
  let x = g.x0;
  let y = g.y0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    x += (bytes[i] << 24) >> 24;
    y += (bytes[i + 1] << 24) >> 24;
    pts.push({ x: x / 10, y: y / 10 });
  }
  return { t: g.t, cls: g.cls ?? 'dinghy', pts };
}

/** A ghost's pose at a time (s since the gun... or since the trial's clock started): position and heading. */
export function ghostAt(gh, t, out) {
  const f = Math.max(0, t * GHOST_HZ);
  const i = Math.min(gh.pts.length - 1, Math.floor(f));
  const j = Math.min(gh.pts.length - 1, i + 1);
  const k = f - i;
  const a = gh.pts[i];
  const b = gh.pts[j];
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  const n = gh.pts[Math.min(gh.pts.length - 1, j + 1)];
  out.h = Math.atan2(n.y - a.y, n.x - a.x) || out.h || -Math.PI / 2;
  out.done = i >= gh.pts.length - 1;
  return out;
}
