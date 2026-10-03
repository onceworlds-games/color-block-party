// The air made visible: streaks that flow with the wind, dark ripple fields under gusts, glassy patches in lulls,
// a squall's line, and chart wind barbs. Everything follows the same wind field the boats sail in.

import { PALETTE } from './view.js';
import { windAt, cellsAt, frontY } from '../sim/wind.js';
import { hashf } from '../sim/rng.js';

const W = { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 };

export function makeAir(rand = Math.random) {
  return { streaks: [], cells: [], count: 0, rand };
}

/** Moves and redraws the streaks; `n` how many to keep (by quality and motion settings). */
export function drawAir(view, air, wind, t, dt, n, reduced, low = false) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const B = view.bounds(20);
  drawCells(view, air, wind, t, reduced, low);
  if (wind.front) drawFront(view, wind, t);
  // Streaks: long wisps of air that ride the wind, tapering at both ends, longer and darker in the gusts. Drawn as
  // thin bowed leaves in four batches by strength (fading in and out).
  const s = air.streaks;
  while (s.length < n) s.push(spawn(B, air.rand() * 3, air.rand));
  if (s.length > n) s.length = n;
  const speed = reduced ? 0.45 : 1;
  for (const path of BATCH) path.n = 0;
  for (const p of s) {
    p.age += dt;
    if (p.age > p.life || p.x < B.x0 || p.x > B.x1 || p.y < B.y0 || p.y > B.y1) {
      Object.assign(p, spawn(B, 0, air.rand));
      continue;
    }
    windAt(wind, p.x, p.y, t, W);
    p.x += W.vx * dt * speed * 1.4;
    p.y += W.vy * dt * speed * 1.4;
    const f = Math.min(1, p.age / 0.8, (p.life - p.age) / 1.1) * Math.min(1.4, 0.55 + 0.45 * W.gust);
    if (f <= 0.05) continue;
    const ms = W.ms || 1;
    const len = (2.6 + ms * 0.85) * p.len * Math.min(1.5, W.gust);
    p.ux = W.vx / ms;
    p.uy = W.vy / ms;
    p.L = len;
    p.w = (0.75 + 0.5 * Math.max(0, W.gust - 1)) / z;
    // A gentle S: the wisp bends across the wind and back.
    p.bend = Math.sin(p.age * 1.6 + p.len * 7 + p.x * 0.05) * len * 0.16;
    BATCH[Math.min(3, Math.floor(f * 3.2))].push(p);
  }
  ctx.fillStyle = PALETTE.ink;
  for (let k = 0; k < 4; k++) {
    const path = BATCH[k];
    if (!path.n) continue;
    ctx.beginPath();
    for (let i = 0; i < path.n; i++) {
      const p = path.items[i];
      const { ux, uy, L, w, bend } = p;
      // Head at the particle, tail upwind; the middle swells to w either side of the bowed centre line.
      const mx = p.x - ux * L * 0.5 - uy * bend;
      const my = p.y - uy * L * 0.5 + ux * bend;
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(mx - uy * w * 2, my + ux * w * 2, p.x - ux * L, p.y - uy * L);
      ctx.quadraticCurveTo(mx + uy * w * 2, my - ux * w * 2, p.x, p.y);
    }
    ctx.globalAlpha = 0.07 + 0.065 * k;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const BATCH = [0, 1, 2, 3].map(() => {
  const b = { items: [], n: 0 };
  b.push = (p) => {
    b.items[b.n++] = p;
  };
  return b;
});

function spawn(B, age, rand = Math.random) {
  return { x: B.x0 + rand() * (B.x1 - B.x0), y: B.y0 + rand() * (B.y1 - B.y0), age, life: 2.4 + rand() * 2.6, len: 0.5 + rand() * 0.8, ux: 0, uy: -1, L: 1, w: 0.1, bend: 0 };
}

/** Gusts as fields of dark ripples, lulls as glassy pale patches. Ripples are seeded per cell so they don't flicker. */
function drawCells(view, air, wind, t, reduced, low = false) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const B = view.bounds(45);
  air.cells = cellsAt(wind, t, air.cells);
  const dirx = Math.cos(Math.PI / 2);
  for (let i = 0; i < air.cells.length; i++) {
    const c = air.cells[i];
    if (c.x + c.r < B.x0 || c.x - c.r > B.x1 || c.y + c.r < B.y0 || c.y - c.r > B.y1) continue;
    const mag = Math.abs(c.s);
    if (mag < 0.03) continue;
    if (low) {
      // The cheap tier: a flat disc, no gradient, no ripples (still dark for a gust, pale for a lull).
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = c.s < 0 ? `rgba(246,240,226,${(0.3 * mag).toFixed(3)})` : `rgba(14,42,58,${Math.min(0.3, 0.5 * mag).toFixed(3)})`;
      ctx.fill();
      continue;
    }
    if (c.s < 0) {
      // A lull: the water goes glassy.
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0, `rgba(246,240,226,${(0.55 * mag).toFixed(3)})`);
      g.addColorStop(1, 'rgba(246,240,226,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // A gust: a darker wash, then ripple ticks across the wind (the darker the water, the harder it blows).
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    g.addColorStop(0, `rgba(14,42,58,${Math.min(0.5, 0.8 * mag).toFixed(3)})`);
    g.addColorStop(0.6, `rgba(14,42,58,${Math.min(0.3, 0.46 * mag).toFixed(3)})`);
    g.addColorStop(1, 'rgba(14,42,58,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    const n = Math.round(c.r * c.r * 0.16 * mag);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.2 / z;
    ctx.beginPath();
    const tw = reduced ? 0 : t;
    for (let k = 0; k < n; k++) {
      const a = hashf(i, k, 1) * Math.PI * 2;
      const rr = Math.sqrt(hashf(i, k, 2)) * c.r;
      const x = c.x + Math.cos(a) * rr;
      const y = c.y + Math.sin(a) * rr;
      const fall = 1 - rr / c.r;
      const l = (0.9 + 1.2 * hashf(i, k, 3)) * (0.75 + 0.25 * Math.sin(tw * 2.3 + k));
      if (fall < 0.08) continue;
      // A small cat's-paw: a short arc bowed downwind.
      ctx.moveTo(x - l, y);
      ctx.quadraticCurveTo(x, y + l * 0.55 * dirx + 0.4, x + l, y);
    }
    ctx.globalAlpha = Math.min(0.6, 0.25 + mag);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** A squall's leading edge: a dark ragged band crossing the course. */
function drawFront(view, wind, t) {
  const fy = frontY(wind, t);
  const B = view.bounds(30);
  if (fy < B.y0 - 40 || fy > B.y1 + 40) return;
  const ctx = view.ctx;
  const g = ctx.createLinearGradient(0, fy - 40, 0, fy + 8);
  g.addColorStop(0, 'rgba(14,42,58,0.26)');
  g.addColorStop(0.8, 'rgba(14,42,58,0.36)');
  g.addColorStop(1, 'rgba(14,42,58,0)');
  ctx.fillStyle = g;
  ctx.fillRect(B.x0, Math.max(B.y0, fy - 140), B.x1 - B.x0, Math.min(B.y1, fy + 8) - Math.max(B.y0, fy - 140));
  ctx.strokeStyle = 'rgba(30,42,51,0.55)';
  ctx.lineWidth = 2 / view.cam.zoom;
  ctx.beginPath();
  for (let x = Math.floor(B.x0 / 6) * 6; x <= B.x1; x += 6) {
    const y = fy + Math.sin(x * 0.21 + t * 0.7) * 1.6 + Math.sin(x * 0.07) * 3;
    if (x === Math.floor(B.x0 / 6) * 6) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Chart wind barbs on a fixed grid: the staff points where the wind comes from; a long feather is 10 knots, a short
 * one 5, a pennant 50.
 */
export function drawBarbs(view, wind, t, spacing = 60) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  if (z * spacing < 70) return;
  const B = view.bounds(10);
  ctx.strokeStyle = 'rgba(30,42,51,0.24)';
  ctx.fillStyle = 'rgba(30,42,51,0.24)';
  ctx.lineWidth = 1 / z;
  ctx.lineCap = 'round';
  const L = 4;
  for (let gy = Math.ceil(B.y0 / spacing) * spacing; gy < B.y1; gy += spacing) {
    for (let gx = Math.ceil(B.x0 / spacing) * spacing; gx < B.x1; gx += spacing) {
      const x = gx + (Math.floor(gy / spacing) % 2 ? spacing / 2 : 0);
      windAt(wind, x, gy, t, W);
      const ms = W.ms || 1;
      const fx = -W.vx / ms; // toward where it comes from
      const fy = -W.vy / ms;
      const px = -fy; // feathers on one side
      const py = fx;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + fx * L, gy + fy * L);
      let kn = Math.round(W.kn / 5) * 5;
      let pos = L;
      while (kn >= 50) {
        ctx.moveTo(x + fx * pos, gy + fy * pos);
        ctx.lineTo(x + fx * (pos - 1.4) + px * 2.6, gy + fy * (pos - 1.4) + py * 2.6);
        ctx.lineTo(x + fx * (pos - 2.4), gy + fy * (pos - 2.4));
        pos -= 3;
        kn -= 50;
      }
      while (kn >= 10) {
        ctx.moveTo(x + fx * pos, gy + fy * pos);
        ctx.lineTo(x + fx * (pos + 0.7) + px * 2, gy + fy * (pos + 0.7) + py * 2);
        pos -= 0.9;
        kn -= 10;
      }
      if (kn >= 5) {
        ctx.moveTo(x + fx * pos, gy + fy * pos);
        ctx.lineTo(x + fx * (pos + 0.35) + px * 1.1, gy + fy * (pos + 0.35) + py * 1.1);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, gy, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
