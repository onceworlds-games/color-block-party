// The look: a night-time disco. Backdrop with sweeping spotlights, a mirror ball and thumping speakers; a dance floor of
// 12 x 8 colour tiles with a white symbol each; chunky characters with thick dark outlines and flat drop shadows.
// Everything here takes plain data and a 2D context (poster.js draws the store art with the same functions).
import { COLORS, COLS, ROWS } from './rules.js';
import { FALL_TIME } from './sim.js';
import { INK, clamp, easeBack, fillSymbol, outlined, roundRect, shade, starPath, tag } from './theme.js';

/** Where the floor goes on the screen. The layout glides to a new fit instead of jumping. */
export class View {
  constructor() {
    this.w = 800;
    this.h = 450;
    this.pr = 1;
    this.s = 30; // pixels per tile (CSS px)
    this.ox = 0; // where tile (0, 0) is
    this.oy = 0;
    this.ts = 30; // the layout being glided to
    this.tox = 0;
    this.toy = 0;
    this.calm = false;
    this.noBall = false; // store art: no mirror ball
  }
  resize(w, h, pr) {
    this.w = w;
    this.h = h;
    this.pr = pr;
  }
  /** The biggest floor that fits between the margins (top and bottom in pixels). */
  fit(top, bottom) {
    const padX = Math.max(10, this.w * 0.02);
    const availH = Math.max(40, this.h - top - bottom);
    const s = Math.max(8, Math.min((this.w - padX * 2) / COLS, availH / (ROWS + 0.12)));
    this.ts = s;
    this.tox = (this.w - COLS * s) / 2;
    this.toy = top + (availH - (ROWS + 0.12) * s) / 2;
  }
  snap() {
    this.s = this.ts;
    this.ox = this.tox;
    this.oy = this.toy;
  }
  glide(dt) {
    const k = 1 - Math.exp(-9 * dt);
    this.s += (this.ts - this.s) * k;
    this.ox += (this.tox - this.ox) * k;
    this.oy += (this.toy - this.oy) * k;
  }
  /** Sets the layout directly (store art). */
  place(s, ox, oy) {
    this.ts = this.s = s;
    this.tox = this.ox = ox;
    this.toy = this.oy = oy;
  }
}

// ---------------------------------------------------------------- backdrop
let bg = { h: 0, grad: null, ctx: null };

const BEAMS = [
  { x: 0.1, color: 'rgba(255,92,200,0.14)', ph: 0 },
  { x: 0.36, color: 'rgba(90,220,255,0.12)', ph: 1.7 },
  { x: 0.64, color: 'rgba(255,225,90,0.11)', ph: 3.1 },
  { x: 0.9, color: 'rgba(170,110,255,0.15)', ph: 4.6 },
];

export function drawBackdrop(ctx, view, t, beat) {
  const { w, h } = view;
  if (bg.h !== h || bg.ctx !== ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#12062b');
    g.addColorStop(0.55, '#2a0e5a');
    g.addColorStop(1, '#15082f');
    bg = { h, grad: g, ctx };
  }
  ctx.fillStyle = bg.grad;
  ctx.fillRect(0, 0, w, h);

  // flat spotlight beams sweeping from the ceiling
  const sweep = view.calm ? 0.2 : 1;
  for (const b of BEAMS) {
    const a = Math.sin(t * 0.6 * sweep + b.ph) * 0.55;
    const x0 = w * b.x;
    const len = h * 1.5;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(x0, -10);
    ctx.lineTo(x0 + Math.sin(a - 0.1) * len, -10 + Math.cos(a - 0.1) * len);
    ctx.lineTo(x0 + Math.sin(a + 0.1) * len, -10 + Math.cos(a + 0.1) * len);
    ctx.closePath();
    ctx.fill();
  }

  // the mirror ball, top centre
  if (view.noBall) return;
  const r = clamp(h * 0.05, 12, 26);
  const cx = w / 2;
  const cy = r + 8;
  ctx.strokeStyle = 'rgba(200,210,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, cy - r);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#aab6f5';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const step = r / 2.6;
  const drift = (t * 14 * sweep) % (step * 2);
  ctx.fillStyle = '#e9edff';
  for (let gx = -2; gx < r * 2 / step + 2; gx++) {
    for (let gy = 0; gy < r * 2 / step; gy++) {
      if ((gx + gy) % 2) continue;
      ctx.fillRect(cx - r + gx * step + drift - step, cy - r + gy * step, step, step);
    }
  }
  ctx.fillStyle = 'rgba(27,15,51,0.3)';
  ctx.beginPath();
  ctx.rect(cx - r, cy - r, r * 2, r * 2);
  ctx.moveTo(cx - r * 0.35 + r * 1.1, cy - r * 0.35);
  ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 1.1, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (!view.calm) {
    for (let i = 0; i < 4; i++) {
      const on = Math.sin(t * 3 + i * 1.9) > 0.3;
      if (!on) continue;
      const a = i * 1.7 + t * 0.4;
      ctx.fillStyle = '#fff';
      starPath(ctx, cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.3, r * 0.34);
      ctx.fill();
    }
  }
  void beat;
}

