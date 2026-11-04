// Store art. With `?poster=<name>` the page skips the room and draws ONE staged, frozen, deterministic frame with the game's own
// renderer, then sets `document.body.dataset.ready = '1'` for whoever captures it. No platform needed.
//   cover (1280x720), action (1280x720), win (1280x720), icon (512x512), badge-<id> (256x256)
import { COLS, PLAYER_COLORS, ROWS, TILES, makeFloor } from './rules.js';
import { View, drawActor, drawBackdrop, drawFloor, drawSpeakers } from './draw.js';
import { drawCrown, drawLogo } from './ui.js';
import { fx } from './fx.js';
import { makeRng } from './rng.js';
import { INK, outlined, roundRect, starPath } from './theme.js';

function sizeOf(name) {
  if (name === 'icon') return [512, 512];
  if (name.startsWith('badge-')) return [256, 256];
  return [1280, 720];
}

/** A dancer for the art: a bot face (there are no avatars without the platform). */
function dancer(x, y, i, o = {}) {
  return {
    id: `p${i}`, name: '', x, y, vx: 0, vy: 0, ang: Math.PI / 2, ps: false, kn: false, gh: false, st: 0, ft: 0, age: 9,
    color: PLAYER_COLORS[i % 12], bot: true, me: false, av: null, seed: 20 + i * 37, hop: 0, you: -1, noTag: true, ...o,
  };
}

const center = (i) => ({ x: (i % COLS) + 0.5, y: Math.floor(i / COLS) + 0.5 });

/** A floor in which this colour is called (the first seed that makes it so). */
function floorFor(call, step = 4) {
  for (let seed = 1; seed < 500; seed++) {
    const f = makeFloor(seed, step, 8);
    if (f.call === call) return f;
  }
  return makeFloor(1, step, 8);
}

function drawAll(ctx, view, actors, t) {
  actors.sort((p, q) => p.y - q.y);
  for (const a of actors) drawActor(ctx, view, a, t);
}

// ---------------------------------------------------------------- the pictures
function cover(ctx, view, w, h) {
  const t = 2.4;
  const s = 64;
  view.place(s, (w - COLS * s) / 2, h - ROWS * s - 22);
  drawBackdrop(ctx, view, t, 0.5);
  drawSpeakers(ctx, view, 0.7);
  const f = floorFor(3, 4); // BLUE, with only the blue tiles staying and the rest falling
  drawFloor(ctx, view, { kind: 'match', t, beat: 0, popT: 99, colors: f.colors, call: 3, dropT: 0.27, warn: 0 });
  const blue = [];
  const other = [];
  for (let i = 0; i < TILES; i++) (f.stand[i] ? blue : other).push(i);
  const actors = [];
  [0.1, 0.45, 0.8].forEach((k, n) => {
    const c = center(blue[Math.floor(k * (blue.length - 1))]);
    actors.push(dancer(c.x, c.y + 0.1, n, { hop: 0.7 }));
  });
  [[2, 0.18], [3, 0.55], [4, 0.9]].forEach(([n, k]) => {
    const target = center(blue[Math.floor(k * (blue.length - 1))]);
    const ang = n % 2 ? -0.5 : 0.7;
    const x = target.x - Math.cos(ang) * 1.6;
    const y = Math.min(7.4, Math.max(0.6, target.y - Math.sin(ang) * 1.6));
    actors.push(dancer(x, y, n + 1, { vx: Math.cos(ang) * 4.4, vy: Math.sin(ang) * 4.4, ang }));
  });
  const fall = center(other[Math.floor(other.length * 0.42)]);
  actors.push(dancer(fall.x, fall.y, 7, { st: 1, ft: 0.34, seed: 111 }));
  fx.puff(fall.x, fall.y, 16);
  fx.confetti(6, -0.8, 34, 12);
  fx.update(0.45);
  drawAll(ctx, view, actors, t);
  fx.draw(ctx, view);
  drawLogo(ctx, 'COLOR BLOCK PARTY', w / 2, 92, 108, t, 0);
}

