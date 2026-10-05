// Screens drawn on the canvas: the title, the lobby's settings, the countdown, the round banner, the call HUD, the winner,
// the scoreboard and the podium. Labels are one to three words; numbers are big; icons beat words.
import { COLORS, ordinal } from './rules.js';
import { drawActor, drawHead } from './draw.js';
import { FONT, INK, clamp, easeBack, easeOut, fillSymbol, outlined, roundRect, shade, starPath, tag } from './theme.js';

export const unit = (view) => clamp(Math.min(view.w / 640, view.h / 360), 0.72, 1.8);

function pill(ctx, x, y, w, h, fill, line = INK, lw = 3) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = line;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- title
const playRect = { x: 0, y: 0, w: 0, h: 0 };

/** Chunky letters, each in the next tile colour, bouncing. */
export function drawLogo(ctx, text, cx, cy, size, t, offset) {
  ctx.font = `${size}px ${FONT}`;
  const widths = [];
  let total = 0;
  for (const ch of text) {
    const wd = ch === ' ' ? size * 0.32 : ctx.measureText(ch).width + size * 0.05;
    widths.push(wd);
    total += wd;
  }
  let x = cx - total / 2;
  let i = 0;
  for (const ch of text) {
    const wd = widths[i];
    if (ch !== ' ') {
      ctx.save();
      ctx.translate(x + wd / 2, cy + Math.sin(t * 3.2 + i * 0.7) * size * 0.06);
      ctx.rotate(Math.sin(t * 2 + i) * 0.05 + (i % 2 ? 0.05 : -0.05));
      outlined(ctx, ch, 0, 0, size, { fill: COLORS[(i + offset) % 6].hex, width: 0.28, shadow: size * 0.08 });
      ctx.restore();
    }
    x += wd;
    i++;
  }
}

/** The title: the logo and one big PLAY button. Returns the button's rectangle (a shared object). */
export function drawTitle(ctx, view, t) {
  const { w, h } = view;
  ctx.fillStyle = 'rgba(14,5,34,0.45)';
  ctx.fillRect(0, 0, w, h);
  const A = Math.min(h * 0.15, w * 0.078);
  drawLogo(ctx, 'COLOR BLOCK', w / 2, h * 0.26, A, t, 0);
  drawLogo(ctx, 'PARTY', w / 2, h * 0.26 + A * 1.3, A * 1.55, t, 3);
  const bw = clamp(w * 0.3, 180, 320);
  const bh = clamp(h * 0.17, 60, 92);
  const cx = w / 2;
  const cy = h * 0.77;
  playRect.x = cx - bw / 2;
  playRect.y = cy - bh / 2;
  playRect.w = bw;
  playRect.h = bh;
  const pulse = 1 + Math.sin(t * 4.2) * 0.035;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  pill(ctx, -bw / 2, -bh / 2 + bh * 0.1, bw, bh, '#127a3c', INK, 4);
  pill(ctx, -bw / 2, -bh / 2, bw, bh, '#2fd46b', INK, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, -bw / 2 + bh * 0.25, -bh / 2 + bh * 0.1, bw - bh * 0.5, bh * 0.16, bh * 0.08);
  ctx.fill();
  // a white triangle, then the word
  const ts = bh * 0.3;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-bw * 0.27, -ts);
  ctx.lineTo(-bw * 0.27 + ts * 1.5, 0);
  ctx.lineTo(-bw * 0.27, ts);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  outlined(ctx, 'PLAY', bw * 0.07, 2, bh * 0.62, { width: 0.22 });
  ctx.restore();
  return playRect;
}

// ---------------------------------------------------------------- lobby
const settingsOut = { rects: null, count: 0 };
const chipRects = [
  { id: '', x: 0, y: 0, w: 0, h: 0 },
  { id: '', x: 0, y: 0, w: 0, h: 0 },
  { id: '', x: 0, y: 0, w: 0, h: 0 },
];

/**
 * The game's settings as big readable values at the top (the host taps one to change it, everyone else just sees it).
 * `list`: [{ id, label, text }]. Returns the rectangles to hit-test, as { rects, count }.
 */
