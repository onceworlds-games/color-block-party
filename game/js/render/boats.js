// Boats drawn from above: a hull with a slight print offset, a bellied sail on the leeward side (flogging when it
// luffs), the crew out on the rail when hiking, a sail number and a shape mark, foam wakes and hatched wind shadows.

import { PALETTE, LIVERIES, FONT_SERIF, FONT_MONO } from './view.js';
import { SHADOW } from '../sim/shadow.js';

const DEG = Math.PI / 180;

/** The wake: a ring of stern positions per boat. */
export function makeWakes() {
  return new Map();
}

export function updateWakes(wakes, boats, t, reduced) {
  for (const b of boats) {
    let w = wakes.get(b.id);
    if (!w) wakes.set(b.id, (w = { pts: [], last: -1 }));
    if (t - w.last < (reduced ? 0.3 : 0.12)) continue;
    w.last = t;
    const sx = b.drawX - Math.cos(b.drawH) * 2.1;
    const sy = b.drawY - Math.sin(b.drawH) * 2.1;
    w.pts.push({ x: sx, y: sy, t, v: b.v, h: b.drawH });
    const keep = reduced ? 6 : 26;
    while (w.pts.length > keep) w.pts.shift();
  }
  for (const id of wakes.keys()) if (!boats.some((b) => b.id === id)) wakes.delete(id);
}