function action(ctx, view, w, h) {
  const t = 1.7;
  const s = 190;
  view.place(s, w / 2 - 6.5 * s, h / 2 - 3.3 * s);
  drawBackdrop(ctx, view, t, 0.4);
  const colors = new Uint8Array(TILES);
  const pal = [0, 1, 2, 4, 5];
  for (let i = 0; i < TILES; i++) colors[i] = pal[((i % COLS) * 2 + Math.floor(i / COLS) * 3 + ((i % COLS) >> 1)) % 5];
  for (const [c, r] of [[5, 3], [6, 3], [7, 3], [6, 4], [6, 2]]) colors[r * COLS + c] = 3;
  drawFloor(ctx, view, { kind: 'match', t, beat: 0, popT: 99, colors, call: 3, dropT: 0.3, warn: 0 });
  const pusher = dancer(6.55, 3.62, 0, { ang: 0, ps: true, vx: 1.5, seed: 64 });
  const pushed = dancer(7.75, 3.5, 1, { ang: Math.PI, kn: true, vx: 4.5, seed: 91 });
  fx.stars(7.3, 3.1, 9);
  fx.sparks(7.2, 3.3, 8);
  fx.puff(8.6, 3.9, 8);
  fx.update(0.1);
  drawAll(ctx, view, [pusher, pushed], t);
  fx.draw(ctx, view);
}

function win(ctx, view, w, h) {
  const t = 3.2;
  const s = 66;
  view.place(s, (w - COLS * s) / 2, h - ROWS * s - 24);
  drawBackdrop(ctx, view, t, 0.4);
  drawSpeakers(ctx, view, 0.5);
  drawFloor(ctx, view, { kind: 'party', t, beat: 0.4, popT: 99 });
  // a crowd cheering on the floor
  const crowd = [[1.4, 5.9], [2.6, 6.8], [9.6, 6.7], [10.6, 5.8], [0.9, 3.4], [11.1, 3.5]].map(([x, y], i) => dancer(x, y, i + 3, { hop: 1, seed: 200 + i * 29 }));
  drawAll(ctx, view, crowd, t);
  // the podium
  const cx = w / 2;
  const base = h - 70;
  const bw = 210;
  const spec = [
    { place: 1, x: cx, h: 210, fill: '#ffd23f', dark: '#b8860b', who: 0 },
    { place: 2, x: cx - bw - 14, h: 150, fill: '#cfd8e6', dark: '#7d8aa0', who: 1 },
    { place: 3, x: cx + bw + 14, h: 108, fill: '#e29a5b', dark: '#965a2a', who: 2 },
  ];
  const stars = [];
  for (const b of spec) {
    const top = base - b.h;
    roundRect(ctx, b.x - bw / 2, top + 8, bw, b.h, 12);
    ctx.fillStyle = b.dark;
    ctx.fill();
    roundRect(ctx, b.x - bw / 2, top, bw, b.h - 8, 12);
    ctx.fillStyle = b.fill;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    outlined(ctx, String(b.place), b.x, top + (b.h - 8) * 0.5, Math.min(b.h * 0.6, 120), { width: 0.2 });
    const pv = new View();
    pv.resize(w, h, 1);
    pv.place(150, b.x, top);
    stars.push({ a: dancer(0, 0, b.who + 8, { hop: b.place === 1 ? 1 : 0.35, seed: 30 + b.who * 50 }), pv, b });
  }
  for (const e of stars) drawActor(ctx, e.pv, e.a, t + e.b.place * 0.13);
  const first = stars[0];
  drawCrown(ctx, cx, base - 210 - 150 * 1.62 - Math.abs(Math.sin((t + first.b.place * 0.13) * 8 + first.a.seed)) * 0.4 * 150, 75);
  fx.burst(6, 5.5, 46);
  fx.confetti(6, -1, 90, 13);
  fx.update(0.85);
  fx.draw(ctx, view);
}

