// Juice: particles, floating numbers, rings and camera shake. Positions are in tiles, so everything scales with the floor.
import { INK, outlined, starPath } from './theme.js';

const MAX = 420;
const PALETTE = ['#ff4d5e', '#ffd23f', '#2fd46b', '#2f8cff', '#a45cf0', '#ff8a2b', '#ffffff', '#ff5fa2', '#19d3da', '#b6e82e', '#c9b8ff', '#3a2a5e'];
export const PAL = { red: 0, yellow: 1, green: 2, blue: 3, purple: 4, orange: 5, white: 6, pink: 7, cyan: 8, lime: 9, mist: 10, ink: 11 };

// one slot per particle (parallel arrays: no allocation while playing)
const alive = new Uint8Array(MAX);
const px = new Float32Array(MAX);
const py = new Float32Array(MAX);
const pvx = new Float32Array(MAX);
const pvy = new Float32Array(MAX);
const life = new Float32Array(MAX);
const maxLife = new Float32Array(MAX);
const size = new Float32Array(MAX);
const rot = new Float32Array(MAX);
const vrot = new Float32Array(MAX);
const kind = new Uint8Array(MAX); // 0 confetti, 1 dot, 2 star, 3 streak
const col = new Uint8Array(MAX);
const grav = new Float32Array(MAX);
const drag = new Float32Array(MAX);
let count = 0;
let cursor = 0;

const texts = Array.from({ length: 24 }, () => ({ on: false, x: 0, y: 0, vy: 0, t: 0, max: 1, str: '', color: '#fff', size: 20 }));
const rings = Array.from({ length: 12 }, () => ({ on: false, x: 0, y: 0, t: 0, max: 0.4, r: 1, color: '#fff' }));

let scale = 1; // particle budget: quality, and reduced motion
let calm = false;
let trauma = 0;
let clock = 0;
const shakeOut = { x: 0, y: 0 };

