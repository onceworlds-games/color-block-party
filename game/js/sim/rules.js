// Contact between boats, and who pays for it. Casual: a bump costs both. Racing: starboard over port, leeward over
// windward, clear ahead over clear astern; a boat tacking, returning from over the line, or serving a penalty keeps
// clear of everyone. The boat at fault stalls for two seconds and flies a flag; the boat in the right loses nothing.

import { BOAT_R } from './boat.js';

export const CONTACT_LOSS = 0.15;
export const FOUL_STALL = 2;
const PAIR_COOLDOWN = 1.5;
const FOUL_COOLDOWN = 8; // two boats tangled together pay once, not every bump

/**
 * A boat that must keep clear of everyone right now: serving a penalty, returning from over the line, tacking, or
 * within two seconds of finishing a tack or gybe (a boat that gains right of way must leave the other room to react).
 */
export function keepsClear(b, now = Infinity) {
  return b.penalty > 0 || b.ocs || (b.man !== null && b.man.kind === 'tack') || now - b.lastMan < 2;
}

/**
 * The boat that must keep clear in a meeting of a and b: returns a, b, or null when neither (both keep clear).
 * Uses each boat's last wind reading (side, wind vector).
 */
export function giveWay(a, b, now = Infinity) {
  const ka = keepsClear(a, now);
  const kb = keepsClear(b, now);
  if (ka && !kb) return a;
  if (kb && !ka) return b;
  if (ka && kb) return null;
  if (a.side !== b.side) return a.side < 0 ? a : b; // port gives way to starboard
  // Same tack: clear astern keeps clear; otherwise (overlapped) the windward boat does.
  const ahx = Math.cos(a.h);
  const ahy = Math.sin(a.h);
  const bhx = Math.cos(b.h);
  const bhy = Math.sin(b.h);
  const aBehindB = (a.x - b.x) * bhx + (a.y - b.y) * bhy;
  const bBehindA = (b.x - a.x) * ahx + (b.y - a.y) * ahy;
  if (aBehindB < -3) return a;
  if (bBehindA < -3) return b;
  const wx = (a.wx + b.wx) / 2;
  const wy = (a.wy + b.wy) / 2;
  const ms = Math.hypot(wx, wy) || 1;
  // Further upwind = smaller projection on the wind's direction: that one is to windward.
  const pa = (a.x * wx + a.y * wy) / ms;
  const pb = (b.x * wx + b.y * wy) / ms;
  if (Math.abs(pa - pb) < 1e-6) return a.id < b.id ? a : b;
  return pa < pb ? a : b;
}

const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

/**
 * Separates touching boats and settles who pays. Only boats this page simulates are moved; a boat drawn from the
 * network is a fixed obstacle here (its own page moves it). Pushes `foul` and `bump` events.
 */
export function resolveContacts(race, events) {
  const boats = race.boats;
  const racing = race.rules === 'racing';
  const D = BOAT_R * 2;
  const now = race.t;
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < boats.length; i++) {
      const a = boats[i];
      if (!touchable(a)) continue;
      for (let j = i + 1; j < boats.length; j++) {
        const b = boats[j];
        if (!touchable(b) || (a.remote && b.remote)) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Exactly on top of each other: part them across the wind, deterministically.
          dx = a.id < b.id ? 1 : -1;
          dy = 0;
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const overlap = Math.min(1.2, D - Math.max(d, 0.001));
        const culprit = racing ? giveWay(a, b, now) : null;
        // Share the push: the boat at fault moves most; a network boat doesn't move at all.
        let sa = culprit === a ? 0.8 : culprit === b ? 0.2 : 0.5;
        if (a.remote) sa = 0;
        if (b.remote) sa = 1;
        const push = Math.min(0.6, overlap);
        if (!a.remote) {
          a.x -= nx * push * sa;
          a.y -= ny * push * sa;
        }
        if (!b.remote) {
          b.x += nx * push * (1 - sa);
          b.y += ny * push * (1 - sa);
        }
        if (iter > 0) continue;
        const key = pairKey(a, b);
        const last = race.contacts.get(key);
        race.contacts.set(key, now);
        if (last !== undefined && now - last < PAIR_COOLDOWN) continue;
        if (racing && culprit) {
          const other = culprit === a ? b : a;
          if (!culprit.remote) {
            culprit.v *= 1 - CONTACT_LOSS;
            const fk = `f${key}`;
            const lastFoul = race.contacts.get(fk);
            if (culprit.penalty <= 0 && (lastFoul === undefined || now - lastFoul >= FOUL_COOLDOWN)) {
              race.contacts.set(fk, now);
              culprit.penalty = FOUL_STALL;
              culprit.foulFlag = 6;
              culprit.stats.fouls++;
              events.push({ type: 'foul', id: culprit.id, other: other.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
          }
          if (!other.remote) other.v *= 0.97;
        } else {
          if (!a.remote) a.v *= 1 - CONTACT_LOSS;
          if (!b.remote) b.v *= 1 - CONTACT_LOSS;
          events.push({ type: 'bump', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
    }
  }
  // Forget old pairs so the map stays small.
  if (race.contacts.size > 64) for (const [k, t] of race.contacts) if (now - t > FOUL_COOLDOWN) race.contacts.delete(k);
}

function touchable(b) {
  return !b.ghost && !b.finished && !b.retired && !b.parked;
}

/**
 * Who would be at fault if these two met now, for the "give way" notice: the give-way boat when they are close and
 * closing (time to contact under `horizon` seconds), else null.
 */
export function collisionCourse(a, b, horizon = 3, now = Infinity) {
  const avx = Math.cos(a.h) * a.v;
  const avy = Math.sin(a.h) * a.v;
  const bvx = Math.cos(b.h) * b.v;
  const bvy = Math.sin(b.h) * b.v;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const vx = bvx - avx;
  const vy = bvy - avy;
  const vv = vx * vx + vy * vy;
  if (vv < 1e-6) return null;
  const tc = -(rx * vx + ry * vy) / vv;
  if (tc < 0 || tc > horizon) return null;
  const cx = rx + vx * tc;
  const cy = ry + vy * tc;
  if (cx * cx + cy * cy > (BOAT_R * 2.6) ** 2) return null;
  return { t: tc, giveWay: giveWay(a, b, now) };
}
