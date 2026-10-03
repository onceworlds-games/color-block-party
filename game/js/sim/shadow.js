// Wind shadows: every sail leaves a cone of tired air downwind, and islands leave huge ones. Shadows multiply, with a
// floor (a lower one behind an island), and slow the wind for anything inside them.

import { DEG } from './polar.js';

export const SHADOW = {
  len: 36,
  half: 22 * DEG,
  max: 0.5,
  floor: 0.55, // however many sails are upwind, a boat keeps this much of its wind
  isleFloor: 0.3,
  isleLen: 160,
  isleHalf: 35 * DEG,
  isleMax: 0.62,
};
const TAN = Math.tan(SHADOW.half);
const ISLE_TAN = Math.tan(SHADOW.isleHalf);

/**
 * Strength (0..max) of a cone with its apex at (cx, cy), pointing along the unit vector (ux, uy), at (x, y):
 * max * (1 - d/L)^0.8 * (1 - lateral/(d tan a))^1.2.
 */
export function coneStrength(cx, cy, ux, uy, x, y, len = SHADOW.len, tanHalf = TAN, max = SHADOW.max) {
  const dx = x - cx;
  const dy = y - cy;
  const along = dx * ux + dy * uy;
  if (along <= 0.5 || along >= len) return 0;
  const lat = Math.abs(dx * uy - dy * ux);
  const w = along * tanHalf;
  if (lat >= w) return 0;
  return max * Math.pow(1 - along / len, 0.8) * Math.pow(1 - lat / w, 1.2);
}

/** Does this boat cast a shadow and feel one? Finished, parked, retired and ghost boats don't. */
export function interacts(b) {
  return !b.ghost && !b.finished && !b.retired && !b.parked;
}

/**
 * The factor (isleFloor..1) the wind is multiplied by at boat `b`, from every other boat and every island. Also records
 * who is sitting in whose shadow (for "Wind Thief"): `onShadow(caster, receiver, strength)` if given.
 */
export function shadowFactor(race, b, onShadow) {
  if (b.ghost || race.noShadows) return 1;
  let f = 1;
  for (const o of race.boats) {
    if (o === b || !interacts(o)) continue;
    const ms = Math.hypot(o.wx, o.wy);
    if (ms < 0.05) continue;
    const dx = b.x - o.x;
    const dy = b.y - o.y;
    if (dx * dx + dy * dy > SHADOW.len * SHADOW.len) continue;
    const s = coneStrength(o.x, o.y, o.wx / ms, o.wy / ms, b.x, b.y);
    if (s > 0) {
      f *= 1 - s;
      if (onShadow) onShadow(o, b, s);
    }
  }
  f = Math.max(SHADOW.floor, f);
  for (const il of race.course.islands) {
    const s = islandShadow(race, il, b.x, b.y);
    if (s > 0) f *= 1 - s;
  }
  return Math.max(SHADOW.isleFloor, f);
}

/** An island's shadow at a point; the cone's apex sits upwind so the cone is as wide as the island at its centre. */
export function islandShadow(race, il, x, y) {
  const w = il.wind;
  if (!w) return 0;
  const ms = Math.hypot(w.vx, w.vy) || 1;
  const ux = w.vx / ms;
  const uy = w.vy / ms;
  const back = il.sr / ISLE_TAN;
  return coneStrength(il.x - ux * back, il.y - uy * back, ux, uy, x, y, SHADOW.isleLen + back, ISLE_TAN, SHADOW.isleMax);
}