export function drawSettings(ctx, view, list, isHost, t) {
  const u = unit(view);
  const n = Math.min(list.length, chipRects.length);
  const gap = 10 * u;
  const ch = Math.max(46, 48 * u);
  let cw = clamp(view.w * 0.2, 104, 168) * Math.min(1.2, u);
  const room = view.w - 136 - 10;
  if (n * cw + (n - 1) * gap > room) cw = Math.max(70, (room - (n - 1) * gap) / n);
  const total = n * cw + (n - 1) * gap;
  const x0 = Math.max(136, (view.w - total) / 2);
  const y = 8 * u;
  for (let i = 0; i < n; i++) {
    const it = list[i];
    const x = x0 + i * (cw + gap);
    const r = chipRects[i];
    r.id = it.id;
    r.x = x;
    r.y = y;
    r.w = cw;
    r.h = ch;
    pill(ctx, x, y + 3, cw, ch, 'rgba(10,3,28,0.55)', INK, 0);
    pill(ctx, x, y, cw, ch, isHost ? '#4b2a96' : '#2b1760', isHost ? '#ffd23f' : INK, isHost ? 3 : 3);
    outlined(ctx, it.label.toUpperCase(), x + cw / 2, y + ch * 0.28, Math.max(11, 13 * u), { fill: '#d6c8ff', width: 0.2 });
    outlined(ctx, it.text, x + cw / 2 - (isHost ? 6 * u : 0), y + ch * 0.68, Math.max(18, 24 * u), { width: 0.2 });
    if (isHost) {
      const bump = Math.sin(t * 5 + i) * 1.5;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(x + cw - 17 * u + bump, y + ch * 0.68 - 7 * u);
      ctx.lineTo(x + cw - 9 * u + bump, y + ch * 0.68);
      ctx.lineTo(x + cw - 17 * u + bump, y + ch * 0.68 + 7 * u);
      ctx.closePath();
      ctx.fill();
    }
  }
  settingsOut.rects = chipRects;
  settingsOut.count = n;
  return settingsOut;
}

/** Painted on the lobby floor, under the dancers. */
export function drawFloorHint(ctx, view, text, t) {
  const s = view.s;
  outlined(ctx, text, view.ox + 6 * s, view.oy + 4 * s + Math.sin(t * 2) * s * 0.05, s * 0.95, { width: 0.2, alpha: 0.92 });
}

/** A bouncing arrow toward the platform's Ready / Start strip at the bottom (it stays above the clear band). */
export function drawReadyCue(ctx, view, text, t) {
  const u = unit(view);
  const x = view.w / 2;
  const y = view.h - 96 * u - 14 * u - Math.abs(Math.sin(t * 5)) * 9 * u;
  ctx.fillStyle = '#2fd46b';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 17 * u, y - 18 * u);
  ctx.lineTo(x - 7 * u, y - 18 * u);
  ctx.lineTo(x - 7 * u, y - 34 * u);
  ctx.lineTo(x + 7 * u, y - 34 * u);
  ctx.lineTo(x + 7 * u, y - 18 * u);
  ctx.lineTo(x + 17 * u, y - 18 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  outlined(ctx, text, x, y - 52 * u, 24 * u, { fill: '#7dff9e', width: 0.22 });
}

/** A small "watching" label for someone who came after the match began (the platform keeps its own note at the top). */
export function drawWatching(ctx, view) {
  const u = unit(view);
  const wd = 130 * u;
  const y = view.h - 40 * u;
  pill(ctx, view.w / 2 - wd / 2, y, wd, 30 * u, 'rgba(10,3,28,0.7)', INK, 3);
  outlined(ctx, 'WATCHING', view.w / 2, y + 15.5 * u, 16 * u, { width: 0.2 });
}

// ---------------------------------------------------------------- countdown and banners
const COUNT_COLORS = ['#2f8cff', '#2fd46b', '#ffd23f', '#ff4d5e'];

