// The bots' brain. Pure: it reads the floor and the other dancers and says which way to push the stick (and whether to shove).
// The same movement code as the players runs the body (sim.js), so a bot is as fast as anybody and falls like anybody.
import { COLS, ROWS, TILES, tileDist } from './rules.js';
import { REACH } from './sim.js';

/** Knobs. Reaction times shrink as the steps go on; an "oops" is running at a wrong colour first. */
export const BOT = {
  reactMin: 0.25,
  reactMax: 0.7,
  lateScale: 0.6, // by step 13 the reactions are this fraction of the early ones
  oopsEarly: 0.1,
  oopsLate: 0.03, // by step 10
  distractMax: 0.5, // from step 4 a bot is sometimes looking elsewhere and reacts late: up to this share by step 12
  blunderMax: 0.4, // from step 4 a bot sometimes runs for a tile that isn't the nearest: up to this share by step 12
  wanderChance: 0.2,
  pushChance: 0.3,
};

export function newBrain(rng) {
  return {
    rng,
    skill: 0.86 + rng.next() * 0.14, // how hard this bot pushes the stick
    step: -1,
    mode: 0, // 0 waiting, 1 wandering, 2 heading for its tile, 3 oops: heading for a wrong one
    chosen: false,
    react: 0.4,
    ox: 0,
    oy: 0,
    tx: 0,
    ty: 0,
    wx: 0,
    wy: 0,
    wanderAt: 0,
    oopsUntil: 0,
    retargetAt: 0,
    stuck: 0,
    willPush: false,
  };
}

function goTo(c, ctx, tx, ty, scale, out, avoid) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.06) return d;
  let ux = dx / d;
  let uy = dy / d;
  if (avoid && d > 1.0) {
    let ax = 0;
    let ay = 0;
    for (let k = 0; k < ctx.n; k++) {
      const o = ctx.chars[k];
      if (o === c || o.st !== 0) continue;
      const rx = c.x - o.x;
      const ry = c.y - o.y;
      const rd = Math.hypot(rx, ry);
      if (rd < 1.0 && rd > 1e-4 && -(rx * ux + ry * uy) / rd > 0.2) {
        const w = 1.0 - rd;
        ax += (rx / rd) * w;
        ay += (ry / rd) * w;
      }
    }
    ux += ax * 1.4;
    uy += ay * 1.4;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l;
    uy /= l;
  }
  const speed = Math.min(1, d * 4.5) * scale;
  out.ix = ux * speed;
  out.iy = uy * speed;
  return d;
}

function pickTile(b, c, ctx, wrong, careless = false) {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < TILES; i++) {
    const isCall = ctx.colors[i] === ctx.call;
    if (wrong ? isCall : !isCall) continue;
    const d = tileDist(c.x, c.y, i);
    if (wrong && d > 3.5) continue;
    let claims = 0;
    for (let k = 0; k < ctx.n; k++) {
      const o = ctx.chars[k];
      if (o === c) continue;
      if (o.tgt === i) claims++;
      else if (o.st === 0 && tileDist(o.x, o.y, i) < 0.01) claims++;
    }
    const score = careless ? b.rng.next() * 10 : d + claims * 0.9;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return false;
  c.tgt = best;
  b.tx = (best % COLS) + 0.5 + b.ox;
  b.ty = Math.floor(best / COLS) + 0.5 + b.oy;
  return true;
}

function newStep(b, c, ctx) {
  const rng = b.rng;
  b.step = ctx.step;
  b.mode = 0;
  b.chosen = false;
  b.stuck = 0;
  b.retargetAt = 0;
  c.tgt = -1;
  const late = Math.min(1, Math.max(0, ctx.step - 1) / 12);
  b.react = (BOT.reactMin + rng.next() * (BOT.reactMax - BOT.reactMin)) * (1 - (1 - BOT.lateScale) * late);
  if (rng.chance(BOT.distractMax * Math.min(1, Math.max(0, ctx.step - 3) / 9))) b.react += 0.35 + rng.next() * 0.45;
  b.ox = (rng.next() - 0.5) * 0.4;
  b.oy = (rng.next() - 0.5) * 0.4;
  b.willPush = rng.chance(BOT.pushChance);
  if (rng.chance(BOT.wanderChance)) {
    b.mode = 1;
    b.wx = Math.min(COLS - 0.6, Math.max(0.6, c.x + (rng.next() - 0.5) * 3));
    b.wy = Math.min(ROWS - 0.6, Math.max(0.6, c.y + (rng.next() - 0.5) * 3));
  }
}

