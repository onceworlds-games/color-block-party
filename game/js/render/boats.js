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
  const life = reduced ? 1.2 : 2.4;
  for (const b of boats) {
    const w = wakes.get(b.id);
    if (!w || w.pts.length < 2 || (b.alpha ?? 1) < 0.3 || b.hidden) continue;
    const sx = b.drawX - Math.cos(b.drawH) * 2.1;
    const sy = b.drawY - Math.sin(b.drawH) * 2.1;
    // Two foam arms spreading from the stern, thinning and fading with age, and a faint trail between them.
    let px = [sx, sx, sx];
    let py = [sy, sy, sy];
    for (let i = w.pts.length - 1; i >= 0; i--) {
      const p = w.pts[i];
      const age = t - p.t;
      if (age > life || age < 0) break;
      const f = 1 - age / life;
      const spread = 0.3 + age * (0.3 + p.v * 0.16);
      const nx = Math.cos(p.h + Math.PI / 2);
      const ny = Math.sin(p.h + Math.PI / 2);
      const xs = [p.x + nx * spread, p.x - nx * spread, p.x];
      const ys = [p.y + ny * spread, p.y - ny * spread, p.y];
      for (let k = 0; k < 3; k++) {
        const centre = k === 2;
        const a = (centre ? 0.22 : 0.62) * f * f * (b.alpha ?? 1) * Math.min(1, p.v / 1.5);
        if (a < 0.02) continue;
        ctx.strokeStyle = `rgba(251,248,240,${a.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.8 / z, (centre ? 0.9 : 0.32) * (0.4 + 0.6 * f));
        ctx.beginPath();
        ctx.moveTo(px[k], py[k]);
        ctx.lineTo(xs[k], ys[k]);
        ctx.stroke();
      }
      px = xs;
      py = ys;
    }
  }
}

/** A monohull's outline in boat coordinates (x forward, y to starboard), metres: fine bow, full quarters, a transom. */
function hullPath(ctx, cls, k = 1) {
  const L = cls === 'skiff' ? 2.45 : cls === 'catboat' ? 2.1 : 2.3; // bow
  const B = (cls === 'skiff' ? 0.68 : cls === 'catboat' ? 0.95 : 0.82) * k; // half beam
  const T = (cls === 'catboat' ? 0.78 : 0.6) * k; // half transom
  const S = -2.2;
  ctx.beginPath();
  ctx.moveTo(L, 0);
  ctx.bezierCurveTo(L - (cls === 'catboat' ? 0.3 : 0.7), -B * (cls === 'catboat' ? 0.85 : 0.55), 0.6, -B, -0.3, -B);
  ctx.bezierCurveTo(-1.2, -B, -2.0, -T * 1.15, S, -T);
  ctx.lineTo(S, T);
  ctx.bezierCurveTo(-2.0, T * 1.15, -1.2, B, -0.3, B);
  ctx.bezierCurveTo(0.6, B, L - (cls === 'catboat' ? 0.3 : 0.7), B * (cls === 'catboat' ? 0.85 : 0.55), L, 0);
  ctx.closePath();
}

/** One of a catamaran's two hulls, centred on y = c. */
function catHull(ctx, c) {
  ctx.moveTo(2.5, c);
  ctx.bezierCurveTo(1.6, c - 0.32, -1.2, c - 0.36, -2.3, c - 0.28);
  ctx.lineTo(-2.3, c + 0.28);
  ctx.bezierCurveTo(-1.2, c + 0.36, 1.6, c + 0.32, 2.5, c);
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

/** Sail patterns (cosmetic): drawn clipped to the sail, x along the foot from the mast, y toward the head. */
function sailPattern(ctx, pattern, color, len, h) {
  ctx.fillStyle = 'rgba(251,248,240,0.78)';
  const H = Math.max(1, h) * 1.4;
  switch (pattern) {
    case 'band':
      ctx.fillRect(len * 0.18, -H, len * 0.16, H * 2);
      break;
    case 'stripes':
      for (let k = 0; k < 3; k++) ctx.fillRect(len * (0.2 + k * 0.24), -H, len * 0.07, H * 2);
      break;
    case 'chevron':
      ctx.beginPath();
      ctx.moveTo(len * 0.25, -H);
      ctx.lineTo(len * 0.5, 0);
      ctx.lineTo(len * 0.25, H);
      ctx.lineTo(len * 0.38, H);
      ctx.lineTo(len * 0.63, 0);
      ctx.lineTo(len * 0.38, -H);
      ctx.fill();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(len * 0.35, 0, 0.38, 0, Math.PI * 2);
      ctx.arc(len * 0.35, 0, 0.38, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'leech':
      ctx.fillRect(len * 0.78, -H, len * 0.3, H * 2);
      break;
    case 'split':
      ctx.fillRect(0, -H, len * 1.2, H);
      break;
    case 'star':
      ctx.save();
      ctx.translate(len * 0.4, 0);
      shapePath(ctx, 'star', 0.5);
      ctx.fill();
      ctx.restore();
      break;
    default:
  }
}

/**
 * Draws one boat at its interpolated pose (b.drawX, b.drawY, b.drawH). Fields read: v, twa, side, luff, hiking, heel,
 * cls, livery, pattern, num, alpha, foul, ocs, ghost.
 */
export function drawBoat(view, b, t) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const liv = LIVERIES[b.livery ?? 0] ?? LIVERIES[0];
  const cls = b.cls ?? 'dinghy';
  ctx.save();
  ctx.globalAlpha = b.alpha ?? 1;
  ctx.translate(b.drawX, b.drawY);
  ctx.rotate(b.drawH);
  const side = b.side || 1;
  const leeward = -side; // +y is starboard; the sail goes to the side away from the wind
  const heel = Math.max(0, Math.min(1, b.heel ?? 0));
  const off = 1 / z; // the print offset: colour slips a little off the ink
  const ink = PALETTE.ink;
  // Hull(s).
  if (cls === 'cat') {
    // Trampoline and beams first, then the hulls.
    ctx.beginPath();
    ctx.rect(-1.6, -1.2, 2.3, 2.4);
    ctx.fillStyle = b.ghost ? 'rgba(226,213,184,0.4)' : PALETTE.paperShade;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(30,42,51,0.28)';
    ctx.lineWidth = 0.7 / z;
    ctx.beginPath();
    for (let k = -4; k <= 4; k += 0.55) {
      ctx.moveTo(k, -1.3);
      ctx.lineTo(k + 2.6, 1.3);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4 / z;
    ctx.beginPath();
    ctx.moveTo(0.7, -1.2);
    ctx.lineTo(0.7, 1.2);
    ctx.moveTo(-1.6, -1.2);
    ctx.lineTo(-1.6, 1.2);
    ctx.stroke();
    for (const c of [-1.2, 1.2]) {
      ctx.beginPath();
      catHull(ctx, c);
      ctx.save();
      ctx.translate(off, off * 0.7);
      ctx.fillStyle = PALETTE.paperLight;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.3 / z;
      ctx.stroke();
    }
  } else {
    ctx.save();
    ctx.translate(off, off * 0.7);
    hullPath(ctx, cls, 1 - 0.06 * heel);
    ctx.fillStyle = b.ghost ? 'rgba(246,240,226,0.45)' : PALETTE.paperLight;
    ctx.fill();
    ctx.restore();
    hullPath(ctx, cls, 1 - 0.06 * heel);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4 / z;
    if (b.ghost) ctx.setLineDash([2 / z, 2 / z]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (z > 5) {
      // The sheer line inside the gunwale, and the cockpit.
      hullPath(ctx, cls, 0.8);
      ctx.strokeStyle = 'rgba(30,42,51,0.22)';
      ctx.lineWidth = 0.8 / z;
      ctx.stroke();
      ctx.beginPath();
      const cw = cls === 'skiff' ? 0.42 : 0.5;
      ctx.moveTo(-0.15, -cw);
      ctx.lineTo(-1.95, -cw * 0.95);
      ctx.lineTo(-1.95, cw * 0.95);
      ctx.lineTo(-0.15, cw);
      ctx.strokeStyle = 'rgba(30,42,51,0.42)';
      ctx.stroke();
    }
  }
  // Shape mark on the stern deck (colour is never the only cue).
  if (b.deckMark !== false) {
    ctx.save();
    ctx.translate(cls === 'cat' ? -0.45 : -1.6, 0);
    ctx.rotate(-b.drawH);
    shapePath(ctx, liv.shape, cls === 'cat' ? 0.42 : 0.32);
    ctx.fillStyle = PALETTE.slate;
    ctx.fill('evenodd');
    ctx.restore();
  }
  // Crew: out on the windward rail when hiking.
  const rail = cls === 'cat' ? 1.2 : cls === 'skiff' ? 0.62 : 0.72;
  const crewY = (b.hiking ? rail : rail * 0.45) * side;
  ctx.fillStyle = PALETTE.inkSoft;
  ctx.beginPath();
  ctx.arc(-1.35, crewY, 0.21, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.65, crewY * (b.hiking ? 1 : 0.7), 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Sails. Seen from above a sail is nearly edge-on, so each is drawn as the triangle a sailor sees from a little
  // downwind: mast, boom end, and the head swung across the boom away from the wind. Flogging, it folds and shakes.
  const mastX = cls === 'catboat' ? 1.5 : cls === 'cat' ? 0.45 : 0.75;
  const twa = Math.max(0, Math.min(180, b.twa ?? 90));
  const luff = Math.max(0, Math.min(1, b.luff ?? 0));
  let boom = Math.max(8, Math.min(85, (twa - 16) * 0.56)) * DEG;
  if (luff > 0.5) boom *= 1 - (luff - 0.5);
  const len = cls === 'catboat' ? 3.6 : cls === 'cat' ? 3.1 : cls === 'skiff' ? 3.3 : 3.05;
  // The wind's direction in boat coordinates (where it blows to).
  const wx = -Math.cos(twa * DEG);
  const wy = -side * Math.sin(twa * DEG);
  const tri = (mx, my, ex, ey, hs, belly) => {
    const ux = ex - mx;
    const uy = ey - my;
    const ul = Math.hypot(ux, uy) || 1;
    let nx = -uy / ul;
    let ny = ux / ul;
    if (nx * wx + ny * wy < 0) {
      nx = -nx;
      ny = -ny;
    }
    const fold = 1 - 0.75 * luff;
    const hx = mx + nx * hs * fold + (ux / ul) * hs * 0.15;
    const hy = my + ny * hs * fold + (uy / ul) * hs * 0.15;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.quadraticCurveTo((mx + hx) / 2 - (ux / ul) * 0.15, (my + hy) / 2 - (uy / ul) * 0.15, hx, hy);
    if (luff > 0.15) {
      for (let k = 1; k <= 6; k++) {
        const f = k / 6;
        const wob = Math.sin(t * 30 + k * 1.9 + mx * 3) * 0.28 * luff * Math.sin(f * Math.PI);
        ctx.lineTo(hx + (ex - hx) * f + nx * wob, hy + (ey - hy) * f + ny * wob);
      }
    } else ctx.quadraticCurveTo((hx + ex) / 2 + nx * belly + (ux / ul) * belly * 0.6, (hy + ey) / 2 + ny * belly + (uy / ul) * belly * 0.6, ex, ey);
    ctx.quadraticCurveTo((mx + ex) / 2 + nx * belly * 0.3, (my + ey) / 2 + ny * belly * 0.3, mx, my);
    ctx.closePath();
    return { hx, hy, nx, ny };
  };
  const paint = (fn, alpha = 1) => {
    ctx.save();
    ctx.translate(off * 0.8, off * 0.6);
    fn();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = liv.color;
    ctx.fill();
    ctx.restore();
    fn();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  };
  const hs = (0.5 + 0.15 * heel) * len;
  const bx = mastX - Math.cos(boom) * len;
  const by = Math.sin(boom) * len * leeward;
  if (cls !== 'catboat') {
    // The jib: from the forestay to its clew beside the mast.
    const jb = boom * 1.08;
    const jl = cls === 'cat' ? 2.2 : 1.85;
    const jx = 2.05 - Math.cos(jb) * jl;
    const jy = Math.sin(jb) * jl * leeward;
    paint(() => tri(2.05, 0, jx, jy, hs * 0.48, 0.32), 0.9);
  }
  let head = null;
  paint(() => (head = tri(mastX, 0, bx, by, hs, 0.55)));
  // Battens: short dark lines in from the leech.
  if (z > 6 && luff < 0.4 && head) {
    ctx.strokeStyle = 'rgba(30,42,51,0.3)';
    ctx.lineWidth = 0.8 / z;
    ctx.beginPath();
    for (const f of [0.3, 0.55, 0.78]) {
      const lx = head.hx + (bx - head.hx) * f;
      const ly = head.hy + (by - head.hy) * f;
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + (mastX - lx) * 0.28, ly + (0 - ly) * 0.28);
    }
    ctx.stroke();
  }
  if (b.pattern && b.pattern !== 'plain' && head) {
    ctx.save();
    tri(mastX, 0, bx, by, hs, 0.55);
    ctx.clip();
    ctx.translate(mastX, 0);
    ctx.rotate(Math.atan2(by, bx - mastX));
    sailPattern(ctx, b.pattern, liv.color, len, Math.hypot(head.hx - mastX, head.hy));
    ctx.restore();
  }
  // Boom and mast.
  ctx.beginPath();
  ctx.moveTo(mastX, 0);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6 / z;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mastX, 0, 0.16, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  // Masthead flags: a foul (red pennant), over the line (a crossed square).
  if (b.foul || b.ocs) {
    ctx.save();
    ctx.translate(head ? head.hx : mastX, head ? head.hy : 0);
    ctx.rotate(-b.drawH - Math.PI / 4);
    ctx.beginPath();
    if (b.foul) {
      ctx.moveTo(0, 0);
      ctx.lineTo(1.6, -0.45);
      ctx.lineTo(0, -0.9);
      ctx.closePath();
      ctx.fillStyle = PALETTE.red;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.8 / z;
      ctx.stroke();
    } else {
      ctx.rect(0, -1.1, 1.2, 1.1);
      ctx.fillStyle = PALETTE.paperLight;
      ctx.fill();
      ctx.strokeStyle = ink;
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
  // Sail number, in the middle of the main, when there is room to read it.
  if (z > 9 && b.num !== undefined && head && luff < 0.5) {
    ctx.save();
    ctx.translate((mastX + bx + head.hx) / 3, (by + head.hy) / 3);
    ctx.rotate(-b.drawH);
    ctx.scale(1 / z, 1 / z);
    ctx.font = `600 ${Math.round(Math.min(14, z * 0.75))}px ${FONT_MONO}`;
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
  g.addColorStop(0, `rgba(30,42,51,${strong ? 0.1 : 0.06})`);
  g.addColorStop(1, 'rgba(30,42,51,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // Fine hatching across the cone.
  ctx.strokeStyle = `rgba(30,42,51,${strong ? 0.17 : 0.1})`;
  ctx.lineWidth = 0.9 / z;
  ctx.beginPath();
  const step = Math.max(1.6, 8 / z);
  for (let x = 2; x < L; x += step) {
    const f = 1 - x / L;
    ctx.globalAlpha = 1;
    ctx.moveTo(x, -w * (x / L));
    ctx.lineTo(x + w * (x / L) * 0.6 * f + 0.6, w * (x / L));
  }
  ctx.stroke();
  ctx.restore();
}
