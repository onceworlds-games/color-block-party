// The air made visible: streaks that flow with the wind, dark ripple fields under gusts, glassy patches in lulls,
// a squall's line, and chart wind barbs. Everything follows the same wind field the boats sail in.

import { PALETTE } from './view.js';
import { windAt, cellsAt, frontY } from '../sim/wind.js';
import { hashf } from '../sim/rng.js';

const W = { vx: 0, vy: 0, ms: 0, kn: 0, shift: 0, gust: 1 };

export function makeAir() {
  return { streaks: [], cells: [], count: 0 };
}

/** Moves and redraws the streaks; `n` how many to keep (by quality and motion settings). */
export function drawAir(view, air, wind, t, dt, n, reduced) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const B = view.bounds(20);
  drawCells(view, air, wind, t, reduced);
  if (wind.front) drawFront(view, wind, t);
  // Streaks: short wisps that ride the wind, longer and darker in the gusts.
  const s = air.streaks;
  while (s.length < n) s.push(spawn(B, Math.random() * 3));
  if (s.length > n) s.length = n;
  ctx.lineCap = 'round';
  ctx.strokeStyle = PALETTE.ink;
  const speed = reduced ? 0.45 : 1;
  for (const p of s) {
    p.age += dt;
    if (p.age > p.life || p.x < B.x0 || p.x > B.x1 || p.y < B.y0 || p.y > B.y1) {
      Object.assign(p, spawn(B, 0));
      continue;
    }
    windAt(wind, p.x, p.y, t, W);
    p.x += W.vx * dt * speed * 1.4;
    p.y += W.vy * dt * speed * 1.4;
    const f = Math.min(1, p.age / 0.7, (p.life - p.age) / 0.9);
    const ms = W.ms || 1;
    const len = (1.4 + ms * 0.5) * p.len * Math.min(1.5, W.gust);
    const ux = W.vx / ms;
    const uy = W.vy / ms;
    // A gentle S: the wisp bends across the wind and back.
    const bend = Math.sin(p.age * 2 + p.len * 7) * len * 0.12;
    ctx.globalAlpha = 0.2 * f * Math.min(1.5, 0.55 + 0.45 * W.gust);
    ctx.lineWidth = (0.9 + 0.6 * Math.max(0, W.gust - 1)) / z;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x - ux * len * 0.5 - uy * bend, p.y - uy * len * 0.5 + ux * bend, p.x - ux * len, p.y - uy * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function spawn(B, age) {
  return { x: B.x0 + Math.random() * (B.x1 - B.x0), y: B.y0 + Math.random() * (B.y1 - B.y0), age, life: 1.8 + Math.random() * 2.2, len: 0.5 + Math.random() * 0.7 };
}

/** Gusts as fields of dark ripples, lulls as glassy pale patches. Ripples are seeded per cell so they don't flicker. */
function drawCells(view, air, wind, t, reduced) {
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
    // A gust: a darker wash, then ripple ticks across the wind.
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    g.addColorStop(0, `rgba(78,110,124,${(0.3 * mag).toFixed(3)})`);
    g.addColorStop(1, 'rgba(78,110,124,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    const n = Math.round(c.r * c.r * 0.09 * mag);
    ctx.strokeStyle = PALETTE.slate;
    ctx.lineWidth = 1.1 / z;
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
    ctx.globalAlpha = Math.min(0.75, 0.35 + mag);
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
  g.addColorStop(0, 'rgba(78,110,124,0.22)');
  g.addColorStop(0.8, 'rgba(78,110,124,0.3)');
  g.addColorStop(1, 'rgba(78,110,124,0)');
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