/** The big 3, 2, 1, GO!. `frac` is how far through this number's second it is. */
export function drawCountdown(ctx, view, num, frac) {
  const size = Math.min(view.h * 0.62, view.w * 0.36);
  const pop = easeBack(frac * 2.2);
  const fade = num === 0 ? 1 - clamp((frac - 0.6) / 0.4, 0, 1) : 1;
  ctx.save();
  ctx.translate(view.w / 2, view.h * 0.46);
  ctx.rotate(Math.sin(frac * 6) * 0.05);
  ctx.scale(0.4 + pop * 0.6, 0.4 + pop * 0.6);
  outlined(ctx, num === 0 ? 'GO!' : String(num), 0, 0, num === 0 ? size * 0.82 : size, { fill: COUNT_COLORS[clamp(num, 0, 3)], width: 0.2, shadow: size * 0.06, alpha: fade });
  ctx.restore();
}

/** A band across the screen with one or two short lines: "ROUND 2" / "Stand on the color!". `age` in seconds, `dur` how long it stays. */
export function drawBanner(ctx, view, line1, line2, age, dur) {
  const u = unit(view);
  const inP = easeOut(age / 0.25);
  const outP = clamp((age - (dur - 0.25)) / 0.25, 0, 1);
  const slide = (1 - inP) * -view.w * 0.6 + outP * view.w * 0.6;
  const bh = Math.min(view.h * 0.34, 130 * u);
  const y = view.h * 0.4 - bh / 2;
  ctx.save();
  ctx.translate(slide, 0);
  ctx.fillStyle = 'rgba(27,15,51,0.88)';
  ctx.fillRect(0, y, view.w, bh);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, y - 5 * u, view.w, 5 * u);
  ctx.fillRect(0, y + bh, view.w, 5 * u);
  const pop = easeBack((age - 0.1) / 0.3);
  ctx.translate(view.w / 2, y + bh / 2);
  ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
  outlined(ctx, line1, 0, line2 ? -bh * 0.16 : 0, bh * 0.44, { fill: '#ffd23f', width: 0.2 });
  if (line2) outlined(ctx, line2, 0, bh * 0.25, bh * 0.25, { width: 0.2 });
  ctx.restore();
}

// ---------------------------------------------------------------- the call HUD
/** What the HUD needs above the floor: on a narrow screen it sits below the platform's buttons. */
export function hudMetrics(view) {
  const u = unit(view);
  const narrow = view.w < 560;
  return { u, narrow, top: narrow ? 52 * u : 0, height: (narrow ? 52 * u : 0) + 84 * u };
}

function timerColor(frac) {
  return frac > 0.5 ? '#2fd46b' : frac > 0.25 ? '#ffd23f' : '#ff4d5e';
}

/**
 * The top of the screen while playing. `o`: { t, round, rounds, call (colour index or -1), callAge, frac (the time bar, 1 to 0), warn,
 * alive, out (you're out), score, top (pixels to push the row down) }.
 */
