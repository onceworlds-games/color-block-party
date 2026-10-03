// Marks and lines: red buoys left to port, mustard ones left to starboard, named in small italic capitals; rounding
// arrows on the next mark; gates; the start line between the committee boat and the pin; the finish flags; laylines.

import { PALETTE, FONT_SERIF } from './view.js';

const P = { x: 0, y: 0 };

function label(view, x, y, text, dx = 0, dy = -16, color = PALETTE.ink, italic = true, size = 12) {
  const ctx = view.ctx;
  view.toScreen(x, y, P);
  ctx.save();
  view.screenTransform();
  ctx.font = `${italic ? 'italic ' : ''}500 ${size}px ${FONT_SERIF}`;
  ctx.letterSpacing = '0.08em';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(239,230,210,0.85)';
  ctx.strokeText(text, P.x + dx, P.y + dy);
  ctx.fillStyle = color;
  ctx.fillText(text, P.x + dx, P.y + dy);
  ctx.restore();
}

function buoy(view, x, y, color, r = 1.05) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const rr = Math.max(r, 3.2 / z);
  ctx.beginPath();
  ctx.arc(x + 0.9 / z, y + 0.7 / z, rr, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.3 / z;
  ctx.stroke();
  // The topmark.
  ctx.beginPath();
  ctx.arc(x, y, rr * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
}

/** A curved arrow round a mark, showing which way it is rounded. */
function roundingArrow(view, t, pulse) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const R = 6.5;
  const port = t.side === 'port';
  // Centre the arc on the side the boats come round: from the approach, over the rounding ray, to the exit.
  const a0 = Math.atan2(-t.ay, -t.ax); // back toward where boats come from
  const a1 = Math.atan2(t.by ?? t.ay, t.bx ?? t.ax); // the way they leave
  // Port roundings go counter-clockwise on the chart.
  let sweep = port ? a1 - a0 : a0 - a1;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  const start = a0 + (port ? -0.5 : 0.5);
  const end = start + (port ? -1 : 1) * (Math.PI * 2 - sweep + 1);
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.strokeStyle = port ? PALETTE.red : '#9C7420';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2 / z;
  ctx.setLineDash([4 / z, 3 / z]);
  ctx.lineDashOffset = pulse ? -t.pulse : 0;
  ctx.beginPath();
  ctx.arc(0, 0, R, start, end, port);
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead at the end.
  const ex = Math.cos(end) * R;
  const ey = Math.sin(end) * R;
  const tang = end + (port ? -Math.PI / 2 : Math.PI / 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(tang) * 2.2, ey + Math.sin(tang) * 2.2);
  ctx.lineTo(ex + Math.cos(tang + 2.5) * 1.6, ey + Math.sin(tang + 2.5) * 1.6);
  ctx.lineTo(ex + Math.cos(tang - 2.5) * 1.6, ey + Math.sin(tang - 2.5) * 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The committee boat: a small motor boat, at anchor, flying the course flag. */
function committee(view, c, t) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(3.4, 0);
  ctx.quadraticCurveTo(2.2, -1.5, -0.5, -1.5);
  ctx.lineTo(-3, -1.3);
  ctx.lineTo(-3, 1.3);
  ctx.lineTo(-0.5, 1.5);
  ctx.quadraticCurveTo(2.2, 1.5, 3.4, 0);
  ctx.closePath();
  ctx.fillStyle = '#F8F3E7';
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.4 / z;
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(-1.6, -0.9, 2, 1.8); // wheelhouse
  ctx.restore();
  // The flag on its staff, flapping.
  const fx = c.x - 0.5;
  const fy = c.y - 1.5;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.2 / z;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx, fy - 3.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fx, fy - 3.2);
  ctx.quadraticCurveTo(fx + 1.2, fy - 3.4 + Math.sin(t * 6) * 0.3, fx + 2.4, fy - 3.1);
  ctx.lineTo(fx + 2.3, fy - 1.9);
  ctx.quadraticCurveTo(fx + 1.2, fy - 2.1 + Math.sin(t * 6 + 1) * 0.3, fx, fy - 2.0);
  ctx.closePath();
  ctx.fillStyle = PALETTE.mustard;
  ctx.fill();
  ctx.stroke();
}

function chequer(view, x, y, t) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.2 / z;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 3.6);
  ctx.stroke();
  const s = 0.6;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = (i + j) % 2 ? PALETTE.ink : PALETTE.paperLight;
      const wob = Math.sin(t * 5 + i * 0.8) * 0.12;
      ctx.fillRect(x + i * s, y - 3.6 + j * s + wob, s, s);
    }
  }
  ctx.strokeRect(x, y - 3.6, 4 * s, 3 * s);
}

/**
 * Draws the course: every mark and line; `next` is the index of the player's next target (highlighted), `raceT` the
 * race time (the start line fades after the start).
 */