export const fx = {
  /** Quality ('low' | 'medium' | 'high') and the reduced-motion preference set how much there is. */
  setLevel(quality, reduced) {
    scale = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1;
    calm = Boolean(reduced);
    if (calm) scale *= 0.45;
  },
  reset() {
    alive.fill(0);
    count = 0;
    for (const t of texts) t.on = false;
    for (const r of rings) r.on = false;
    trauma = 0;
  },
  get calm() {
    return calm;
  },

  spawn(x, y, vx, vy, lifeSec, sz, k, c, g = 0, d = 0, v = 0) {
    if (count >= Math.ceil(MAX * Math.min(1, scale + 0.15))) return;
    for (let n = 0; n < MAX; n++) {
      const i = (cursor + n) % MAX;
      if (alive[i]) continue;
      cursor = (i + 1) % MAX;
      alive[i] = 1;
      px[i] = x;
      py[i] = y;
      pvx[i] = vx;
      pvy[i] = vy;
      life[i] = maxLife[i] = lifeSec;
      size[i] = sz;
      kind[i] = k;
      col[i] = c;
      grav[i] = g;
      drag[i] = d;
      rot[i] = Math.random() * 6.28;
      vrot[i] = v;
      count++;
      return;
    }
  },

  /** A puff of dust at the feet. */
  dust(x, y) {
    if (Math.random() > scale + 0.1) return;
    fx.spawn(x + (Math.random() - 0.5) * 0.2, y, (Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.4, 0.35, 0.09 + Math.random() * 0.05, 1, PAL.mist, 0, 3);
  },
  /** A burst of dust and stars: someone spun into the dark, or a shove landed. */
  puff(x, y, n = 10) {
    for (let i = 0; i < Math.ceil(n * scale); i++) {
      const a = Math.random() * 6.28;
      const s = 0.8 + Math.random() * 1.8;
      fx.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.6 - 0.4, 0.5 + Math.random() * 0.3, 0.12 + Math.random() * 0.1, 1, PAL.white, 0, 3.5);
    }
  },
  /** Yellow stars flying out (a shove landed). */
  stars(x, y, n = 6) {
    for (let i = 0; i < Math.ceil(n * Math.max(0.5, scale)); i++) {
      const a = Math.random() * 6.28;
      const s = 1.5 + Math.random() * 2.2;
      fx.spawn(x, y - 0.4, Math.cos(a) * s, Math.sin(a) * s - 1.2, 0.6 + Math.random() * 0.3, 0.16 + Math.random() * 0.08, 2, i % 2 ? PAL.yellow : PAL.white, 5, 1.2, 8);
    }
  },
  /** Sparks where two dancers collide. */
  sparks(x, y, n = 8) {
    for (let i = 0; i < Math.ceil(n * scale); i++) {
      const a = Math.random() * 6.28;
      const s = 2 + Math.random() * 3;
      fx.spawn(x, y - 0.3, Math.cos(a) * s, Math.sin(a) * s, 0.25 + Math.random() * 0.2, 0.2, 3, i % 2 ? PAL.yellow : PAL.white, 0, 4);
    }
  },
  /** Confetti raining from above `x` (tiles), across `spread` tiles. */
  confetti(x, y, n = 30, spread = 3) {
    for (let i = 0; i < Math.ceil(n * scale); i++) {
      fx.spawn(
        x + (Math.random() - 0.5) * spread,
        y - Math.random() * 0.6,
        (Math.random() - 0.5) * 2.2,
        -(1.5 + Math.random() * 2.5) * (calm ? 0.5 : 1),
        calm ? 2.6 : 2.2 + Math.random() * 1.4,
        0.1 + Math.random() * 0.07,
        0,
        Math.floor(Math.random() * 10),
        calm ? 1.6 : 3.4,
        0.6,
        (Math.random() - 0.5) * 12,
      );
    }
  },
  /** Confetti thrown up from the floor (a win). */
  burst(x, y, n = 40) {
    for (let i = 0; i < Math.ceil(n * scale); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 3 + Math.random() * 4.5;
      fx.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 1.6 + Math.random() * 0.8, 0.1 + Math.random() * 0.07, 0, Math.floor(Math.random() * 10), 6, 1.1, (Math.random() - 0.5) * 14);
    }
  },
  /** A number floating up ("+10"). */
  text(x, y, str, color = '#fff', sz = 22) {
    const t = texts.find((e) => !e.on) ?? texts[0];
    t.on = true;
    t.x = x;
    t.y = y;
    t.vy = -1.3;
    t.t = 0;
    t.max = 1.1;
    t.str = str;
    t.color = color;
    t.size = sz;
  },
  /** A ring that spreads and fades (a landing, a pop). */
  ring(x, y, color = '#fff', r = 1.2) {
    if (calm) return;
    const e = rings.find((q) => !q.on) ?? rings[0];
    e.on = true;
    e.x = x;
    e.y = y;
    e.t = 0;
    e.max = 0.4;
    e.r = r;
    e.color = color;
  },

  /** Camera shake: add trauma (0 to 1) for big events only. */
  shake(amount) {
    if (calm) return;
    trauma = Math.min(1, trauma + amount);
  },
  /** The shake's offset in CSS pixels (smooth sine waves, never random jitter). */
  offset(maxPx) {
    const k = trauma * trauma * maxPx;
    shakeOut.x = Math.sin(clock * 47) * k + Math.sin(clock * 31 + 1) * k * 0.4;
    shakeOut.y = Math.cos(clock * 41) * k + Math.sin(clock * 27 + 2) * k * 0.4;
    return shakeOut;
  },

  update(dt) {
    clock += dt;
    trauma = Math.max(0, trauma - dt * 1.7);
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alive[i] = 0;
        count--;
        continue;
      }
      const k = Math.exp(-drag[i] * dt);
      pvx[i] *= k;
      pvy[i] = pvy[i] * k + grav[i] * dt;
      px[i] += pvx[i] * dt;
      py[i] += pvy[i] * dt;
      rot[i] += vrot[i] * dt;
    }
    for (const t of texts) {
      if (!t.on) continue;
      t.t += dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.2 * dt);
      if (t.t >= t.max) t.on = false;
    }
    for (const r of rings) {
      if (!r.on) continue;
      r.t += dt;
      if (r.t >= r.max) r.on = false;
    }
  },

  draw(ctx, view) {
    const s = view.s;
    for (const r of rings) {
      if (!r.on) continue;
      const p = r.t / r.max;
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(2, s * 0.1 * (1 - p));
      ctx.beginPath();
      ctx.arc(view.ox + r.x * s, view.oy + r.y * s, r.r * s * (0.3 + p * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) continue;
      const a = Math.min(1, (life[i] / maxLife[i]) * 2.2);
      const x = view.ox + px[i] * s;
      const y = view.oy + py[i] * s;
      const sz = size[i] * s;
      ctx.globalAlpha = a;
      ctx.fillStyle = PALETTE[col[i]];
      switch (kind[i]) {
        case 0:
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot[i]);
          // a spinning ribbon: its width flips with the spin
          ctx.fillRect(-sz, -sz * 0.5 * Math.abs(Math.cos(rot[i] * 1.7)) - 0.5, sz * 2, sz * Math.abs(Math.cos(rot[i] * 1.7)) + 1);
          ctx.restore();
          break;
        case 1:
          ctx.beginPath();
          ctx.arc(x, y, sz * (0.5 + 0.5 * (1 - a)), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 2:
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot[i]);
          starPath(ctx, 0, 0, sz * 1.2);
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
          break;
        default:
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(pvy[i], pvx[i]));
          ctx.fillRect(-sz * 1.6, -sz * 0.25, sz * 3.2, sz * 0.5);
          ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      if (!t.on) continue;
      const p = t.t / t.max;
      const pop = p < 0.15 ? 0.6 + (p / 0.15) * 0.7 : 1.3 - Math.min(0.3, (p - 0.15) * 1.2);
      outlined(ctx, t.str, view.ox + t.x * s, view.oy + t.y * s, t.size * pop, { fill: t.color, alpha: p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1 });
    }
  },
};

