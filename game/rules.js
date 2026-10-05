// The rules of Color Block Party: pure data and functions, no window, no document, no platform. Tests import this.
import { makeRng, hash32 } from './rng.js';

export const COLS = 12;
export const ROWS = 8;
export const TILES = COLS * ROWS;
export const TOP_SPEED = 5; // tiles per second

export const COLORS = [
  { key: 'red', name: 'RED', symbol: 'heart', hex: '#ff4d5e' },
  { key: 'yellow', name: 'YELLOW', symbol: 'star', hex: '#ffd23f' },
  { key: 'green', name: 'GREEN', symbol: 'clover', hex: '#2fd46b' },
  { key: 'blue', name: 'BLUE', symbol: 'circle', hex: '#2f8cff' },
  { key: 'purple', name: 'PURPLE', symbol: 'diamond', hex: '#a45cf0' },
  { key: 'orange', name: 'ORANGE', symbol: 'triangle', hex: '#ff8a2b' },
];

/** Twelve saturated player colours, handed out in roster order. */
export const PLAYER_COLORS = [
  '#ff5fa2', '#19d3da', '#b6e82e', '#e040fb', '#12b886', '#ff7a59',
  '#5aa9ff', '#ffc02e', '#b39cff', '#ff3d7f', '#7af0b5', '#e0763c',
];

export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];

export const SETTINGS = [
  { id: 'rounds', label: 'Rounds', options: [1, 3, 5], default: 3 },
  {
    id: 'speed',
    label: 'Speed',
    options: [
      { value: 'chill', label: 'Chill' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' },
    ],
    default: 'normal',
  },
];

// Times, in match milliseconds.
export const GO_MS = 900; // the match's first moments belong to the big GO!
export const BANNER_MS = 1500; // the round banner, floor already there
export const PRE_MS = 600; // the new floor is up, the call hasn't come yet
export const DOWN_MS = 1000; // from the drop until the floor is back
export const GRACE_MS = 600; // the host waits this long after a drop for the players' own verdicts
export const END_MS = 2400; // the round's winner
export const BOARD_MS = 4000; // the scoreboard between rounds
export const FINAL_MS = 8000; // the podium
export const STEPS_MAX = 20;
export const TABLE = 8; // bots fill the match up to this many dancers
export const MAX_DANCERS = 12;

export const SPEEDS = {
  chill: { start: 4400, min: 1800 },
  normal: { start: 3600, min: 1400 },
  fast: { start: 2800, min: 1100 },
};

export const PLACE_POINTS = [10, 7, 5, 4, 3, 2];
export const placePoints = (place) => PLACE_POINTS[place - 1] ?? 1;

/** How long the players have to get onto the called colour, in ms: 7% shorter every step, down to a floor. */
export function reactMs(step, speed) {
  const s = SPEEDS[speed] ?? SPEEDS.normal;
  return Math.round(Math.max(s.min, s.start * Math.pow(0.93, Math.max(0, step - 1))));
}

/** The moments of a step, from the record: the floor appears (fa), the call (ca), the drop (da), the floor is back (ea). */
export function timeline(g) {
  const da = g.ca + reactMs(g.step, g.speed);
  return { fa: g.fa, ca: g.ca, da, ea: da + DOWN_MS };
}

/** The share of tiles that are the called colour: 22% on the first step, 6% from step 15. */
export function calledFraction(step) {
  return 0.22 - 0.16 * Math.min(1, Math.max(0, step - 1) / 14);
}

export const calledMin = (alive) => Math.max(3, Math.ceil(alive / 2));

const NEIGHBOURS = Array.from({ length: TILES }, (_, i) => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  const list = [];
  if (c > 0) list.push(i - 1);
  if (c < COLS - 1) list.push(i + 1);
  if (r > 0) list.push(i - COLS);
  if (r < ROWS - 1) list.push(i + COLS);
  return list;
});

const singleChance = (step) => (step < 6 ? 0 : Math.min(0.7, 0.3 + 0.08 * (step - 6)));

/** Paints a patch of up to `size` tiles of `color` onto free (255) cells. Returns how many it painted. */
function growPatch(colors, rng, color, size) {
  const free = [];
  for (let i = 0; i < TILES; i++) if (colors[i] === 255) free.push(i);
  if (free.length === 0) return 0;
  const cells = [free[rng.int(free.length)]];
  colors[cells[0]] = color;
  while (cells.length < size) {
    const options = [];
    for (const cell of cells) for (const n of NEIGHBOURS[cell]) if (colors[n] === 255 && !options.includes(n)) options.push(n);
    if (options.length === 0) break;
    const pick = options[rng.int(options.length)];
    colors[pick] = color;
    cells.push(pick);
  }
  return cells.length;
}

/**
 * A floor from a seed: 96 tile colours (0-5), the called colour and a mask of the tiles that stay. The called colour
 * gets its share of tiles (fewer every step) in several patches, single tiles from step 6, and never fewer than
 * max(3, alive / 2). Every page makes the same floor from the same seed.
 */
