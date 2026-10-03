// Store art, drawn by the game itself: `?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>` renders a finished,
// deterministic scene with the real renderer, no SDK and no network, then sets window.__posterReady.

import { makeView, PALETTE, LIVERIES, FONT_SERIF } from './render/view.js';
import { buildChart } from './render/chart.js';
import { makeAir } from './render/air.js';
import { drawBoat, updateWakes, drawWakes, shapePath } from './render/boats.js';
import { makeSession, advance } from './session.js';
import { makeSceneState, drawScene, recordTracks } from './scene.js';
import { botEntries } from './sim/skippers.js';
import { mulberry32 } from './sim/rng.js';
import { makeRace } from './sim/race.js';
import { readWind } from './sim/boat.js';
import { windAt, windSample } from './sim/wind.js';
import { drawFog } from './render/hud.js';

const DEG = Math.PI / 180;

async function fonts() {
  try {
    await Promise.race([Promise.all([document.fonts.load("600 40px 'Spectral'"), document.fonts.load("italic 500 16px 'Spectral'"), document.fonts.load("500 16px 'Plex Mono'")]), new Promise((r) => setTimeout(r, 2500))]);
  } catch {}
}

/** Runs a race to time `t`, keeping the last seconds of wakes, then frames and draws it. */
function raceScene(view, o) {
  const s = makeSession(o.race);
  if (o.prepare) o.prepare(s);
  const sc = makeSceneState();
  const t0 = o.t - 2.6;
  if (o.plot) {
    // Second by second, plotting each boat's track.
    for (let t = 0; t < t0; t += 1) {
      advance(s, t, null, 1e7);
      recordTracks(sc, s.race);
    }
  }
  advance(s, Math.max(0, t0), null, 1e7);
  // The last few seconds frame by frame, so wakes have their trails.
  for (let t = Math.max(0, t0); t <= o.t; t += 1 / 30) {
    advance(s, t, null, 4);
    updateWakes(sc.wakes, s.race.boats, s.race.t, false);
  }
  s.events.length = 0;
  const chart = buildChart(s.race);
  const cam = view.cam;
  const c = o.camera(s);
  cam.x = cam.tx = c.x;
  cam.y = cam.ty = c.y;
  cam.zoom = cam.tzoom = c.zoom;
  const air = makeAir(mulberry32(o.race.seed + 5));
  // Let the streaks spread out before the picture.
  for (let k = 0; k < 40; k++) {
    sc.lastT = s.race.t - 1 / 30;
    drawScene(view, sc, s, { quality: 'high', reduced: false, touch: false, notice: null, now: s.race.t, bearing: o.bearing ?? 220, chart, air, hud: false, names: false, cones: o.cones ?? 1, plot: o.plot ? 'all' : false });
  }
  if (o.after) o.after(view, s);
}

