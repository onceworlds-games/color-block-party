// The HUD, drawn like annotation on the chart: thin ink, small capitals, a serif for names, italic notices and mono
// numbers. Nothing in the platform's top-left corner, nothing in the lower corners while touch controls are on.

import { PALETTE, LIVERIES, FONT_SERIF, FONT_MONO } from './view.js';
import { shapePath } from './boats.js';

const DEG = Math.PI / 180;
const S = { x: 0, y: 0 };

export function fmtClock(s, tenths = false) {
  const neg = s < 0;
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  const body = tenths ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

function text(ctx, str, x, y, { font = `500 13px ${FONT_SERIF}`, color = PALETTE.ink, align = 'left', base = 'alphabetic', halo = true, spacing = '0px' } = {}) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.letterSpacing = spacing;
  if (halo) {
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(239,230,210,0.88)';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.letterSpacing = '0px';
}

/** The top-centre clock: the countdown before the gun, the race time after it, and the leg. */
export function drawClock(view, h) {
  const ctx = view.ctx;
  const cx = view.w / 2;
  if (h.pre) {
    const left = Math.max(0, h.gunIn);
    text(ctx, 'START IN', cx, 22, { font: `600 11px ${FONT_SERIF}`, align: 'center', spacing: '0.18em', color: PALETTE.inkSoft });
    text(ctx, fmtClock(Math.ceil(left - 0.001)), cx, 52, { font: `500 ${left <= 10 ? 34 : 28}px ${FONT_MONO}`, align: 'center', color: left <= 10 ? PALETTE.red : PALETTE.ink });
  } else {
    text(ctx, fmtClock(h.raceT, true), cx, 38, { font: `500 22px ${FONT_MONO}`, align: 'center' });
    if (h.leg) text(ctx, h.leg, cx, 56, { font: `italic 500 13px ${FONT_SERIF}`, align: 'center', color: PALETTE.inkSoft });
  }
}

/** One notice at a time, in italic, under the clock. */
export function drawNotice(view, n, now) {
  if (!n) return;
  const ctx = view.ctx;
  const age = now - n.at;
  const life = n.until - n.at;
  const a = Math.min(1, age / 0.18, (life - age) / 0.4);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  const y = 90 + (1 - Math.min(1, age / 0.25)) * -6;
  const color = n.kind === 'bad' ? PALETTE.red : n.kind === 'good' ? '#2F6B4F' : PALETTE.ink;
  text(ctx, n.text, view.w / 2, y, { font: `italic 600 ${view.w < 420 ? 17 : 20}px ${FONT_SERIF}`, align: 'center', color });
  if (n.sub) text(ctx, n.sub, view.w / 2, y + 20, { font: `500 12px ${FONT_SERIF}`, align: 'center', color: PALETTE.inkSoft, spacing: '0.06em' });
  ctx.restore();
}

/** Standings at the top right: place, shape mark in its colour, name, gap. */
export function drawStandings(view, rows, meId, compact) {
  const ctx = view.ctx;
  const w = compact ? 150 : 196;
  const x0 = view.w - w - 10;
  let y = 16;
  const max = compact ? 5 : 10;
  let list = rows.slice(0, max);
  const mine = rows.findIndex((r) => r.id === meId);
  if (mine >= max) list = [...rows.slice(0, max - 1), rows[mine]];
  ctx.save();
  ctx.strokeStyle = 'rgba(30,42,51,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 2);
  ctx.lineTo(x0 + w, y + 2);
  ctx.stroke();
  for (const r of list) {
    y += 19;
    const me = r.id === meId;
    const liv = LIVERIES[r.livery ?? 0] ?? LIVERIES[0];
    text(ctx, String(r.place), x0 + 12, y, { font: `500 12px ${FONT_MONO}`, align: 'right', color: PALETTE.inkSoft, halo: false });
    ctx.save();
    ctx.translate(x0 + 24, y - 4);
    shapePath(ctx, liv.shape, 5.2);
    ctx.fillStyle = liv.color;
    ctx.fill('evenodd');
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
    const name = r.name.length > (compact ? 9 : 14) ? `${r.name.slice(0, compact ? 8 : 13)}…` : r.name;
    text(ctx, name, x0 + 35, y, { font: `${me ? 700 : 500} 13px ${FONT_SERIF}`, color: r.away ? 'rgba(30,42,51,0.45)' : PALETTE.ink, halo: false });
    text(ctx, r.gap, x0 + w, y, { font: `500 12px ${FONT_MONO}`, align: 'right', color: r.gapColor ?? PALETTE.inkSoft, halo: false });
    if (me) {
      ctx.fillStyle = 'rgba(30,42,51,0.08)';
      ctx.fillRect(x0 - 2, y - 14, w + 4, 18);
    }
  }
  ctx.beginPath();
  ctx.moveTo(x0, y + 7);
  ctx.lineTo(x0 + w, y + 7);
  ctx.strokeStyle = 'rgba(30,42,51,0.55)';
  ctx.stroke();
  ctx.restore();
}

/**
 * The wind rose: compass ticks turned to the chart, the wind's arrow and speed, the shift against the race's mean
 * direction, a dotted arrow where it will be in 20 s, and bars for the wind at the boat over the next 30 s.
 */
export function drawWindRose(view, x, y, r, h) {
  const ctx = view.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(239,230,210,0.82)';
  ctx.beginPath();
  ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,42,51,0.6)';
  ctx.beginPath();
  for (let d = 0; d < 360; d += 15) {
    const a = (d - h.bearing) * DEG - Math.PI / 2;
    const r0 = d % 90 === 0 ? r - 7 : d % 45 === 0 ? r - 5 : r - 3;
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  // North.
  const na = -h.bearing * DEG - Math.PI / 2;
  text(ctx, 'N', Math.cos(na) * (r - 13), Math.sin(na) * (r - 13) + 4, { font: `700 11px ${FONT_SERIF}`, align: 'center', halo: true });
  // Mean wind (thin) and the wind now (bold), arrows blowing toward the centre.
  const arrow = (shift, len, width, color, dash) => {
    const a = -Math.PI / 2 + shift; // where it comes from
    ctx.save();
    ctx.rotate(a);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(4, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(9, -4);
    ctx.lineTo(9, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  ctx.save();
  ctx.rotate(0);
  arrow(h.forecast, r - 2, 1.2, 'rgba(30,42,51,0.55)', [2, 3]);
  arrow(h.shift, r - 2, 2.4, h.gusting ? PALETTE.slate : PALETTE.ink);
  ctx.restore();
  // The shift as a number: + veered, - backed, against the race's mean.
  const sh = Math.round(h.shift / DEG);
  text(ctx, `${h.kn.toFixed(0)}`, 0, r + 22, { font: `600 16px ${FONT_MONO}`, align: 'center' });
  text(ctx, 'kn', 13 + String(Math.round(h.kn)).length * 4, r + 22, { font: `italic 500 11px ${FONT_SERIF}`, color: PALETTE.inkSoft });
  if (Math.abs(sh) >= 1) text(ctx, `${sh > 0 ? '+' : ''}${sh}°`, r + 10, 4, { font: `500 11px ${FONT_MONO}`, color: PALETTE.inkSoft });
  // Gust bars: the wind here over the next 30 s, relative to now.
  if (h.bars?.length) {
    const bw = 5;
    const gap = 3;
    const total = h.bars.length * (bw + gap) - gap;
    let bx = -total / 2;
    for (const v of h.bars) {
      const hh = Math.max(2, Math.min(16, 8 + (v - 1) * 26));
      ctx.fillStyle = v > 1.08 ? PALETTE.slate : v < 0.92 ? 'rgba(30,42,51,0.25)' : 'rgba(30,42,51,0.55)';
      ctx.fillRect(bx, r + 44 - hh, bw, hh);
      bx += bw + gap;
    }
  }
  ctx.restore();
}

/**
 * The ring round the player's boat: the no-go wedge into the wind (hatched), ticks at the best upwind and downwind
 * angles, speed and VMG to the next mark, the crew's stamina while hiking, and the start-line timer.
 */
export function drawBoatRing(view, me, h) {
  const ctx = view.ctx;
  view.toScreen(me.drawX, me.drawY, S);
  const R = Math.max(34, Math.min(58, view.cam.zoom * 6));
  ctx.save();
  ctx.translate(S.x, S.y);
  const from = h.fromAngle;
  // No-go wedge.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, R, from - h.nogo * DEG, from + h.nogo * DEG);
  ctx.closePath();
  ctx.fillStyle = me.irons ? 'rgba(194,65,47,0.22)' : 'rgba(30,42,51,0.08)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, R, from - h.nogo * DEG, from + h.nogo * DEG);
  ctx.strokeStyle = me.irons ? PALETTE.red : 'rgba(30,42,51,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // The ring and the best angles.
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(30,42,51,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,42,51,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const a of [h.up, -h.up, h.down, -h.down]) {
    const ang = from + a * DEG;
    ctx.moveTo(Math.cos(ang) * (R - 5), Math.sin(ang) * (R - 5));
    ctx.lineTo(Math.cos(ang) * (R + 5), Math.sin(ang) * (R + 5));
  }
  ctx.stroke();
  // Heading tick.
  ctx.beginPath();
  ctx.moveTo(Math.cos(me.drawH) * (R - 7), Math.sin(me.drawH) * (R - 7));
  ctx.lineTo(Math.cos(me.drawH) * (R + 9), Math.sin(me.drawH) * (R + 9));
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // Next mark: a small caret on the ring pointing at it.
  if (h.markAngle !== null) {
    const a = h.markAngle;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(R + 12, 0);
    ctx.lineTo(R + 4, -4.5);
    ctx.lineTo(R + 4, 4.5);
    ctx.closePath();
    ctx.fillStyle = h.markColor;
    ctx.fill();
    ctx.restore();
  }
  // Speed and VMG.
  const lx = R * 0.72 + 8;
  const ly = R * 0.72 + 10;
  text(ctx, h.speed.toFixed(1), lx, ly, { font: `600 15px ${FONT_MONO}` });
  text(ctx, 'kn', lx + 31, ly, { font: `italic 500 11px ${FONT_SERIF}`, color: PALETTE.inkSoft });
  if (h.vmg !== null) text(ctx, `VMG ${h.vmg.toFixed(1)}`, lx, ly + 15, { font: `500 11px ${FONT_MONO}`, color: PALETTE.inkSoft });
  // Stamina, while it matters.
  if (h.stamina < 0.995 || me.hiking) {
    const bw = 44;
    ctx.fillStyle = 'rgba(30,42,51,0.18)';
    ctx.fillRect(-bw / 2, R + 14, bw, 4);
    ctx.fillStyle = h.stamina < 0.25 ? PALETTE.red : PALETTE.ink;
    ctx.fillRect(-bw / 2, R + 14, bw * h.stamina, 4);
    text(ctx, me.hiking ? 'HIKING' : 'CREW', 0, R + 30, { font: `600 9px ${FONT_SERIF}`, align: 'center', spacing: '0.16em', color: PALETTE.inkSoft });
  }
  // Before the gun: how the run to the line compares with the clock.
  if (h.lineIn !== null) {
    const early = h.lineIn < h.gunIn - 0.5;
    const s = early ? `early ${(h.gunIn - h.lineIn).toFixed(1)}s` : h.lineIn > h.gunIn + 0.5 ? `late ${(h.lineIn - h.gunIn).toFixed(1)}s` : 'on time';
    text(ctx, s, 0, -R - 12, { font: `italic 600 13px ${FONT_SERIF}`, align: 'center', color: early ? PALETTE.red : PALETTE.ink });
  }
  ctx.restore();
}

/** An arrow at the edge of the screen toward the next mark when it is out of view, with its name and distance. */
export function drawMarkPointer(view, tg, me, name, safe) {
  view.toScreen(tg.x, tg.y, S);
  const m = 46;
  if (S.x > m && S.x < view.w - m && S.y > m + 60 && S.y < view.h - m) return;
  const ctx = view.ctx;
  const cx = view.w / 2;
  const cy = view.h / 2;
  const dx = S.x - cx;
  const dy = S.y - cy;
  const k = Math.min((view.w / 2 - m) / Math.abs(dx || 1e-6), (view.h / 2 - m - safe) / Math.abs(dy || 1e-6));
  let x = cx + dx * k;
  let y = cy + dy * k;
  // Keep clear of the platform's corner (top left), the clock (top centre) and the standings (top right).
  if (y < 104) y = 104;
  if (x > view.w - 220 && y < 210) y = 210;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-6, -9);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-6, 9);
  ctx.closePath();
  ctx.fillStyle = PALETTE.ink;
  ctx.fill();
  ctx.restore();
  const d = Math.hypot(tg.x - me.x, tg.y - me.y);
  const ly = y + (dy > 0 ? -22 : 26);
  text(ctx, `${name} ${Math.round(d)} m`, Math.max(60, Math.min(view.w - 60, x)), ly, { font: `italic 600 12px ${FONT_SERIF}`, align: 'center' });
}

/** Fog: the chart washes out to pale grey beyond the visibility around the boat. */
export function drawFog(view, me, visibility) {
  if (!Number.isFinite(visibility)) return;
  const ctx = view.ctx;
  view.toScreen(me.drawX, me.drawY, S);
  const r1 = visibility * view.cam.zoom;
  const r0 = r1 * 0.55;
  const g = ctx.createRadialGradient(S.x, S.y, r0, S.x, S.y, r1);
  g.addColorStop(0, 'rgba(228,226,220,0)');
  g.addColorStop(1, 'rgba(228,226,220,0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** A small chart of the whole course in a corner: marks, boats as dots, the view. */
export function drawMiniChart(view, x, y, size, course, boats, meId, nextPi) {
  const ctx = view.ctx;
  const b = course.bounds;
  const s = size / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(239,230,210,0.88)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(30,42,51,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  const ox = (size - (b.x1 - b.x0) * s) / 2;
  const oy = (size - (b.y1 - b.y0) * s) / 2;
  const X = (wx) => ox + (wx - b.x0) * s;
  const Y = (wy) => oy + (wy - b.y0) * s;
  for (const il of course.islands) {
    ctx.beginPath();
    il.poly.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
    ctx.closePath();
    ctx.fillStyle = '#E2D5B8';
    ctx.fill();
    ctx.stroke();
  }
  // The route.
  ctx.strokeStyle = 'rgba(30,42,51,0.35)';
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  course.targets.forEach((t, i) => (i ? ctx.lineTo(X(t.x), Y(t.y)) : ctx.moveTo(X(t.x), Y(t.y))));
  ctx.stroke();
  ctx.setLineDash([]);
  course.targets.forEach((t, i) => {
    if (t.type === 'start') return;
    ctx.beginPath();
    ctx.arc(X(t.x), Y(t.y), i === nextPi ? 3.4 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = t.type === 'mark' ? (t.side === 'port' ? PALETTE.red : PALETTE.mustard) : PALETTE.ink;
    ctx.fill();
  });
  for (const bt of boats) {
    if (bt.alpha < 0.3) continue;
    const liv = LIVERIES[bt.livery ?? 0] ?? LIVERIES[0];
    ctx.beginPath();
    ctx.arc(X(bt.drawX), Y(bt.drawY), bt.id === meId ? 3.2 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = liv.color;
    ctx.fill();
    if (bt.id === meId) {
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
    }
  }
  const vb = view.bounds(0);
  ctx.strokeStyle = 'rgba(30,42,51,0.7)';
  ctx.strokeRect(X(vb.x0), Y(vb.y0), (vb.x1 - vb.x0) * s, (vb.y1 - vb.y0) * s);
  ctx.restore();
}