/** Fills `out` ({ ix, iy, push }) with what this bot does this step. `ctx`: { phase, step, now, ca, colors, call, chars, n }. */
export function think(b, c, ctx, out) {
  out.ix = 0;
  out.iy = 0;
  out.push = false;
  if (c.st !== 0) return;
  const rng = b.rng;
  if (ctx.phase === 'free') {
    // title and lobby: just dancing about
    if (ctx.now >= b.wanderAt || Math.hypot(b.wx - c.x, b.wy - c.y) < 0.2) {
      b.wanderAt = ctx.now + 1200 + rng.next() * 1600;
      b.wx = 0.8 + rng.next() * (COLS - 1.6);
      b.wy = 0.8 + rng.next() * (ROWS - 1.6);
    }
    goTo(c, ctx, b.wx, b.wy, 0.6 * b.skill, out, true);
    return;
  }
  if (ctx.phase === 'down') {
    c.tgt = -1;
    return;
  }
  if (b.step !== ctx.step) newStep(b, c, ctx);
  if (ctx.phase === 'pre' || !b.chosen) {
    if (ctx.phase === 'call') {
      if (ctx.now - ctx.ca < b.react * 1000) {
        if (b.mode === 1) goTo(c, ctx, b.wx, b.wy, 0.55, out, false);
        return;
      }
      b.chosen = true;
      const late = Math.min(1, Math.max(0, ctx.step - 1) / 9);
      const oops = BOT.oopsEarly + (BOT.oopsLate - BOT.oopsEarly) * late;
      if (rng.chance(oops) && pickTile(b, c, ctx, true)) {
        b.mode = 3;
        b.oopsUntil = ctx.now + 400;
      } else {
        b.mode = 2;
        const blunder = BOT.blunderMax * Math.min(1, Math.max(0, ctx.step - 3) / 9);
        pickTile(b, c, ctx, false, rng.chance(blunder));
      }
    } else {
      if (b.mode === 1) goTo(c, ctx, b.wx, b.wy, 0.5, out, false);
      return;
    }
  }
  if (b.mode === 3 && ctx.now >= b.oopsUntil) {
    b.mode = 2;
    pickTile(b, c, ctx, false);
  }
  if (c.tgt < 0) return;
  const d = goTo(c, ctx, b.tx, b.ty, b.skill, out, true);
  // stuck short of the tile (crowded, bumped): look again
  if (b.mode === 2) {
    if (d > 0.5 && Math.hypot(c.vx, c.vy) < 0.4) b.stuck += 1 / 60;
    else b.stuck = 0;
    if (b.stuck > 0.4 && ctx.now >= b.retargetAt) {
      b.retargetAt = ctx.now + 400;
      b.stuck = 0;
      pickTile(b, c, ctx, false);
    }
  }
  // a shove for whoever is standing on the tile this bot wants
  if (b.willPush && b.mode === 2 && c.cd <= 0 && c.pushT <= 0 && c.knockT <= 0) {
    for (let k = 0; k < ctx.n; k++) {
      const o = ctx.chars[k];
      if (o === c || o.st !== 0 || tileDist(o.x, o.y, c.tgt) > 0.01) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const od = Math.hypot(dx, dy);
      if (od > REACH - 0.08 || od < 1e-4) continue;
      out.ix = dx / od;
      out.iy = dy / od;
      out.push = true;
      b.willPush = false;
      break;
    }
  }
}