const SCENES = {
  // The cover: the fleet at the windward mark, a gust darkening the water, shadows hatched behind the boats ahead.
  thumb1: (view) => cover(view),
  // The start: ten boats on the line a breath before the gun, the committee boat flying its flag.
  thumb2: (view) =>
    raceScene(view, {
      race: { seed: 21, courseId: 1, laps: 2, weather: 'fresh', rules: 'racing', entries: botEntries(21, 10, [3, 3, 3, 2, 2, 2, 3, 2, 3, 2]), meId: null, preStart: 60, looks: liveryLooks(10) },
      t: 58.4,
      cones: 0,
      camera: (s) => ({ x: s.race.course.halfLine * 0.3, y: 11, zoom: 17.5 }),
    }),
  // A coastal course in fog: an island and the fleet loom out of the grey.
  thumb3: (view) =>
    raceScene(view, {
      race: { seed: 42, courseId: 3, laps: 1, weather: 'fog', rules: 'racing', entries: botEntries(42, 7, [3, 2, 3, 2, 3, 2, 3]), meId: null, preStart: 60, looks: liveryLooks(7) },
      t: 132.5,
      cones: 0,
      camera: (s) => {
        const f = fogFocus(s);
        return { x: f.x - 9, y: f.y - 7, zoom: 14 };
      },
      // The fog as a sailor in the fleet sees it: clear around the boat, grey beyond what can be seen.
      after: (view, s) => {
        view.screenTransform();
        const eye = fogFocus(s);
        drawFog(view, eye, s.race.wind.visibility, s.race.t);
        view.worldTransform();
        drawBoat(view, eye, s.race.t);
      },
    }),
  // The beat as plotted: every boat's tacks up to the windward mark, inked in its sail's colour (the results view).
  thumb4: (view) =>
    raceScene(view, {
      race: { seed: 51, courseId: 1, laps: 2, weather: 'shifty', rules: 'racing', entries: botEntries(51, 8, [3, 3, 2, 2, 3, 2, 3, 2]), meId: null, preStart: 60, looks: liveryLooks(8) },
      t: 184,
      plot: true,
      cones: 0,
      camera: (s) => {
        const W = s.race.course.targets[1];
        return { x: W.x - 6, y: W.y + 36, zoom: 8.4 };
      },
    }),
  // The liveries, burgees and wake styles side by side (not store art).
  parade: (view) => parade(view),
  // A test sheet: every class at every point of sail (not store art).
  boats: (view) => sheet(view),
  icon: (view) => icon(view),
};

const W0 = windSample();

/**
 * The cover, arranged by hand on the real race: boats are set where a good picture wants them (metres from the windward
 * mark, east and south) and everything else (wind, shadows, sails, wakes, the washes) is the game's own drawing.
 */
function cover(view) {
  const seed = 38;
  const t = 168;
  const entries = botEntries(seed, 8, [3, 3, 2, 3, 2, 3, 2, 3]);
  const race = makeRace({ seed, courseId: 1, laps: 2, weather: 'moderate', rules: 'racing', entries, preStart: 60 });
  const M = race.course.targets[1];
  race.t = t;
  // x, y from the mark; h degrees; v m/s; w turn rate (deg/s, negative turns to port); the sail, eased or trimmed.
  const plan = [
    { x: -5.2, y: 3.6, h: 163, v: 4.9, w: -34, hiking: false, heel: 0.35, livery: 0, pattern: 'band', num: 21 }, // rounding now, bearing away
    { x: 6.8, y: 6.6, h: -137, v: 3.7, w: 0, hiking: true, heel: 0.6, livery: 1, pattern: 'plain', num: 14 }, // close-hauled, to the mark
    { x: 9.2, y: 16.8, h: -137, v: 2.5, w: 0, hiking: true, heel: 0.5, livery: 2, pattern: 'stripes', num: 17 }, // in the shadow of the boat above
    { x: 3.2, y: 8.8, h: -150, v: 4.1, w: -12, hiking: true, heel: 0.45, livery: 3, pattern: 'chevron', num: 23 }, // just short of the rounding
    { x: -15.5, y: 10.5, h: 102, v: 5.4, w: 0, hiking: false, heel: 0.25, livery: 4, pattern: 'plain', num: 26 }, // running down, past the mark
    { x: -7.6, y: 15.8, h: 118, v: 3.9, w: 0, hiking: false, heel: 0.25, livery: 8, pattern: 'dot', num: 29 }, // under the leader's lee
    { x: 17.6, y: 4.2, h: -137, v: 3.8, w: 0, hiking: true, heel: 0.55, livery: 5, pattern: 'plain', num: 32 }, // clear air, further out
    { x: 24.5, y: 12.5, h: -137, v: 3.6, w: 0, hiking: true, heel: 0.5, livery: 7, pattern: 'band', num: 35 }, // and one more, hardening up
  ];
  const sc = makeSceneState();
  const place = (b, p, back = 0) => {
    // Back along the path (the wake's history): the same speed and turn, run in reverse.
    let x = M.x + p.x;
    let y = M.y + p.y;
    let h = p.h * DEG;
    for (let k = 0; k < back; k++) {
      h -= p.w * DEG * 0.12;
      x -= Math.cos(h) * p.v * 0.12;
      y -= Math.sin(h) * p.v * 0.12;
    }
    b.x = b.drawX = b.px = x;
    b.y = b.drawY = b.py = y;
    b.h = b.drawH = b.ph = h;
  };
  const boats = race.boats;
  boats.forEach((b, i) => {
    const p = plan[i];
    b.livery = p.livery;
    b.pattern = p.pattern;
    b.num = p.num;
    b.v = p.v;
    b.hiking = p.hiking;
    b.heel = p.heel;
    b.alpha = 1;
    b.flag = i === 0 ? 'pennant' : 'none';
  });
  // The wake: every 0.12 s along the path, oldest first.
  for (let k = 22; k >= 0; k--) {
    boats.forEach((b, i) => place(b, plan[i], k));
    updateWakes(sc.wakes, boats, t - k * 0.12, false);
  }
  boats.forEach((b, i) => {
    const p = plan[i];
    place(b, p, 0);
    windAt(race.wind, b.x, b.y, t, W0);
    b.wx = W0.vx;
    b.wy = W0.vy;
    b.wkn = W0.kn;
    readWind(b, W0.vx, W0.vy);
    // Sails: eased when the wind is aft of the beam, flogging nowhere.
    b.luff = 0;
  });
  const chart = buildChart(race);
  const cam = view.cam;
  cam.x = cam.tx = M.x + 5.4;
  cam.y = cam.ty = M.y + 5.4;
  cam.zoom = cam.tzoom = 23;
  const air = makeAir(mulberry32(seed + 5));
  for (let k = 0; k < 40; k++) {
    sc.lastT = t - 1 / 30;
    drawScene(view, sc, { race, meId: null }, { quality: 'high', reduced: false, touch: false, notice: null, now: t, bearing: 220, chart, air, hud: false, names: false, cones: 4, streaks: 130 });
  }
}