export function drawWakes(view, wakes, boats, t, reduced) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  ctx.lineCap = 'round';
  for (const b of boats) {
    const w = wakes.get(b.id);
    if (!w || w.pts.length < 2 || b.alpha < 0.3) continue;
    const life = reduced ? 1.8 : 3.2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      let started = false;
      for (let i = w.pts.length - 1; i >= 0; i--) {
        const p = w.pts[i];
        const age = t - p.t;
        if (age > life) break;
        const spread = 0.35 + age * (0.25 + p.v * 0.12);
        const px = p.x + Math.cos(p.h + Math.PI / 2) * spread * side;
        const py = p.y + Math.sin(p.h + Math.PI / 2) * spread * side;
        if (!started) {
          ctx.moveTo(b.drawX - Math.cos(b.drawH) * 2.1, b.drawY - Math.sin(b.drawH) * 2.1);
          started = true;
        }
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(251,248,240,${(0.85 * b.alpha).toFixed(2)})`;
      ctx.lineWidth = Math.max(1.2 / z, Math.min(0.7, 0.18 + b.v * 0.07));
      ctx.stroke();
    }
  }
}

/** The hull outline in boat coordinates (x forward, y to starboard), metres. */
function hullPath(ctx, beam = 1) {
  ctx.beginPath();
  ctx.moveTo(2.3, 0);
  ctx.quadraticCurveTo(1.25, -0.98 * beam, -0.35, -0.93 * beam);
  ctx.lineTo(-2.2, -0.72 * beam);
  ctx.lineTo(-2.2, 0.72 * beam);
  ctx.lineTo(-0.35, 0.93 * beam);
  ctx.quadraticCurveTo(1.25, 0.98 * beam, 2.3, 0);
  ctx.closePath();
}

/** The twin hulls of a catamaran. */
function catPath(ctx) {
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(2.4, s * 1.05);
    ctx.quadraticCurveTo(0.6, s * 1.45, -2.1, s * 1.3);
    ctx.lineTo(-2.1, s * 0.85);
    ctx.quadraticCurveTo(0.6, s * 0.7, 2.4, s * 1.05);
  }
}

/** Draws a shape mark centred at (0, 0), radius r (local units). */
export function shapePath(ctx, shape, r) {
  ctx.beginPath();
  switch (shape) {
    case 'triangle':
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.92, r * 0.7);
      ctx.lineTo(-r * 0.92, r * 0.7);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56);
      break;
    case 'diamond':
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      break;
    case 'star':
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        const rr = k % 2 ? r * 0.45 : r;
        if (k) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    case 'cross':
      ctx.rect(-r, -r * 0.3, r * 2, r * 0.6);
      ctx.rect(-r * 0.3, -r, r * 0.6, r * 2);
      break;
    case 'ring':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.moveTo(r * 0.5, 0);
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2, true);
      break;
    case 'bar':
      ctx.rect(-r, -r * 0.35, r * 2, r * 0.7);
      break;
    case 'chevron':
      ctx.moveTo(-r, -r * 0.2);
      ctx.lineTo(0, -r);
      ctx.lineTo(r, -r * 0.2);
      ctx.lineTo(r, r * 0.4);
      ctx.lineTo(0, -r * 0.35);
      ctx.lineTo(-r, r * 0.4);
      ctx.closePath();
      break;
    case 'hex':
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
}

/** Sail patterns (cosmetic): drawn clipped to the sail. */
function sailPattern(ctx, pattern, color, len) {
  ctx.fillStyle = 'rgba(251,248,240,0.75)';
  switch (pattern) {
    case 'band':
      ctx.fillRect(-len * 0.55, -3, len * 0.18, 6);
      break;
    case 'stripes':
      for (let k = 0; k < 3; k++) ctx.fillRect(-len * (0.2 + k * 0.25), -3, len * 0.08, 6);
      break;
    case 'chevron':
      ctx.beginPath();
      ctx.moveTo(-len * 0.3, -3);
      ctx.lineTo(-len * 0.6, 0);
      ctx.lineTo(-len * 0.3, 3);
      ctx.lineTo(-len * 0.4, 3);
      ctx.lineTo(-len * 0.7, 0);
      ctx.lineTo(-len * 0.4, -3);
      ctx.fill();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(-len * 0.55, 0, 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'leech':
      ctx.fillRect(-len * 1.0, -3, len * 0.16, 6);
      break;
    case 'split':
      ctx.fillRect(-len * 1.1, 0, len * 1.2, 3);
      break;
    case 'star':
      ctx.save();
      ctx.translate(-len * 0.58, 0);
      shapePath(ctx, 'star', 0.5);
      ctx.fill();
      ctx.restore();
      break;
    default:
  }
}

/**
 * Draws one boat at its interpolated pose (b.drawX, b.drawY, b.drawH). Fields read: v, twa, side, luff, hiking, heel,
 * cls, livery, pattern, num, alpha, foul, ocs, ghost, flag.
 */
export function drawBoat(view, b, t, opts = {}) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const liv = LIVERIES[b.livery ?? 0] ?? LIVERIES[0];
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.drawX, b.drawY);
  ctx.rotate(b.drawH);
  const s = b.cls === 'catboat' ? 1.05 : b.cls === 'skiff' ? 0.98 : 1;
  ctx.scale(s, s);
  const leeward = -(b.side || 1); // the boom swings to the side away from the wind (+y is starboard)
  const beam = (b.cls === 'skiff' ? 0.82 : b.cls === 'catboat' ? 1.12 : 1) * (1 - 0.08 * (b.heel || 0));
  const off = 1.1 / z; // the print offset: the colour slips a little off the ink
  // Hull.
  if (b.cls === 'cat') {
    ctx.translate(off, off * 0.7);
    catPath(ctx);
    ctx.fillStyle = PALETTE.paperLight;
    ctx.fill();
    ctx.translate(-off, -off * 0.7);
    catPath(ctx);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.3 / z;
    ctx.stroke();
    // The trampoline between the hulls.
    ctx.beginPath();
    ctx.rect(-1.3, -0.95, 2.4, 1.9);
    ctx.fillStyle = 'rgba(30,42,51,0.18)';
    ctx.fill();
    ctx.lineWidth = 0.8 / z;
    ctx.stroke();
  } else {
    ctx.translate(off, off * 0.7);
    hullPath(ctx, beam);
    ctx.fillStyle = b.ghost ? 'rgba(246,240,226,0.4)' : PALETTE.paperLight;
    ctx.fill();
    ctx.translate(-off, -off * 0.7);
    hullPath(ctx, beam);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.4 / z;
    if (b.ghost) ctx.setLineDash([2 / z, 2 / z]);
    ctx.stroke();
    ctx.setLineDash([]);
    // The cockpit.
    ctx.beginPath();
    ctx.moveTo(-0.4, -0.5 * beam);
    ctx.lineTo(-1.9, -0.45 * beam);
    ctx.lineTo(-1.9, 0.45 * beam);
    ctx.lineTo(-0.4, 0.5 * beam);
    ctx.strokeStyle = 'rgba(30,42,51,0.5)';
    ctx.lineWidth = 0.9 / z;
    ctx.stroke();
  }
  // Shape mark on the stern deck (colour is never the only cue).
  ctx.save();
  ctx.translate(-1.75, 0);
  ctx.rotate(-b.drawH);
  shapePath(ctx, liv.shape, 0.36);
  ctx.fillStyle = PALETTE.slate;
  ctx.fill('evenodd');
  ctx.restore();
  // Crew: out on the windward rail when hiking.
  const crewY = (b.hiking ? 0.92 : 0.42) * -leeward * beam;
  ctx.fillStyle = PALETTE.inkSoft;
  ctx.beginPath();
  ctx.arc(-1.3, crewY, 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.6, crewY * (b.hiking ? 1 : 0.6), 0.22, 0, Math.PI * 2);
  ctx.fill();
  // Sails: seen from above, each is a crescent from its luff to its clew, bellied to leeward; it flogs when luffing.
  const mastX = b.cls === 'catboat' ? 1.55 : b.cls === 'cat' ? 0.35 : 0.75;
  const twa = b.twa ?? 90;
  const luff = Math.max(0, Math.min(1, b.luff ?? 0));
  let boom = Math.max(9, Math.min(84, (twa - 16) * 0.56)) * DEG;
  if (luff > 0.5) boom *= 1 - (luff - 0.5);
  const len = b.cls === 'catboat' ? 3.7 : b.cls === 'cat' ? 3.2 : b.cls === 'skiff' ? 3.3 : 3.1;
  const bx = mastX - Math.cos(boom) * len;
  const by = Math.sin(boom) * len * leeward;
  const sail = (x0, y0, x1, y1, belly) => {
    // Perpendicular to the foot, toward leeward.
    const fx = x1 - x0;
    const fy = y1 - y0;
    const fl = Math.hypot(fx, fy) || 1;
    let nx = -fy / fl;
    let ny = fx / fl;
    if (ny * leeward < 0) {
      nx = -nx;
      ny = -ny;
    }
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    if (luff > 0.15) {
      const n = 7;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const wob = Math.sin(t * 34 + k * 1.7 + x0) * 0.4 * luff * Math.sin(f * Math.PI);
        const bb = belly * Math.sin(f * Math.PI) * (1 - 0.6 * luff);
        ctx.lineTo(x0 + fx * f + nx * (bb + wob), y0 + fy * f + ny * (bb + wob));
      }
    } else ctx.quadraticCurveTo(x0 + fx * 0.45 + nx * belly * 2.5, y0 + fy * 0.45 + ny * belly * 2.5, x1, y1);
    // Back along the foot, slightly hollow.
    ctx.quadraticCurveTo(x0 + fx * 0.5 + nx * belly * 0.35, y0 + fy * 0.5 + ny * belly * 0.35, x0, y0);
    ctx.closePath();
  };
  const fillSail = () => {
    ctx.fillStyle = liv.color;
    ctx.fill();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  };
  // The jib, forward of the mast (not on a catboat).
  if (b.cls !== 'catboat') {
    const jx = mastX - 0.25 - Math.cos(boom * 1.1) * 1.55;
    const jy = Math.sin(boom * 1.1) * 1.55 * leeward;
    sail(2.15, 0, jx, jy, 0.42);
    ctx.save();
    ctx.globalAlpha *= 0.92;
    fillSail();
    ctx.restore();
  }
  sail(mastX, 0, bx, by, 0.66);
  fillSail();
  if (b.pattern && b.pattern !== 'plain') {
    ctx.save();
    sail(mastX, 0, bx, by, 0.62);
    ctx.clip();
    ctx.translate(mastX, 0);
    ctx.rotate(Math.atan2(by, bx - mastX) + Math.PI);
    sailPattern(ctx, b.pattern, liv.color, len);
    ctx.restore();
  }
  const draft = 0.62 * leeward;
  // Boom and mast.
  ctx.beginPath();
  ctx.moveTo(mastX, 0);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.5 / z;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mastX, 0, 0.17, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  // Masthead flags: a foul (red pennant), over the line (a crossed square).
  if (b.foul || b.ocs) {
    ctx.save();
    ctx.translate(mastX, 0);
    ctx.rotate(-b.drawH - Math.PI / 4);
    ctx.beginPath();
    if (b.foul) {
      ctx.moveTo(0, 0);
      ctx.lineTo(1.6, -0.45);
      ctx.lineTo(0, -0.9);
      ctx.closePath();
      ctx.fillStyle = PALETTE.red;
      ctx.fill();
    } else {
      ctx.rect(0, -1.1, 1.2, 1.1);
      ctx.fillStyle = PALETTE.paperLight;
      ctx.fill();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 0.8 / z;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -1.1);
      ctx.lineTo(1.2, 0);
      ctx.moveTo(1.2, -1.1);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Sail number, when there is room to read it.
  if (z > 9 && b.num !== undefined) {
    ctx.save();
    ctx.translate((mastX + bx) / 2, by / 2 + draft * 0.4);
    ctx.rotate(-b.drawH);
    ctx.scale(1 / z, 1 / z);
    ctx.font = `600 ${Math.round(Math.min(13, z * 0.85))}px ${FONT_MONO}`;
    ctx.fillStyle = liv.id === 'mustard' || liv.id === 'sky' || liv.id === 'rose' ? PALETTE.ink : PALETTE.paperLight;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.num), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** A name tag in screen space above a boat. */
export function drawTag(view, b, text, me) {
  const ctx = view.ctx;
  const p = view.toScreen(b.drawX, b.drawY, { x: 0, y: 0 });
  const y = p.y - Math.max(18, view.cam.zoom * 3.4);
  ctx.save();
  view.screenTransform();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.font = `${me ? 600 : 500} 12px ${FONT_SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(239,230,210,0.9)';
  ctx.strokeText(text, p.x, y);
  ctx.fillStyle = me ? PALETTE.ink : PALETTE.inkSoft;
  ctx.fillText(text, p.x, y);
  ctx.restore();
}

/** Hatched cones of tired air downwind of a boat (strength fading with distance). */
export function drawShadow(view, b, strong) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const ms = Math.hypot(b.wx, b.wy);
  if (ms < 0.1) return;
  const ux = b.wx / ms;
  const uy = b.wy / ms;
  const a = Math.atan2(uy, ux);
  const L = SHADOW.len;
  const w = Math.tan(SHADOW.half) * L;
  ctx.save();
  ctx.translate(b.drawX, b.drawY);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(L, -w);
  ctx.lineTo(L, w);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, L, 0);
  g.addColorStop(0, `rgba(30,42,51,${strong ? 0.13 : 0.07})`);
  g.addColorStop(1, 'rgba(30,42,51,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // Fine hatching across the cone.
  ctx.strokeStyle = `rgba(30,42,51,${strong ? 0.22 : 0.12})`;
  ctx.lineWidth = 0.9 / z;
  ctx.beginPath();
  const step = Math.max(1.1, 6 / z);
  for (let x = 2; x < L; x += step) {
    const f = 1 - x / L;
    ctx.globalAlpha = 1;
    ctx.moveTo(x, -w * (x / L));
    ctx.lineTo(x + w * (x / L) * 0.6 * f + 0.6, w * (x / L));
  }
  ctx.stroke();
  ctx.restore();
}