export function drawHud(ctx, view, o) {
  const m = hudMetrics(view);
  const u = m.u;
  const top = 6 * u + m.top + (o.top ?? 0);
  // the round, then the swatch with the colour's name, then the bar
  ctx.font = `${22 * u}px ${FONT}`;
  const nameW = o.call >= 0 ? ctx.measureText(COLORS[o.call].name).width : 0;
  const nameBox = Math.max(nameW, 84 * u); // the same room whatever the colour (and before the call), so nothing shifts
  const sw = 50 * u;
  const rw = 78 * u;
  const rowW = rw + 10 * u + sw + 10 * u + nameBox;
  const x0 = m.narrow ? Math.max(8, view.w / 2 - rowW / 2) : Math.max(136, view.w / 2 - rowW / 2);
  pill(ctx, x0, top + 4 * u, rw, 30 * u, 'rgba(10,3,28,0.75)', INK, 3);
  outlined(ctx, `ROUND ${o.round}/${o.rounds}`, x0 + rw / 2, top + 19.5 * u, 13.5 * u, { width: 0.2 });
  if (o.call >= 0) {
    const c = COLORS[o.call];
    const age = Math.max(0, o.callAge);
    // the call: a big swatch pops in the middle of the screen and flies up to its place in the corner
    const fly = age < 0.5 ? 1 - easeOut(age / 0.5) : 0;
    const grow = age < 0.12 ? age / 0.12 : 1;
    const sx = x0 + rw + 10 * u;
    const hx = sx + sw / 2;
    const hy = top + sw / 2 + 2 * u;
    ctx.save();
    ctx.translate(hx + (view.w / 2 - hx) * fly, hy + (view.h * 0.42 - hy) * fly);
    ctx.rotate(fly * 0.22);
    const sc = (1 + 2.2 * fly) * grow;
    ctx.scale(sc, sc);
    roundRect(ctx, -sw / 2, -sw / 2 + 4 * u, sw, sw, 12 * u);
    ctx.fillStyle = shade(c.hex, -0.5);
    ctx.fill();
    roundRect(ctx, -sw / 2, -sw / 2, sw, sw, 12 * u);
    ctx.fillStyle = c.hex;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    fillSymbol(ctx, c.symbol, 0, 0, sw * 0.26, '#fff', 0.1);
    ctx.restore();
    const flash = o.warn > 0 && Math.floor(o.t * 10) % 2 === 0;
    const nameA = clamp((age - 0.25) / 0.25, 0, 1);
    outlined(ctx, c.name, sx + sw + 10 * u + nameBox / 2, hy, 26 * u * (0.85 + 0.15 * nameA), { fill: flash ? '#ffe45c' : '#fff', width: 0.2, alpha: nameA });
    // the time bar
    const bx = sx;
    const by = top + sw + 8 * u;
    const bw = sw + 10 * u + nameBox;
    roundRect(ctx, bx, by, bw, 11 * u, 6 * u);
    ctx.fillStyle = 'rgba(10,3,28,0.8)';
    ctx.fill();
    const f = clamp(o.frac, 0, 1);
    if (f > 0.01) {
      roundRect(ctx, bx + 1.5, by + 1.5, Math.max(8 * u, (bw - 3) * f), 11 * u - 3, 5 * u);
      ctx.fillStyle = flash ? '#ff9aa5' : timerColor(f);
      ctx.fill();
    }
    roundRect(ctx, bx, by, bw, 11 * u, 6 * u);
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  // top right: how many are left dancing, and your points
  const rx = view.w - 12 * u;
  const pw = 78 * u;
  pill(ctx, rx - pw, top + 4 * u, pw, 34 * u, o.out ? '#8a1f32' : 'rgba(10,3,28,0.75)', INK, 3);
  if (o.out) {
    outlined(ctx, 'OUT', rx - pw / 2, top + 21.5 * u, 20 * u, { fill: '#ffb3bd', width: 0.2 });
  } else {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(rx - pw + 18 * u, top + 15 * u, 6.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, rx - pw + 10 * u, top + 23 * u, 16 * u, 10 * u, 5 * u);
    ctx.fill();
    ctx.stroke();
    outlined(ctx, String(o.alive), rx - pw / 2 + 12 * u, top + 21.5 * u, 24 * u, { width: 0.2 });
  }
  if (o.score === null) return;
  pill(ctx, rx - pw, top + 42 * u, pw, 28 * u, 'rgba(10,3,28,0.75)', INK, 3);
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  starPath(ctx, rx - pw + 17 * u, top + 56.5 * u, 9 * u);
  ctx.fill();
  ctx.stroke();
  outlined(ctx, String(o.score), rx - pw / 2 + 10 * u, top + 56.5 * u, 20 * u, { width: 0.2 });
}

/** "OUT!" over the middle of the screen for a moment after you fall. */
export function drawOut(ctx, view, age) {
  const p = easeBack(age / 0.3);
  const fade = 1 - clamp((age - 0.7) / 0.35, 0, 1);
  ctx.save();
  ctx.translate(view.w / 2, view.h * 0.4);
  ctx.rotate(-0.08);
  ctx.scale(p, p);
  outlined(ctx, 'OUT!', 0, 0, Math.min(view.h * 0.3, view.w * 0.2), { fill: '#ff4d5e', width: 0.2, shadow: view.h * 0.02, alpha: fade });
  ctx.restore();
}

// ---------------------------------------------------------------- crowns and the round's winner
export function drawCrown(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, size * 0.09);
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, size * 0.3);
  ctx.lineTo(-size * 0.55, -size * 0.3);
  ctx.lineTo(-size * 0.25, -size * 0.05);
  ctx.lineTo(0, -size * 0.45);
  ctx.lineTo(size * 0.25, -size * 0.05);
  ctx.lineTo(size * 0.55, -size * 0.3);
  ctx.lineTo(size * 0.5, size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const [gx, col] of [[-0.25, '#ff4d5e'], [0, '#2f8cff'], [0.25, '#2fd46b']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(size * gx, size * 0.16, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The round's winner(s): big faces and a name. `o`: { winners: [entry], me (you are one), age }. */
export function drawWinner(ctx, view, o) {
  const u = unit(view);
  const bh = Math.min(view.h * 0.5, 190 * u);
  const y = view.h * 0.4 - bh / 2;
  const inP = easeOut(o.age / 0.3);
  ctx.save();
  ctx.translate((1 - inP) * -view.w, 0);
  ctx.fillStyle = 'rgba(27,15,51,0.88)';
  ctx.fillRect(0, y, view.w, bh);
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, y - 5 * u, view.w, 5 * u);
  ctx.fillRect(0, y + bh, view.w, 5 * u);
  ctx.restore();
  const n = Math.min(3, o.winners.length);
  const hr = Math.min(bh * 0.3, 44 * u);
  const pop = easeBack((o.age - 0.15) / 0.35);
  const spacing = hr * 2.5;
  for (let i = 0; i < n; i++) {
    const e = o.winners[i];
    const hx = view.w / 2 + (i - (n - 1) / 2) * spacing;
    const hy = y + bh * 0.4 + Math.sin(o.age * 7 + i) * 3 * u;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(pop, pop);
    drawHead(ctx, 0, 0, hr, { color: e.color, av: e.bot ? null : e.av, seed: e.seed, look: 0, t: o.age, lw: 4 });
    drawCrown(ctx, 0, -hr * 1.18, hr * 0.95);
    ctx.restore();
  }
  const text = o.me ? 'YOU WIN!' : o.winners.length > 1 ? 'TIE!' : `${tag(o.winners[0]?.name)} WINS!`;
  outlined(ctx, text, view.w / 2, y + bh * 0.84, bh * 0.2, { fill: '#ffd23f', width: 0.2, alpha: clamp((o.age - 0.2) / 0.2, 0, 1) });
}

// ---------------------------------------------------------------- the scoreboard between rounds
/**
 * `o`: { rows: [{ name, av, color, seed, bot, me, score, pts }] sorted best first, age, round, rounds }. Points fly in: each row
 * counts up from its old total to its new one (score - pts) while "+pts" floats beside it.
 */
export function drawBoard(ctx, view, o) {
  const u = unit(view);
  const n = o.rows.length;
  const cols = n > 6 ? 2 : 1;
  const perCol = Math.ceil(n / cols);
  const topPad = 58 * u;
  const availH = view.h - topPad - 30 * u;
  const rh = clamp(availH / perCol, 28, 50 * u);
  const cw = Math.min(cols === 2 ? view.w / 2 - 20 : view.w - 40, 280 * u);
  const panelW = cw * cols + (cols - 1) * 14 * u + 28 * u;
  const panelH = perCol * rh + 20 * u;
  const px = (view.w - panelW) / 2;
  const py = topPad + Math.max(0, (availH - perCol * rh) / 2) + 8 * u;
  const inP = easeOut(o.age / 0.3);
  ctx.save();
  ctx.globalAlpha = inP;
  ctx.translate(0, (1 - inP) * 40);
  outlined(ctx, 'SCORES', view.w / 2, py - 24 * u, 26 * u, { fill: '#ffd23f', width: 0.2 });
  roundRect(ctx, px, py - 6 * u, panelW, panelH + 6 * u, 16 * u);
  ctx.fillStyle = 'rgba(27,15,51,0.9)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  for (let i = 0; i < n; i++) {
    const e = o.rows[i];
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = px + 14 * u + col * (cw + 14 * u);
    const y = py + 4 * u + row * rh;
    if (e.me) {
      roundRect(ctx, x - 4 * u, y + 1, cw + 8 * u, rh - 2, 10 * u);
      ctx.fillStyle = 'rgba(255,210,63,0.22)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
    }
    outlined(ctx, String(i + 1), x + 10 * u, y + rh / 2, rh * 0.5, { fill: i === 0 ? '#ffd23f' : '#d6c8ff', width: 0.22 });
    drawHead(ctx, x + 38 * u, y + rh / 2, rh * 0.36, { color: e.color, av: e.bot ? null : e.av, seed: e.seed, look: 0, t: o.age, lw: 2.5 });
    outlined(ctx, tag(e.name), x + 38 * u + rh * 0.5, y + rh / 2, Math.min(rh * 0.46, 18 * u), { align: 'left', fill: e.me ? '#ffe45c' : '#fff', width: 0.22 });
    const k = easeOut((o.age - 0.5 - i * 0.05) / 1.1);
    const shown = Math.round((e.score - e.pts) + e.pts * k);
    outlined(ctx, String(shown), x + cw - 6 * u, y + rh / 2, rh * 0.52, { align: 'right', fill: '#fff', width: 0.22 });
    if (e.pts > 0) {
      const fa = clamp((o.age - 0.3 - i * 0.05) / 0.2, 0, 1) * (1 - clamp((o.age - 1.8) / 0.5, 0, 1));
      if (fa > 0) {
        const rise = easeOut((o.age - 0.3 - i * 0.05) / 0.9) * 10 * u;
        outlined(ctx, `+${e.pts}`, x + cw - 58 * u, y + rh / 2 - rise, rh * 0.42, { fill: '#7dff9e', width: 0.22, alpha: fa });
      }
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the podium
const podView = { s: 40, ox: 0, oy: 0 };
const podActor = { x: 0, y: 0, vx: 0, vy: 0, ang: Math.PI / 2, ps: false, kn: false, st: 0, ft: 0, age: 9, color: '#fff', name: '', bot: false, me: false, av: null, seed: 0, ready: false, hop: 0, you: -1 };
const BLOCK = [
  { fill: '#ffd23f', dark: '#b8860b', h: 0.46 },
  { fill: '#cfd8e6', dark: '#7d8aa0', h: 0.34 },
  { fill: '#e29a5b', dark: '#965a2a', h: 0.25 },
];
const AWARDS = {
  push: { label: 'PUSHIEST', fill: '#ff8a2b' },
  lucky: { label: 'LUCKY FEET', fill: '#2fd46b' },
};

/**
 * `o`: { top: [first, second, third] (entries or null), age, me: { place, entry } | null, awards: [{ kind, entry }], t }.
 * An entry: { name, av, color, seed, bot, me, score }. The bottom of the screen stays clear (the lobby strip is there afterwards).
 */
export function drawPodium(ctx, view, o) {
  const u = unit(view);
  const bottom = view.h - 96 * u;
  const topY = 46 * u;
  const regionH = Math.max(120, bottom - topY);
  const bw = clamp(view.w * 0.16, 84, 150 * u);
  const gap = bw * 0.1;
  const order = [1, 0, 2]; // second on the left, first in the middle
  const startX = view.w / 2 - (bw * 3 + gap * 2) / 2;
  outlined(ctx, 'RESULTS', view.w / 2, topY - 12 * u, 24 * u, { fill: '#ffd23f', width: 0.2 });
  for (let k = 0; k < 3; k++) {
    const place = order[k];
    const e = o.top[place];
    if (!e) continue;
    const spec = BLOCK[place];
    const delay = place === 0 ? 0.9 : place === 1 ? 0.5 : 0.2;
    const grow = easeBack((o.age - delay) / 0.45);
    const bh = Math.max(0, regionH * spec.h * 0.75 * grow);
    const x = startX + k * (bw + gap);
    const y = bottom - bh;
    if (bh > 1) {
      roundRect(ctx, x, y + 5, bw, bh, 8 * u);
      ctx.fillStyle = spec.dark;
      ctx.fill();
      roundRect(ctx, x, y, bw, bh - 5, 8 * u);
      ctx.fillStyle = spec.fill;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      outlined(ctx, String(place + 1), x + bw / 2, y + (bh - 5) * 0.4, Math.min(bh * 0.55, bw * 0.55), { fill: '#fff', width: 0.2 });
      if (bh > 60 * u) outlined(ctx, String(e.score), x + bw / 2, y + (bh - 5) * 0.8, Math.min(bh * 0.24, 24 * u), { width: 0.2 });
    }
    if (o.age > delay + 0.15) {
      const drop = clamp((o.age - delay - 0.15) / 0.3, 0, 1);
      const a = podActor;
      podView.s = clamp(bw * 0.7, 40, 92 * u);
      podView.ox = x + bw / 2;
      podView.oy = y - (1 - easeBack(drop)) * podView.s * 0.7;
      a.color = e.color;
      a.name = e.name;
      a.bot = e.bot;
      a.me = e.me;
      a.av = e.av;
      a.seed = e.seed;
      a.hop = place === 0 ? 1 : 0;
      a.age = 9;
      drawActor(ctx, podView, a, o.t);
      if (place === 0) drawCrown(ctx, podView.ox, podView.oy - podView.s * 1.62 - Math.abs(Math.sin(o.t * 8 + a.seed)) * 0.4 * podView.s, podView.s * 0.5);
    }
  }
  // below the top three: where you finished
  if (o.me && o.me.place > 3 && o.age > 1.2) {
    const text = `YOU  ${ordinal(o.me.place)}`;
    const pw = 150 * u;
    pill(ctx, view.w / 2 - pw / 2, topY + 2 * u, pw, 34 * u, '#4b2a96', '#ffd23f', 3);
    outlined(ctx, text, view.w / 2, topY + 19.5 * u, 22 * u, { width: 0.2 });
  }
  // the fun awards, at the sides
  let ai = 0;
  for (const aw of o.awards) {
    if (!aw.entry || o.age < 1.6 + ai * 0.2) continue;
    const spec = AWARDS[aw.kind];
    const cw = Math.min(120 * u, startX - 16);
    if (cw < 70) break;
    const x = ai === 0 ? 12 : view.w - cw - 12;
    const y = topY + regionH * 0.2;
    const pop = easeBack((o.age - 1.6 - ai * 0.2) / 0.35);
    ctx.save();
    ctx.translate(x + cw / 2, y + 48 * u);
    ctx.scale(pop, pop);
    roundRect(ctx, -cw / 2, -48 * u, cw, 96 * u, 14 * u);
    ctx.fillStyle = spec.fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    outlined(ctx, spec.label, 0, -34 * u, 13 * u, { width: 0.2 });
    drawHead(ctx, 0, -2 * u, 20 * u, { color: aw.entry.color, av: aw.entry.bot ? null : aw.entry.av, seed: aw.entry.seed, look: 0, t: o.t, lw: 3 });
    outlined(ctx, tag(aw.entry.name), 0, 34 * u, 14 * u, { width: 0.2, fill: aw.entry.me ? '#ffe45c' : '#fff' });
    ctx.restore();
    ai++;
  }
}

// ---------------------------------------------------------------- the room closed
const closedRect = { x: 0, y: 0, w: 0, h: 0 };

/** One message and one button (the room closed: you were removed, the connection dropped, another tab took over). */
export function drawClosed(ctx, view, message, button, t) {
  const u = unit(view);
  ctx.fillStyle = 'rgba(14,5,34,0.72)';
  ctx.fillRect(0, 0, view.w, view.h);
  outlined(ctx, message, view.w / 2, view.h * 0.36, Math.min(40 * u, view.w * 0.07), { width: 0.2 });
  const bw = clamp(view.w * 0.3, 190, 320);
  const bh = clamp(view.h * 0.16, 56, 84);
  const cx = view.w / 2;
  const cy = view.h * 0.62;
  closedRect.x = cx - bw / 2;
  closedRect.y = cy - bh / 2;
  closedRect.w = bw;
  closedRect.h = bh;
  const pulse = 1 + Math.sin(t * 4.2) * 0.03;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  pill(ctx, -bw / 2, -bh / 2 + bh * 0.1, bw, bh, '#127a3c', INK, 4);
  pill(ctx, -bw / 2, -bh / 2, bw, bh, '#2fd46b', INK, 4);
  outlined(ctx, button, 0, 2, bh * 0.5, { width: 0.22 });
  ctx.restore();
  return closedRect;
}