/** The boat nearest the middle of the fleet in the channel (the fog scene's eye). */
function fogFocus(s) {
  const near = s.race.boats.filter((b) => Math.hypot(b.x + 51, b.y + 78) < 70);
  const cx = near.reduce((a, b) => a + b.x, 0) / Math.max(1, near.length);
  const cy = near.reduce((a, b) => a + b.y, 0) / Math.max(1, near.length);
  let best = s.race.boats[0];
  for (const b of near) if (Math.hypot(b.x - cx, b.y - cy) < Math.hypot(best.x - cx, best.y - cy)) best = b;
  return best;
}

function liveryLooks(n) {
  const out = {};
  for (let i = 0; i < n; i++) out[`bot${i + 1}`] = { livery: i % 10, num: 11 + i * 3, pattern: ['plain', 'band', 'stripes', 'plain', 'chevron', 'dot', 'plain', 'leech', 'plain', 'star'][i % 10] };
  return out;
}

/** Ten boats in echelon on a beam reach, each in its own colour, close enough to read. */
function parade(view) {
  const race = makeRace({ seed: 909, courseId: 3, laps: 1, weather: 'moderate', entries: [] });
  const chart = buildChart(race);
  const cam = view.cam;
  cam.x = cam.tx = -95;
  cam.y = cam.ty = -40;
  cam.zoom = cam.tzoom = 15;
  const sc = makeSceneState();
  const boats = [];
  const pats = ['plain', 'band', 'stripes', 'chevron', 'dot', 'leech', 'split', 'star', 'band', 'plain'];
  for (let i = 0; i < 10; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const x = -136 + col * 18 + row * 9;
    const y = -60 + row * 16 + col * 3.5;
    boats.push({ id: `p${i}`, drawX: x, drawY: y, drawH: -8 * DEG, x, y, h: -8 * DEG, v: 4.2, twa: 82 + (i % 3) * 4, side: -1, luff: 0, hiking: i % 3 === 0, heel: 0.4, cls: ['dinghy', 'skiff', 'dinghy', 'catboat', 'dinghy', 'cat', 'dinghy', 'skiff', 'dinghy', 'dinghy'][i], livery: i, pattern: pats[i], num: 7 + i * 4, alpha: 1, flag: ['none', 'pennant', 'swallow', 'chequer', 'cross', 'gold'][i % 6], wake: ['foam', 'ribbon', 'pearls', 'twin'][i % 4] });
  }
  // Wakes from a short run-up.
  for (let k = 30; k >= 0; k--) {
    for (const b of boats) {
      b.drawX = b.x - Math.cos(b.h) * b.v * (k / 15);
      b.drawY = b.y - Math.sin(b.h) * b.v * (k / 15);
    }
    updateWakes(sc.wakes, boats, 10 - k / 15, false);
  }
  for (const b of boats) {
    b.drawX = b.x;
    b.drawY = b.y;
  }
  const fakeSession = { race, meId: null };
  const air = makeAir(mulberry32(77));
  for (let k = 0; k < 30; k++) {
    sc.lastT = 9.9;
    drawScene(view, sc, fakeSession, { quality: 'high', reduced: false, touch: false, notice: null, now: 10, bearing: 205, chart, air, hud: false, names: false });
  }
  view.worldTransform();
  drawWakes(view, sc.wakes, boats, 10, false);
  for (const b of boats) drawBoat(view, b, 10.3 + b.livery);
}