export function drawMarks(view, course, next, t, raceT, reduced) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const T = course.targets;
  // The start line: dashed, bold before the start.
  const s = course.start;
  const before = raceT < 20;
  ctx.strokeStyle = before ? 'rgba(30,42,51,0.8)' : 'rgba(30,42,51,0.3)';
  ctx.lineWidth = (before ? 1.6 : 1) / z;
  ctx.setLineDash([5 / z, 4 / z]);
  ctx.beginPath();
  ctx.moveTo(s.x1, s.y1);
  ctx.lineTo(s.x2, s.y2);
  ctx.stroke();
  ctx.setLineDash([]);
  committee(view, course.committee, t);
  buoy(view, course.pin.x, course.pin.y, PALETTE.mustard, 0.9);
  if (before && z > 1.4) label(view, course.pin.x, course.pin.y, 'PIN', 0, 16, PALETTE.ink, true, 11);
  // Marks, gates and the finish.
  const drawn = new Set();
  for (let i = 1; i < T.length; i++) {
    const tg = T[i];
    const key = `${tg.type}${Math.round(tg.x)},${Math.round(tg.y)}`;
    const isNext = i === next;
    if (drawn.has(key) && !isNext) continue;
    drawn.add(key);
    if (tg.type === 'mark') {
      if (isNext) {
        tg.pulse = (t * 8) % 7;
        roundingArrow(view, tg, !reduced);
      }
      buoy(view, tg.x, tg.y, tg.side === 'port' ? PALETTE.red : PALETTE.mustard);
      if (z > 1.2) label(view, tg.x, tg.y, tg.name.toUpperCase(), 0, -18, isNext ? PALETTE.ink : PALETTE.inkSoft, true, isNext ? 13 : 11);
    } else if (tg.type === 'gate' || tg.type === 'finish') {
      const fin = tg.type === 'finish';
      ctx.strokeStyle = isNext ? 'rgba(30,42,51,0.75)' : 'rgba(30,42,51,0.35)';
      ctx.lineWidth = (isNext ? 1.6 : 1) / z;
      ctx.setLineDash([3 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(tg.x1, tg.y1);
      ctx.lineTo(tg.x2, tg.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (fin) {
        chequer(view, tg.x1, tg.y1, t);
        chequer(view, tg.x2, tg.y2, t + 1);
        if (z > 1.2) label(view, tg.x, tg.y, 'FINISH', 0, isNext ? -20 : -16, isNext ? PALETTE.ink : PALETTE.inkSoft, true, isNext ? 13 : 11);
      } else {
        buoy(view, tg.x1, tg.y1, PALETTE.mustard, 0.95);
        buoy(view, tg.x2, tg.y2, PALETTE.mustard, 0.95);
        // Chevrons through the gate show the way to pass.
        if (isNext) {
          ctx.strokeStyle = 'rgba(30,42,51,0.6)';
          ctx.lineWidth = 1.4 / z;
          ctx.beginPath();
          for (const k of [-3, 0]) {
            const cx = tg.x + tg.fx * k;
            const cy = tg.y + tg.fy * k;
            ctx.moveTo(cx - tg.fx * 1.5 - tg.fy * 2, cy - tg.fy * 1.5 + tg.fx * 2);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx - tg.fx * 1.5 + tg.fy * 2, cy - tg.fy * 1.5 - tg.fx * 2);
          }
          ctx.stroke();
        }
        if (z > 1.2) label(view, tg.x, tg.y, tg.name.toUpperCase(), 0, -16, isNext ? PALETTE.ink : PALETTE.inkSoft, true, isNext ? 13 : 11);
      }
    }
  }
}

/**
 * Laylines to the next target: dotted lines at the best angles either side, when the leg is a beat or a run and the
 * boat is close enough for them to matter.
 */
export function drawLaylines(view, tg, wind, upAngle, downAngle, boat) {
  if (!tg || tg.type === 'start') return;
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const d = Math.hypot(tg.x - boat.x, tg.y - boat.y);
  if (d > 170) return;
  const ms = Math.hypot(wind.vx, wind.vy) || 1;
  const fromA = Math.atan2(-wind.vy / ms, -wind.vx / ms);
  const toB = Math.atan2(boat.y - tg.y, boat.x - tg.x);
  const off = Math.abs(((toB - fromA + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // 0 = the boat is upwind of the mark
  const beat = off > Math.PI - (upAngle + 6) * (Math.PI / 180);
  const run = off < Math.PI - (downAngle - 6) * (Math.PI / 180) && !beat;
  if (!beat && !run) return;
  const ang = (beat ? upAngle : downAngle) * (Math.PI / 180);
  const base = beat ? fromA + Math.PI : fromA; // laylines run back from the mark downwind (beat) or upwind (run)
  const len = Math.min(160, d * 1.4 + 20);
  ctx.save();
  ctx.strokeStyle = 'rgba(30,42,51,0.5)';
  ctx.lineWidth = 1.1 / z;
  ctx.setLineDash([1.2 / z, 5 / z]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const a = base + s * (beat ? ang : Math.PI - ang);
    ctx.moveTo(tg.x, tg.y);
    ctx.lineTo(tg.x + Math.cos(a) * len, tg.y + Math.sin(a) * len);
  }
  ctx.stroke();
  ctx.restore();
}
