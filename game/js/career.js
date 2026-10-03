// Career: eight cups of three races against rival skippers, harder as it goes. Each race has fixed conditions (its own
// seed), so a cup is a designed series; points decide the cup. Pure data and arithmetic.

import { botEntries } from './sim/skippers.js';
import { hash32 } from './sim/rng.js';

export const POINTS = [0, 10, 8, 6, 5, 4, 3, 2, 1];

export const CUPS = [
  {
    name: 'Harbour Cup',
    note: 'Moderate · casual',
    rules: 'casual',
    skills: [0, 0, 0, 1, 1],
    races: [
      { course: 1, weather: 'moderate', laps: 1 },
      { course: 7, weather: 'moderate', laps: 1 },
      { course: 2, weather: 'moderate', laps: 1 },
    ],
  },
  {
    name: 'Estuary Cup',
    note: 'Light airs · shoals',
    rules: 'casual',
    skills: [0, 1, 1, 1, 2],
    races: [
      { course: 8, weather: 'light', laps: 1 },
      { course: 4, weather: 'moderate', laps: 2 },
      { course: 10, weather: 'moderate', laps: 1 },
    ],
  },
  {
    name: 'Gannet Cup',
    note: 'Shifty · racing rules',
    rules: 'racing',
    skills: [1, 1, 2, 2, 2],
    races: [
      { course: 3, weather: 'shifty', laps: 1 },
      { course: 6, weather: 'shifty', laps: 1 },
      { course: 1, weather: 'shifty', laps: 2 },
    ],
  },
  {
    name: 'Fresh Breeze Cup',
    note: 'Fresh breeze',
    rules: 'racing',
    skills: [1, 2, 2, 2, 3],
    mixed: true,
    races: [
      { course: 11, weather: 'fresh', laps: 1 },
      { course: 2, weather: 'fresh', laps: 2 },
      { course: 5, weather: 'fresh', laps: 1 },
    ],
  },
  {
    name: 'Fog Cup',
    note: 'Fog',
    rules: 'racing',
    skills: [2, 2, 2, 3, 3],
    races: [
      { course: 12, weather: 'fog', laps: 1 },
      { course: 9, weather: 'fog', laps: 1 },
      { course: 8, weather: 'fog', laps: 1 },
    ],
  },
  {
    name: 'Squall Cup',
    note: 'Squalls',
    rules: 'racing',
    skills: [1, 2, 2, 3, 3, 3],
    races: [
      { course: 5, weather: 'squall', laps: 1 },
      { course: 4, weather: 'squall', laps: 2 },
      { course: 11, weather: 'squall', laps: 1 },
    ],
  },
  {
    name: 'Coastal Cup',
    note: 'Islands · mixed classes',
    rules: 'racing',
    skills: [2, 2, 3, 3, 3, 3],
    mixed: true,
    races: [
      { course: 9, weather: 'moderate', laps: 1 },
      { course: 3, weather: 'shifty', laps: 1 },
      { course: 12, weather: 'fresh', laps: 1 },
    ],
  },
  {
    name: 'Admiralty Cup',
    note: 'Legends',
    rules: 'racing',
    skills: [3, 3, 3, 3, 3, 3, 3],
    mixed: true,
    races: [
      { course: 1, weather: 'shifty', laps: 3 },
      { course: 11, weather: 'fresh', laps: 2 },
      { course: 9, weather: 'light', laps: 1 },
    ],
  },
];

export const careerSeed = (cup, race) => hash32(7000 + cup, race, 31);

/** Is a cup open? The first always; each next one after a medal in the one before. */
export function cupOpen(cups, i) {
  return i === 0 || (cups[i - 1] ?? 0) >= 1;
}

/** The fleet for a career race: the cup's skippers, the same names all cup long. */
export function careerBots(cup) {
  const c = CUPS[cup];
  const clsFor = (i) => (c.mixed ? ['dinghy', 'skiff', 'catboat', 'cat'][(i + cup) % 4] : 'dinghy');
  return botEntries(hash32(4200 + cup), c.skills.length, c.skills, clsFor);
}

/**
 * Adds a race's finishing order (ids, best first; DNF last) to the cup's points; returns the new table sorted
 * (ties broken by the last race).
 */
export function addRace(pts, order) {
  const out = { ...pts };
  order.forEach((id, i) => {
    out[id] = (out[id] ?? 0) + (POINTS[i + 1] ?? 0);
  });
  return out;
}

export function table(pts, lastOrder = []) {
  return Object.entries(pts)
    .map(([id, p]) => ({ id, pts: p }))
    .sort((a, b) => b.pts - a.pts || lastOrder.indexOf(a.id) - lastOrder.indexOf(b.id));
}

/** The medal for a final table position (1st gold = 3, 2nd silver, 3rd bronze). */
export const medalForPlace = (place) => (place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0);