function sheet(view) {
  const race = makeRace({ seed: 5, courseId: 7, laps: 1, weather: 'moderate', entries: [] });
  const chart = buildChart(race);
  const cam = view.cam;
  cam.x = cam.tx = 0;
  cam.y = cam.ty = 20;
  cam.zoom = cam.tzoom = 22;
  const sc = makeSceneState();
  drawScene(view, sc, { race, meId: null }, { quality: 'high', reduced: false, touch: false, notice: null, now: 0.1, bearing: 200, chart, air: makeAir(mulberry32(1)), hud: false, names: false });
  view.worldTransform();
  const classes = ['dinghy', 'skiff', 'catboat', 'cat'];
  const twas = [30, 47, 70, 95, 130, 160];
  classes.forEach((cls, r) => {
    twas.forEach((twa, k) => {
      const h = -Math.PI / 2 - twa * DEG;
      const b = { id: `s${r}${k}`, drawX: -22 + k * 9, drawY: 6 + r * 9, drawH: h, twa, side: 1, luff: twa < 32 ? 0.9 : 0, hiking: k % 2 === 0, heel: 0.4, cls, livery: (r * 6 + k) % 10, pattern: ['plain', 'band', 'stripes', 'chevron', 'dot', 'star'][k], num: 10 + k, alpha: 1, v: 3 };
      drawBoat(view, b, 1 + k);
    });
  });
}