export function makeFloor(seed, step, alive) {
  const rng = makeRng(seed);
  const colors = new Uint8Array(TILES).fill(255);
  const call = rng.int(COLORS.length);
  const want = Math.min(40, Math.max(Math.round(calledFraction(step) * TILES), calledMin(alive)));
  const single = singleChance(step);
  let placed = 0;
  while (placed < want) {
    const size = single > 0 && rng.chance(single) ? 1 : 2 + rng.int(step < 6 ? 4 : 2);
    placed += growPatch(colors, rng, call, Math.min(size, want - placed));
  }
  const counts = new Array(COLORS.length).fill(0);
  let free = TILES - placed;
  while (free > 0) {
    let best = -1;
    let bestScore = Infinity;
    for (let c = 0; c < COLORS.length; c++) {
      if (c === call) continue;
      const score = counts[c] + rng.next() * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    const n = growPatch(colors, rng, best, Math.min(2 + rng.int(5), free));
    counts[best] += n;
    free -= n;
  }
  const stand = new Uint8Array(TILES);
  for (let i = 0; i < TILES; i++) stand[i] = colors[i] === call ? 1 : 0;
  return { colors, call, stand, count: placed };
}

/** Distance from a point to a tile's square (0 when the point is over it). */
export function tileDist(x, y, i) {
  const tx = i % COLS;
  const ty = Math.floor(i / COLS);
  const dx = Math.max(tx - x, 0, x - tx - 1);
  const dy = Math.max(ty - y, 0, y - ty - 1);
  return Math.hypot(dx, dy);
}

/** The farthest any of these positions is from its nearest called tile. */
export function worstDistance(floor, positions) {
  let worst = 0;
  for (const p of positions) {
    let nearest = Infinity;
    for (let i = 0; i < TILES; i++) if (floor.stand[i]) nearest = Math.min(nearest, tileDist(p.x, p.y, i));
    if (nearest > worst) worst = nearest;
  }
  return worst;
}

/** How far a player can be from a called tile and still make it in `react` ms (a human's reaction, then running). */
export function reachFor(react) {
  return Math.max(1.5, TOP_SPEED * (react / 1000 - 0.4) - 0.6);
}

/**
 * The seed of the next floor. The host knows where everyone stands, so it tries seeds until the called colour is within
 * reach of every dancer; the pages only ever see the chosen seed. (If none is good enough, the best of the tries.)
 */
export function chooseStepSeed(base, step, alive, positions, react) {
  const reach = reachFor(react);
  let best = hash32(base, step * 131);
  let bestWorst = Infinity;
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = hash32(base, step * 131 + attempt);
    const floor = makeFloor(seed, step, alive);
    const worst = worstDistance(floor, positions);
    if (worst <= reach) return seed;
    if (worst < bestWorst) {
      bestWorst = worst;
      best = seed;
    }
  }
  return best;
}

/** Where a round starts everyone: spread out over the tiles, in roster order. */
export function roundSpawns(sd, round, n) {
  const rng = makeRng(hash32(sd, 7000 + round));
  const cells = rng.shuffle(Array.from({ length: TILES }, (_, i) => i));
  const out = [];
  let minD = 2.8;
  for (let pass = 0; pass < 24 && out.length < n; pass++) {
    for (const i of cells) {
      if (out.length >= n) break;
      const x = (i % COLS) + 0.5;
      const y = Math.floor(i / COLS) + 0.5;
      let ok = true;
      for (const p of out) {
        if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minD * minD) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ x, y });
    }
    minD *= 0.8;
  }
  while (out.length < n) out.push({ x: COLS / 2, y: ROWS / 2 }); // unreachable with 96 cells, but never short
  return out;
}

/** Names for the bots of a match. */
export function botNames(seed, n) {
  return makeRng(hash32(seed, 4242)).shuffle([...BOT_NAMES]).slice(0, n);
}

/** The code a player's presence carries once they've fallen on a step. */
export const fellCode = (round, step) => round * 1000 + step;

/**
 * A round's result from the step each dancer fell on (`out`; the ones not in it are still standing). Later is better;
 * dancers who fell on the same drop share the better place and its points.
 */
export function roundResult(ids, out) {
  const key = (id) => out[id] ?? 1e9;
  const order = [...ids].sort((a, b) => key(b) - key(a));
  const place = {};
  const pts = {};
  let winners = [];
  for (let i = 0; i < order.length; i++) {
    const first = i > 0 && key(order[i - 1]) === key(order[i]) ? place[order[i - 1]] : i + 1;
    place[order[i]] = first;
    pts[order[i]] = placePoints(first);
    if (first === 1) winners.push(order[i]);
  }
  return { place, pts, winners };
}

/** The match's order: points, then steps survived, then roster order. Ties share a place. */
export function rankMatch(ids, scores, sv = {}) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const list = ids.map((id) => ({ id, score: scores[id] ?? 0, sv: sv[id] ?? 0, place: 0 }));
  list.sort((a, b) => b.score - a.score || b.sv - a.sv || index.get(a.id) - index.get(b.id));
  list.forEach((entry, i) => {
    const prev = list[i - 1];
    entry.place = prev && prev.score === entry.score && prev.sv === entry.sv ? prev.place : i + 1;
  });
  return list;
}

/** "Pushiest" (most pushes that landed) and "Lucky Feet" (most steps survived), among the ranked ids. */
export function computeAwards(order, pu, sv) {
  let push = null;
  let lucky = null;
  for (const id of order) {
    if ((pu[id] ?? 0) > (push ? pu[push] : 0)) push = id;
    if ((sv[id] ?? 0) > (lucky ? sv[lucky] : 0)) lucky = id;
  }
  return { push, lucky };
}

export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