function icon(ctx, view, w) {
  const t = 1.2;
  const s = 150;
  view.noBall = true;
  view.place(s, w / 2 - 6.5 * s, 330 - 3.5 * s);
  drawBackdrop(ctx, view, t, 0);
  const colors = new Uint8Array(TILES);
  const pal = [1, 2, 3, 4, 5];
  for (let i = 0; i < TILES; i++) colors[i] = pal[((i % COLS) + Math.floor(i / COLS) * 2) % 5];
  colors[3 * COLS + 6] = 0; // the one tile that stays: red, with the heart
  drawFloor(ctx, view, { kind: 'match', t, beat: 0, popT: 99, colors, call: 0, dropT: 0.3, warn: 0, noFrame: true });
  fx.puff(6.5, 3.5, 6);
  fx.update(0.1);
  drawAll(ctx, view, [dancer(6.5, 3.5, 1, { hop: 0.5, seed: 35 })], t);
  fx.draw(ctx, view);
}

const BADGES = {
  'first-win': { fill: '#ffb400', draw: (ctx) => drawCrown(ctx, 128, 134, 150) },
  survivor: {
    fill: '#2f8cff',
    draw(ctx) {
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(128, 56);
      ctx.lineTo(192, 80);
      ctx.lineTo(192, 134);
      ctx.quadraticCurveTo(192, 186, 128, 208);
      ctx.quadraticCurveTo(64, 186, 64, 134);
      ctx.lineTo(64, 80);
      ctx.closePath();
      ctx.fillStyle = '#eef4ff';
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      starPath(ctx, 128, 130, 40);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.stroke();
    },
  },
  untouchable: {
    fill: '#2fd46b',
    draw(ctx) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(74, 196);
      ctx.bezierCurveTo(54, 120, 104, 66, 196, 56);
      ctx.bezierCurveTo(206, 128, 164, 196, 74, 196);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(60, 214);
      ctx.lineTo(186, 70);
      ctx.stroke();
      ctx.lineWidth = 5;
      for (const [x0, y0, x1, y1] of [[98, 168, 128, 176], [120, 140, 156, 150], [142, 112, 178, 120], [88, 150, 100, 124], [112, 122, 126, 96]]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    },
  },
  'party-animal': {
    fill: '#ff5fa2',
    draw(ctx) {
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(128, 52);
      ctx.lineTo(192, 204);
      ctx.lineTo(64, 204);
      ctx.closePath();
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#2f8cff';
      for (const y of [96, 144, 192]) {
        ctx.beginPath();
        ctx.moveTo(40, y + 16);
        ctx.lineTo(216, y - 24);
        ctx.lineTo(216, y - 4);
        ctx.lineTo(40, y + 36);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(128, 52);
      ctx.lineTo(192, 204);
      ctx.lineTo(64, 204);
      ctx.closePath();
      ctx.lineWidth = 9;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(128, 50, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 5;
      for (const [x, y, c] of [[60, 70, '#ffd23f'], [200, 100, '#2fd46b'], [52, 140, '#2f8cff'], [204, 168, '#ffffff'], [90, 40, '#ffffff']]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    },
  },
};

function badge(ctx, w, h, id) {
  const spec = BADGES[id] ?? BADGES['first-win'];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2 + 5, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = spec.fill;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 106, 0, Math.PI * 2);
  ctx.stroke();
  spec.draw(ctx);
}

/** Sizes the canvas to the poster, draws it, and flags it done. */
export async function drawPoster(canvas, name) {
  const [w, h] = sizeOf(name);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.style.margin = '0';
  try {
    await document.fonts.load('40px "Lilita One"');
    await document.fonts.ready;
  } catch {
    // no web font: the fallback face draws instead
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const view = new View();
  view.resize(w, h, 1);
  const real = Math.random;
  Math.random = makeRng(0xc0ffee).next; // particles are random: make them the same every time
  try {
    fx.setLevel('high', false);
    fx.reset();
    if (name.startsWith('badge-')) badge(ctx, w, h, name.slice(6));
    else if (name === 'icon') icon(ctx, view, w);
    else if (name === 'action') action(ctx, view, w, h);
    else if (name === 'win') win(ctx, view, w, h);
    else cover(ctx, view, w, h);
  } finally {
    Math.random = real;
  }
  document.body.dataset.ready = '1';
}