/** The icon: one coral sail, close-hauled and hiking, crossing the chart's depth contours on cream water. */
function icon(view) {
  const ctx = view.ctx;
  const S = view.w;
  const race = makeRace({ seed: 5, courseId: 7, laps: 1, weather: 'moderate', entries: [] });
  const chart = buildChart(race);
  const cam = view.cam;
  const h = -50 * DEG;
  const b = { id: 'i', drawX: 0, drawY: 30, drawH: h, x: 0, y: 30, h, v: 3.6, twa: 48, side: -1, luff: 0, hiking: true, heel: 0.55, cls: 'dinghy', livery: 0, pattern: 'plain', alpha: 1, deckMark: false };
  // Centre on what the eye sees: the hull and the sail swung out to leeward.
  const bx = -0.2;
  const by = 0.75;
  cam.x = cam.tx = b.drawX + Math.cos(h) * bx - Math.sin(h) * by;
  cam.y = cam.ty = b.drawY + Math.sin(h) * bx + Math.cos(h) * by;
  cam.zoom = cam.tzoom = S / 6.6;
  drawScene(view, makeSceneState(), { race, meId: null }, { quality: 'high', reduced: true, touch: false, notice: null, now: 0.1, bearing: 200, chart, air: makeAir(mulberry32(3)), hud: false, names: false, streaks: 0 });
  // Cream water, a shade of teal deepening toward the lower right, over the paper's grain.
  view.screenTransform();
  ctx.fillStyle = 'rgba(239,230,210,0.78)';
  ctx.fillRect(0, 0, S, view.h);
  const g = ctx.createLinearGradient(0, 0, S, view.h);
  g.addColorStop(0, 'rgba(246,240,226,0.3)');
  g.addColorStop(0.6, 'rgba(121,169,163,0.06)');
  g.addColorStop(1, 'rgba(78,110,124,0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, view.h);
  // Depth contours sweeping across, as on the chart.
  ctx.strokeStyle = PALETTE.slate;
  ctx.lineWidth = Math.max(1, S / 340);
  ctx.globalAlpha = 0.42;
  for (let k = 0; k < 4; k++) {
    const y0 = S * (0.02 + k * 0.3);
    ctx.beginPath();
    ctx.moveTo(-8, y0 + S * 0.24);
    ctx.bezierCurveTo(S * 0.32, y0 - S * 0.02, S * 0.62, y0 + S * 0.28, S + 8, y0 + S * 0.02);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // The wake from a short run, then the boat.
  const wake = new Map();
  for (let k = 30; k >= 0; k--) {
    b.drawX = -Math.cos(h) * 3.6 * (k / 12);
    b.drawY = 30 - Math.sin(h) * 3.6 * (k / 12);
    updateWakes(wake, [b], 5 - k / 12, false);
  }
  b.drawX = 0;
  b.drawY = 30;
  view.worldTransform();
  drawWakes(view, wake, [b], 5, false);
  drawBoat(view, b, 5.3);
}

// ------------------------------------------------------------------------------------------------ badges

/** A badge: an inked chart roundel (a compass ring of ticks) with a symbol drawn in the game's colours. */
function badge(view, id) {
  const ctx = view.ctx;
  const w = view.w;
  view.screenTransform();
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, w, w);
  const c = w / 2;
  const R = w * 0.42;
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.paperLight;
  ctx.fill();
  ctx.lineWidth = w * 0.022;
  ctx.strokeStyle = PALETTE.ink;
  ctx.stroke();
  ctx.lineWidth = w * 0.006;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let d = 0; d < 360; d += 10) {
    const a = d * DEG;
    const r0 = d % 90 === 0 ? R * 0.86 : d % 30 === 0 ? R * 0.9 : R * 0.93;
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = R / 100; // symbol units: a circle of radius ~80
  ctx.scale(s, s);
  const ink = PALETTE.ink;
  const red = PALETTE.red;
  const must = PALETTE.mustard;
  const teal = PALETTE.teal;
  const slate = PALETTE.slate;
  const line = (wdt, col) => {
    ctx.lineWidth = wdt;
    ctx.strokeStyle = col;
  };
  // A boat in the badges' own weight: a bold hull and a filled sail (the ghost is dashed and pale).
  const sailBoat = (x, y, h, col, scale = 1, ghost = false) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h);
    ctx.scale(scale * 9, scale * 9);
    if (ghost) ctx.setLineDash([0.55, 0.4]);
    ctx.beginPath();
    ctx.moveTo(2.3, 0);
    ctx.quadraticCurveTo(1.25, -0.98, -0.35, -0.93);
    ctx.lineTo(-2.2, -0.72);
    ctx.lineTo(-2.2, 0.72);
    ctx.lineTo(-0.35, 0.93);
    ctx.quadraticCurveTo(1.25, 0.98, 2.3, 0);
    ctx.closePath();
    ctx.fillStyle = ghost ? 'rgba(246,240,226,0.6)' : PALETTE.paperLight;
    ctx.fill();
    ctx.lineWidth = 0.5 / scale;
    ctx.strokeStyle = ghost ? slate : ink;
    ctx.stroke();
    // The sail as the game draws it: mast, boom end to leeward, the head swung across.
    ctx.beginPath();
    ctx.moveTo(0.8, 0);
    ctx.lineTo(-1.95, -1.25);
    ctx.lineTo(-0.15, -1.95);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 0.42 / scale;
    ctx.stroke();
    ctx.restore();
  };
  switch (id) {
    case 'first-race': {
      // A buoy with its flag.
      line(7, ink);
      ctx.beginPath();
      ctx.moveTo(0, 26);
      ctx.lineTo(0, -46);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.quadraticCurveTo(22, -50, 38, -40);
      ctx.lineTo(36, -18);
      ctx.quadraticCurveTo(20, -26, 0, -22);
      ctx.closePath();
      ctx.fillStyle = red;
      ctx.fill();
      line(5, ink);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 38, 22, 0, Math.PI * 2);
      ctx.fillStyle = must;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'clean-tack': {
      // A zigzag of tacks up the page, clean corners.
      line(9, ink);
      ctx.beginPath();
      ctx.moveTo(-34, 56);
      ctx.lineTo(24, 18);
      ctx.lineTo(-24, -20);
      ctx.lineTo(18, -54);
      ctx.stroke();
      for (const [x, y] of [[24, 18], [-24, -20]]) {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = red;
        ctx.fill();
      }
      sailBoat(16, -50, -60 * DEG, red, 1.15);
      break;
    }
    case 'wind-thief': {
      // A boat and its hatched cone falling across three small hulls.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-10, -44);
      ctx.lineTo(-58, 60);
      ctx.lineTo(38, 60);
      ctx.closePath();
      ctx.fillStyle = 'rgba(30,42,51,0.12)';
      ctx.fill();
      ctx.clip();
      line(3, 'rgba(30,42,51,0.55)');
      ctx.beginPath();
      for (let k = -70; k < 70; k += 8) {
        ctx.moveTo(k, 60);
        ctx.lineTo(k + 40, -44);
      }
      ctx.stroke();
      ctx.restore();
      sailBoat(-10, -44, -100 * DEG, red, 1.2);
      for (const [x, y] of [[-30, 36], [12, 22]]) sailBoat(x, y, -110 * DEG, teal, 0.85);
      break;
    }
    case 'photo-finish': {
      // The chequered flag on its staff.
      line(7, ink);
      ctx.beginPath();
      ctx.moveTo(-34, 62);
      ctx.lineTo(-34, -56);
      ctx.stroke();
      const sq = 16;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? ink : PALETTE.paperLight;
        ctx.fillRect(-34 + i * sq, -56 + j * sq + Math.sin(i * 0.9) * 3, sq, sq);
      }
      line(4, ink);
      ctx.strokeRect(-34, -56, sq * 5, sq * 4);
      break;
    }
    case 'perfect-start': {
      // The committee's horn and a clock hand at zero.
      line(8, ink);
      ctx.beginPath();
      ctx.arc(0, 8, 50, 0, Math.PI * 2);
      ctx.stroke();
      line(9, red);
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(0, -34);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 8, 7, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.font = `600 22px ${FONT_SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillText('0:00', 0, 42);
      break;
    }
    case 'no-fouls': {
      // A clean white pennant on a mast, no red.
      line(7, ink);
      ctx.beginPath();
      ctx.moveTo(-26, 62);
      ctx.lineTo(-26, -58);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-26, -58);
      ctx.lineTo(48, -30);
      ctx.lineTo(-26, -4);
      ctx.closePath();
      ctx.fillStyle = PALETTE.paper;
      ctx.fill();
      line(5, ink);
      ctx.stroke();
      line(6, '#2F6B4F');
      ctx.beginPath();
      ctx.moveTo(-8, -32);
      ctx.lineTo(2, -22);
      ctx.lineTo(22, -42);
      ctx.stroke();
      break;
    }
    case 'gust-rider': {
      // A dark ripple field and a boat riding it.
      line(4, slate);
      for (let k = 0; k < 26; k++) {
        const a = k * 2.399;
        const r = 12 + (k * 37) % 58;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.8 + 8;
        ctx.beginPath();
        ctx.moveTo(x - 7, y);
        ctx.quadraticCurveTo(x, y + 5, x + 7, y);
        ctx.stroke();
      }
      sailBoat(2, -4, -150 * DEG, must, 1.45);
      break;
    }
    case 'ghost-buster': {
      // Your boat a length ahead of its dashed ghost.
      sailBoat(-20, 28, -60 * DEG, 'rgba(201,198,189,0.7)', 1.3, true);
      sailBoat(20, -26, -60 * DEG, red, 1.3);
      break;
    }
    case 'par-excellence': {
      // A gold medal on its ribbon.
      ctx.fillStyle = red;
      ctx.beginPath();
      ctx.moveTo(-30, -66);
      ctx.lineTo(-8, -66);
      ctx.lineTo(10, -14);
      ctx.lineTo(-12, -14);
      ctx.fill();
      ctx.fillStyle = slate;
      ctx.beginPath();
      ctx.moveTo(30, -66);
      ctx.lineTo(8, -66);
      ctx.lineTo(-10, -14);
      ctx.lineTo(12, -14);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 22, 40, 0, Math.PI * 2);
      ctx.fillStyle = must;
      ctx.fill();
      line(6, ink);
      ctx.stroke();
      ctx.beginPath();
      shapePath(ctx, 'star', 22);
      ctx.save();
      ctx.translate(0, 22);
      shapePath(ctx, 'star', 22);
      ctx.fillStyle = PALETTE.paperLight;
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'cup-winner': {
      // A cup.
      ctx.beginPath();
      ctx.moveTo(-36, -50);
      ctx.lineTo(36, -50);
      ctx.quadraticCurveTo(34, 10, 0, 18);
      ctx.quadraticCurveTo(-34, 10, -36, -50);
      ctx.closePath();
      ctx.fillStyle = must;
      ctx.fill();
      line(6, ink);
      ctx.stroke();
      for (const s2 of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s2 * 40, -30, 14, s2 > 0 ? -Math.PI / 2 : Math.PI / 2, s2 > 0 ? Math.PI / 2 : -Math.PI / 2, s2 < 0);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(0, 44);
      ctx.moveTo(-26, 50);
      ctx.lineTo(26, 50);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillRect(-28, 48, 56, 12);
      break;
    }
    case 'every-weather': {
      // A compass star with sun, cloud and fog bars around it.
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 60, Math.sin(a) * 60);
        ctx.lineTo(Math.cos(a + Math.PI / 2) * 10, Math.sin(a + Math.PI / 2) * 10);
        ctx.lineTo(Math.cos(a - Math.PI / 2) * 10, Math.sin(a - Math.PI / 2) * 10);
        ctx.closePath();
        ctx.fillStyle = k === 0 ? red : ink;
        ctx.fill();
      }
      line(5, must);
      ctx.beginPath();
      ctx.arc(-44, -44, 12, 0, Math.PI * 2);
      ctx.stroke();
      line(5, slate);
      ctx.beginPath();
      ctx.moveTo(30, 40);
      ctx.lineTo(60, 40);
      ctx.moveTo(26, 52);
      ctx.lineTo(56, 52);
      ctx.stroke();
      line(5, teal);
      ctx.beginPath();
      ctx.moveTo(30, -50);
      ctx.quadraticCurveTo(40, -40, 50, -50);
      ctx.quadraticCurveTo(60, -60, 64, -48);
      ctx.stroke();
      break;
    }
    case 'captain': {
      // A ship's wheel.
      line(8, ink);
      ctx.beginPath();
      ctx.arc(0, 0, 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fillStyle = must;
      ctx.fill();
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.lineTo(Math.cos(a) * 64, Math.sin(a) * 64);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 66, Math.sin(a) * 66, 6, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
      }
      break;
    }
    default:
  }
  ctx.restore();
}

/** Draws the requested poster into the page and marks it ready. */
export async function runPoster(kind) {
  await fonts();
  const canvas = document.getElementById('chart');
  const view = makeView(canvas, () => Math.min(2, window.devicePixelRatio || 1));
  view.resize();
  try {
    if (kind.startsWith('badge-')) badge(view, kind.slice(6));
    else (SCENES[kind] ?? SCENES.thumb1)(view);
  } finally {
    window.__posterReady = true;
  }
}

export const POSTERS = ['thumb1', 'thumb2', 'thumb3', 'thumb4', 'icon'];