/** Speakers at the sides of the floor, thumping with the beat (only if there's room beside it). */
export function drawSpeakers(ctx, view, beat) {
  const s = view.s;
  if (view.ox < s * 1.7) return;
  const bw = s * 1.15;
  const bh = s * 3.3;
  const y = view.oy + s * 2.4;
  for (const side of [-1, 1]) {
    const x = side < 0 ? view.ox - s * 0.55 - bw : view.ox + COLS * s + s * 0.55;
    roundRect(ctx, x, y, bw, bh, s * 0.14);
    ctx.fillStyle = '#241046';
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.strokeStyle = INK;
    ctx.stroke();
    const pump = 1 + 0.09 * beat;
    ctx.fillStyle = '#4a2a8a';
    ctx.beginPath();
    ctx.arc(x + bw / 2, y + bh * 0.24, bw * 0.17 * pump, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a1f70';
    ctx.beginPath();
    ctx.arc(x + bw / 2, y + bh * 0.66, bw * 0.34 * pump, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7a52c8';
    ctx.beginPath();
    ctx.arc(x + bw / 2, y + bh * 0.66, bw * 0.14 * pump, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the floor
let spriteSet = { key: '', list: [] };

function buildSprite(S, color, symbol) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gap = S * 0.055;
  const depth = S * 0.1;
  const r = S * 0.15;
  const fw = S - gap * 2;
  const fh = S - gap * 2 - depth;
  roundRect(g, gap, gap + depth, fw, fh, r);
  g.fillStyle = shade(color, -0.5);
  g.fill();
  roundRect(g, gap, gap, fw, fh, r);
  g.fillStyle = color;
  g.fill();
  g.save();
  roundRect(g, gap, gap, fw, fh, r);
  g.clip();
  g.fillStyle = shade(color, 0.38);
  g.fillRect(gap, gap, fw, fh * 0.15);
  g.fillStyle = shade(color, -0.14);
  g.fillRect(gap, gap + fh * 0.84, fw, fh * 0.16);
  g.restore();
  fillSymbol(g, symbol, S / 2, gap + fh / 2, S * 0.2, '#ffffff', 0.1);
  return c;
}

function sprites(view) {
  const S = Math.max(12, Math.round(view.ts * view.pr));
  if (spriteSet.key !== `${S}`) spriteSet = { key: `${S}`, list: COLORS.map((c) => buildSprite(S, c.hex, c.symbol)) };
  return spriteSet.list;
}

/** The lobby floor's colour for a tile: a slow diagonal ripple of changing colours. */
export function partyColor(i, t) {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return (Math.floor(t * 1.03 + c * 0.28 + r * 0.42) + ((i * 7) % 3 === 0 ? 3 : 0)) % 6;
}

const lampColors = ['#ff4d5e', '#ffd23f', '#2fd46b', '#2f8cff', '#a45cf0', '#ff8a2b'];

function drawFrame(ctx, view, t) {
  const s = view.s;
  const pad = s * 0.2;
  const x = view.ox - pad;
  const y = view.oy - pad;
  const w = COLS * s + pad * 2;
  const h = ROWS * s + pad * 2 + s * 0.1;
  roundRect(ctx, x, y + s * 0.12, w, h, s * 0.3);
  ctx.fillStyle = 'rgba(8,2,22,0.8)';
  ctx.fill();
  roundRect(ctx, x, y, w, h, s * 0.3);
  ctx.fillStyle = '#0c0521';
  ctx.fill();
  ctx.lineWidth = Math.max(3, s * 0.08);
  ctx.strokeStyle = INK;
  ctx.stroke();
  // chasing lamps around the edge
  const n = COLS;
  for (let i = 0; i < n; i++) {
    const lx = view.ox + (i + 0.5) * s;
    for (const ly of [y + pad * 0.5, y + h - pad * 0.5 - s * 0.08]) {
      ctx.fillStyle = lampColors[(i + Math.floor(t * 3)) % 6];
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draws the floor. `fl`: { kind: 'party' | 'match', t, beat, popT } and, for a match, { colors, call, dropT, warn }:
 * popT is the seconds since the floor began to come up (the tiles rise in a wave; 99 for a floor that's been there a while),
 * dropT the seconds since the drop (-1 before), warn (0 to 1) how close the drop is (the tiles that will go tremble).
 */
export function drawFloor(ctx, view, fl) {
  const s = view.s;
  const list = sprites(view);
  if (!fl.noFrame) drawFrame(ctx, view, fl.t);
  const match = fl.kind === 'match';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      let ci;
      let dx = 0;
      let dy = 0;
      let sc = 1;
      let rot = 0;
      let alpha = 1;
      if (fl.popT < 0.75) {
        const p = clamp((fl.popT - (c + r) * 0.025) / 0.32, 0, 1);
        if (p <= 0) continue;
        const e = easeBack(p);
        sc = 0.55 + 0.45 * e;
        dy = (1 - e) * s * 0.7;
        alpha = Math.min(1, p * 2.2);
      }
      if (!match) {
        ci = partyColor(i, fl.t);
        dy -= s * 0.035 * fl.beat * ((c + r) % 2 ? 1 : -0.4);
      } else {
        ci = fl.colors[i];
        if (fl.dropT >= 0) {
          if (ci !== fl.call) {
            const delay = c * 0.012 + r * 0.009 + ((i * 37) % 17) * 0.004;
            const q = (fl.dropT - delay) / 0.35;
            if (q >= 1) continue;
            if (q < 0) {
              dx = Math.sin(fl.t * 90 + i * 2.1) * s * 0.03;
            } else {
              dy += q * q * s * 2.6;
              sc *= 1 - 0.35 * q;
              rot = (i % 2 ? 1 : -1) * q * 0.8;
              alpha *= 1 - q * q;
            }
          } else {
            dy -= s * 0.06 * Math.sin(clamp(fl.dropT * 3.5, 0, 1) * Math.PI);
          }
        } else if (fl.warn > 0 && ci !== fl.call) {
          dx = Math.sin(fl.t * 70 + i * 1.7) * s * 0.028 * fl.warn;
          dy += Math.cos(fl.t * 63 + i) * s * 0.012 * fl.warn;
        }
      }
      const x = view.ox + c * s + dx;
      const y = view.oy + r * s + dy;
      if (alpha !== 1) ctx.globalAlpha = alpha;
      if (sc !== 1 || rot !== 0) {
        ctx.save();
        ctx.translate(x + s / 2, y + s / 2);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.drawImage(list[ci], -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(list[ci], x, y, s, s);
      }
      if (alpha !== 1) ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------- characters
/**
 * A head: the player's avatar if it's loaded, else a cute generated face (bots always). `o`: { color, av, seed, look, t, lw, mood }.
 * `look` is the direction the eyes follow, in radians; `mood` is 0 happy, 1 scared, 2 dizzy.
 */
export function drawHead(ctx, x, y, r, o) {
  const lw = o.lw ?? 3;
  ctx.fillStyle = shade(o.color, 0.22);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const av = o.av;
  if (av && av.complete && av.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(av, x - r, y - r * 1.04, r * 2, r * 2.08);
    } catch {
      // a broken image never stops a frame
    }
    ctx.restore();
  } else {
    drawFace(ctx, x, y, r, o);
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawFace(ctx, x, y, r, o) {
  const seed = o.seed | 0;
  const look = o.look ?? 0;
  const mood = o.mood ?? 0;
  const eyeStyle = (seed >>> 1) % 3;
  const mouthStyle = (seed >>> 4) % 4;
  const blink = ((o.t ?? 0) * 0.8 + seed * 0.37) % 4 > 3.88;
  const ex = r * 0.38;
  const ey = y - r * 0.1;
  const lx = Math.cos(look) * r * 0.07;
  const ly = Math.sin(look) * r * 0.06;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const cx = x + side * ex;
    if (blink || mood === 2) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.beginPath();
      if (mood === 2) {
        ctx.moveTo(cx - side * r * 0.12, ey - r * 0.1);
        ctx.lineTo(cx + side * r * 0.1, ey);
        ctx.lineTo(cx - side * r * 0.12, ey + r * 0.1);
      } else {
        ctx.moveTo(cx - r * 0.13, ey);
        ctx.lineTo(cx + r * 0.13, ey);
      }
      ctx.stroke();
    } else if (eyeStyle === 2 && mood === 0) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + lx, ey + ly, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const big = mood === 1 ? 1.25 : 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx, ey, r * 0.19 * big, r * (eyeStyle === 1 ? 0.27 : 0.2) * big, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + lx, ey + ly, r * 0.1 * big, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(255,90,120,0.45)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(x + side * r * 0.62, y + r * 0.24, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  const my = y + r * 0.42;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.beginPath();
  if (mood !== 0 || mouthStyle === 2) {
    ctx.ellipse(x, my + r * 0.04, r * 0.14, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (mouthStyle === 1) {
    ctx.arc(x, my - r * 0.1, r * 0.28, 0.1, Math.PI - 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff6b8a';
    ctx.beginPath();
    ctx.arc(x, my + r * 0.12, r * 0.1, 0, Math.PI, true);
    ctx.fill();
  } else if (mouthStyle === 3) {
    ctx.moveTo(x - r * 0.25, my - r * 0.03);
    ctx.quadraticCurveTo(x, my + r * 0.3, x + r * 0.25, my - r * 0.03);
    ctx.stroke();
  } else {
    ctx.arc(x, my - r * 0.12, r * 0.22, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
}

/**
 * One dancer. `a`: { x, y (tiles), vx, vy, ang, ps, kn, st (0 up, 1 falling, 2 ghost), ft (seconds falling), age (seconds since it
 * appeared), color, name, bot, me, av, seed, hop (0 to 1), you (seconds since the round began, or -1) }.
 */
export function drawActor(ctx, view, a, t) {
  const s = view.s;
  const x = view.ox + a.x * s;
  const y = view.oy + a.y * s;
  const lw = clamp(s * 0.09, 2.2, 4);
  const speed = Math.hypot(a.vx, a.vy);
  const ghost = a.st === 2;
  const falling = a.st === 1;
  let scale = a.age < 0.4 ? Math.max(0.05, easeBack(a.age / 0.4)) : 1;
  let rot = 0;
  let lift = 0;
  let alpha = 1;
  if (falling) {
    const p = clamp(a.ft / FALL_TIME, 0, 1);
    scale *= Math.max(0.03, 1 - Math.pow(p, 1.3));
    rot = a.ft * 9 * (a.seed % 2 ? 1 : -1);
    lift = -Math.sin(Math.min(1, p * 2.2) * Math.PI) * 0.3 * s + p * p * s * 0.7;
    alpha = 1 - p * 0.45;
  } else if (ghost) {
    alpha = 0.4;
    lift = -(0.26 + Math.sin(t * 2.4 + a.seed) * 0.08) * s;
  }
  const moving = speed > 0.6 && !ghost && !falling;
  const phase = t * 15 + a.seed;
  const bob = moving ? Math.abs(Math.sin(phase)) * 0.06 * s : Math.sin(t * 3 + a.seed) * 0.012 * s;
  let sx = 1;
  let sy = 1;
  if (moving) {
    sy = 1 + Math.min(0.08, speed * 0.016);
    sx = 1 / sy;
  }
  if (a.hop > 0 && !ghost && !falling) {
    const j = Math.abs(Math.sin(t * 8 + a.seed));
    lift -= j * 0.4 * s * a.hop;
    sy *= 1 + (0.1 - j * 0.2) * a.hop;
    sx = 1 / sy;
  }
  const tilt = a.kn && !ghost ? Math.sin(t * 26) * 0.22 : 0;

  // the flat drop shadow and, for you, the light ring under your feet
  if (!ghost) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(10,3,28,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.03, s * 0.36 * scale * Math.max(0.3, 1 + (lift / s) * 0.4), s * 0.14 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (a.me && !falling) {
    ctx.globalAlpha = ghost ? 0.3 : 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.03, s * 0.48 + Math.sin(t * 5) * s * 0.015, s * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y + lift);
  ctx.rotate(rot + tilt);
  ctx.scale(scale * sx, scale * sy);
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  const body = ghost ? '#dfe8ff' : a.color;
  const fx = Math.cos(a.ang);
  const fy = Math.sin(a.ang);

  // feet
  const stride = moving ? Math.sin(phase) * 0.06 * s : 0;
  ctx.fillStyle = INK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 0.15 * s, -0.02 * s + side * stride, 0.12 * s, 0.075 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // body
  roundRect(ctx, -0.3 * s, -0.6 * s - bob, 0.6 * s, 0.5 * s, 0.2 * s);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = shade(body, 0.3);
  roundRect(ctx, -0.18 * s, -0.54 * s - bob, 0.14 * s, 0.2 * s, 0.07 * s);
  ctx.fill();
  // hands: swinging at the sides, or both fists thrust out in a push
  const hand = shade(body, 0.35);
  if (a.ps && !ghost) {
    const px = -fy;
    const py = fx;
    for (const side of [-1, 1]) {
      const hx = fx * 0.52 * s + px * side * 0.15 * s;
      const hy = -0.38 * s - bob + fy * 0.3 * s + py * side * 0.07 * s;
      ctx.fillStyle = hand;
      ctx.beginPath();
      ctx.arc(hx, hy, 0.13 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    const swing = moving ? Math.sin(phase) * 0.08 * s : 0;
    for (const side of [-1, 1]) {
      ctx.fillStyle = hand;
      ctx.beginPath();
      ctx.arc(side * 0.37 * s, -0.33 * s - bob - side * swing, 0.1 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  // the head
  const hy = -0.82 * s - bob;
  const hr = 0.34 * s;
  if (a.bot && !ghost) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, hy - hr * 0.9);
    ctx.lineTo(Math.sin(t * 4 + a.seed) * 0.05 * s, hy - hr - 0.2 * s);
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.arc(Math.sin(t * 4 + a.seed) * 0.05 * s, hy - hr - 0.24 * s, 0.075 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  drawHead(ctx, 0, hy, hr, {
    color: ghost ? '#dfe8ff' : a.color,
    av: a.bot ? null : a.av,
    seed: a.seed,
    look: a.ang,
    t,
    lw,
    mood: falling ? 1 : a.kn ? 2 : 0,
  });
  if (a.kn && !ghost && !falling) {
    ctx.lineWidth = Math.max(1.5, lw * 0.5);
    for (let i = 0; i < 3; i++) {
      const ang = t * 7 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = '#ffd23f';
      starPath(ctx, Math.cos(ang) * 0.36 * s, hy - hr * 0.95 + Math.sin(ang) * 0.1 * s, 0.1 * s);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();

  // name tag and the "you" arrow, upright and unscaled
  if (falling || a.age < 0.2 || a.noTag) return;
  const top = y + lift - 1.28 * s * scale;
  const size = clamp(s * 0.36, 11, 20);
  ctx.globalAlpha = ghost ? 0.55 : 1;
  outlined(ctx, tag(a.name), x, top, size, { fill: a.me ? '#ffe45c' : '#fff', width: 0.24 });
  const above = top - size * 0.95;
  if (a.me && a.you >= 0 && a.you < 3) {
    const bounce = Math.abs(Math.sin(t * 6)) * s * 0.18;
    const ay = above - s * 0.12 - bounce;
    const fade = a.you > 2.5 ? 1 - (a.you - 2.5) * 2 : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffe45c';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x, ay);
    ctx.lineTo(x - s * 0.24, ay - s * 0.3);
    ctx.lineTo(x - s * 0.1, ay - s * 0.3);
    ctx.lineTo(x - s * 0.1, ay - s * 0.52);
    ctx.lineTo(x + s * 0.1, ay - s * 0.52);
    ctx.lineTo(x + s * 0.1, ay - s * 0.3);
    ctx.lineTo(x + s * 0.24, ay - s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    outlined(ctx, 'YOU', x, ay - s * 0.82, clamp(s * 0.34, 12, 20), { fill: '#ffe45c', width: 0.24 });
  }
  ctx.globalAlpha = 1;
}

/** Draws every dancer, back to front. */
export function drawActors(ctx, view, list, t) {
  list.sort((p, q) => p.y - q.y);
  for (const a of list) drawActor(ctx, view, a, t);
}

