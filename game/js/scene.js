// One frame of a race, layer by layer, and the camera that frames it.

import { drawChart } from './render/chart.js';
import { drawAir, drawBarbs } from './render/air.js';
import { drawBoat, drawShadow, drawTag, drawWakes, updateWakes } from './render/boats.js';
import { drawMarks, drawLaylines } from './render/marks.js';
import { drawBoatRing, drawClock, drawFog, drawMarkPointer, drawMiniChart, drawNotice, drawStandings, drawWindRose } from './render/hud.js';
import { updateCamera } from './render/view.js';
import { hudData, me, standingRows } from './session.js';
import { coneStrength } from './sim/shadow.js';
import { windAt, windSample } from './sim/wind.js';
import { timeToLineFor } from './hints.js';

const W = windSample();

export function makeSceneState() {
  return { zoomBias: 0, chartView: false, wakes: new Map(), lastT: 0, bars: [], barsAt: -1, rows: [], rowsAt: -1 };
}

/**
 * Points the camera: follow the player's boat, looking ahead; zoom to keep the next mark and the nearest rivals in
 * view (within limits); or the whole course while the chart view is held. Watching: follow the leader.
 */
export function aimCamera(view, sc, s, dt, input, reduced) {
  const cam = view.cam;
  const race = s.race;
  const b = me(s);
  if (input) {
    sc.zoomBias = Math.max(-2, Math.min(2, sc.zoomBias + input.zoom * 0.25));
    sc.chartView = input.chart;
  }
  const short = Math.max(1, Math.min(view.w, view.h));
  const long = Math.max(1, Math.max(view.w, view.h));
  const cb = race.course.bounds;
  if (sc.chartView || !b) {
    const subject = b ?? leaderOf(s);
    if (!b && subject) {
      cam.tx = subject.drawX;
      cam.ty = subject.drawY;
      cam.tzoom = clampZoom(short / 110, short);
    } else {
      cam.tx = (cb.x0 + cb.x1) / 2;
      cam.ty = (cb.y0 + cb.y1) / 2;
      cam.tzoom = Math.min(view.w / (cb.x1 - cb.x0 + 40), view.h / (cb.y1 - cb.y0 + 40));
    }
  } else {
    // Look a little ahead of the boat.
    const ahead = Math.min(14, b.v * 2.4);
    let tx = b.drawX + Math.cos(b.drawH) * ahead;
    let ty = b.drawY + Math.sin(b.drawH) * ahead;
    // Span what matters: the next mark when it is near, the closest rivals.
    let span = 70;
    if (view.w < 520) span = 58;
    const tg = race.course.targets[b.pi];
    if (tg && !b.finished) {
      const d = Math.hypot(tg.x - b.x, tg.y - b.y);
      if (d < 120) span = Math.max(span, d * 1.35 + 20);
    }
    let near = Infinity;
    for (const o of race.boats) {
      if (o === b || o.finished || o.retired) continue;
      near = Math.min(near, Math.hypot(o.drawX - b.drawX, o.drawY - b.drawY));
    }
    if (near < 40) span = Math.max(span, near * 1.5 + 14);
    if (race.t < race.gunT) {
      // Before the gun: the boat and the line both in view.
      const lx = Math.max(-race.course.halfLine, Math.min(race.course.halfLine, b.drawX));
      tx = (b.drawX + lx) / 2;
      ty = b.drawY / 2;
      span = Math.max(span, Math.min(140, Math.abs(b.drawY) * 1.5 + 30));
    }
    span = Math.min(170, span) * Math.pow(0.8, sc.zoomBias);
    cam.tx = tx;
    cam.ty = ty;
    // About 85 m across the long side of the screen by default (70 m on a square one).
    cam.tzoom = clampZoom(Math.min(long / (span * 1.2), short / (span * 0.8)), short);
  }
  updateCamera(cam, dt, reduced);
}

function clampZoom(z, short) {
  return Math.max(short / 260, Math.min(short / 36, z));
}

function leaderOf(s) {
  let best = null;
  for (const o of s.race.boats) if (!o.retired && (!best || o.pi > best.pi)) best = o;
  return best;
}

/**
 * Draws a frame. ui: { quality, reduced, touch, notice, now, bearing, chart, air, names, show: { rose, standings,
 * mini } }
 */
export function drawScene(view, sc, s, ui) {
  const race = s.race;
  const t = race.t;
  const b = me(s);
  const ctx = view.ctx;
  const dt = Math.min(0.1, Math.max(0, ui.now - sc.lastT));
  sc.lastT = ui.now;
  drawChart(view, ui.chart, ui.quality, ui.bearing);
  view.worldTransform();
  const streaks = ui.reduced ? 40 : ui.quality === 'low' ? 60 : ui.quality === 'medium' ? 110 : 170;
  drawAir(view, ui.air, race.wind, t, dt, streaks, ui.reduced);
  if (ui.quality !== 'low') drawBarbs(view, race.wind, t);
  // Shadows that matter to the player: cones touching them, and their own cone when it touches someone.
  if (b && !race.noShadows) {
    for (const o of race.boats) {
      if (o.finished || o.retired || o.ghost) continue;
      if (o === b) {
        const hits = race.boats.some((x) => x !== b && !x.finished && coneStrength(b.x, b.y, b.wx / (Math.hypot(b.wx, b.wy) || 1), b.wy / (Math.hypot(b.wx, b.wy) || 1), x.x, x.y) > 0.05);
        if (hits) drawShadow(view, o, false);
        continue;
      }
      const ms = Math.hypot(o.wx, o.wy) || 1;
      const st = coneStrength(o.x, o.y, o.wx / ms, o.wy / ms, b.x, b.y);
      if (st > 0.02) drawShadow(view, o, true);
    }
  }
  updateWakes(sc.wakes, race.boats, t, ui.reduced);
  drawWakes(view, sc.wakes, race.boats, t, ui.reduced);
  drawMarks(view, race.course, b ? b.pi : -1, ui.now, t - race.gunT, ui.reduced);
  // Laylines near the next mark.
  if (b && !b.finished && b.pi > 0) {
    windAt(race.wind, b.x, b.y, t, W);
    const h = hudData(s, t);
    drawLaylines(view, race.course.targets[b.pi], W, h.best.up, h.best.down, b);
  }
  // Boats, with the visibility of fog.
  const vis = race.wind.visibility;
  if (ui.extra) for (const g of ui.extra) drawBoat(view, g, ui.now);
  for (const o of race.boats) {
    if (o.hidden) continue;
    o.alpha = o.retired ? 0.35 : o.finished || o.parked ? 0.6 : o.ghost && o !== b ? 0.45 : 1;
    if (b && Number.isFinite(vis) && o !== b && Math.hypot(o.x - b.x, o.y - b.y) > vis) continue;
    o.foul = o.foulFlag > 0;
    drawBoat(view, o, ui.now);
  }
  // Fog over everything in the world.
  if (b && Number.isFinite(vis)) {
    view.screenTransform();
    drawFog(view, b, vis);
  }
  // Name tags (screen space).
  view.screenTransform();
  if (ui.names !== false && ui.hud !== false) {
    for (const o of race.boats) {
      if (o === b || o.alpha < 0.3 || o.hidden) continue;
      if (b && Number.isFinite(vis) && Math.hypot(o.x - b.x, o.y - b.y) > vis) continue;
      if (view.cam.zoom < 3.2) continue;
      drawTag(view, o, o.retired ? `${o.name} · retired` : o.name, false);
    }
  }
  if (ui.hud !== false) drawHud(view, sc, s, ui);
}

function drawHud(view, sc, s, ui) {
  const race = s.race;
  const b = me(s);
  const now = ui.now;
  view.screenTransform();
  const h = hudData(s, race.t);
  if (b && !b.finished && !sc.chartView) {
    h.lineIn = null;
    if (h.pre && h.gunIn < 25) h.lineIn = timeToLineFor(b, race);
    h.up = h.best.up;
    h.down = h.best.down;
    const tg = race.course.targets[b.pi];
    h.markColor = tg?.type === 'mark' ? (tg.side === 'port' ? '#C2412F' : '#B88A22') : '#1E2A33';
    drawBoatRing(view, b, h);
  }
  drawClock(view, h);
  drawNotice(view, ui.notice, now);
  if (ui.show?.standings !== false) {
    if (now - sc.rowsAt > 0.25) {
      sc.rows = standingRows(s);
      sc.rowsAt = now;
    }
    drawStandings(view, sc.rows, s.meId, view.w < 640);
  }
  if (b && h.wind && ui.show?.rose !== false) {
    if (now - sc.barsAt > 1) {
      sc.barsAt = now;
      sc.bars = forecastBars(race, b);
      sc.forecast = forecastShift(race, b);
    }
    const r = view.w < 420 ? 30 : 38;
    const y = ui.touch ? 64 + 54 + r + 6 : view.h - r - 64;
    drawWindRose(view, 16 + r, y, r, { bearing: ui.bearing, shift: h.wind.shift, forecast: sc.forecast ?? h.wind.shift, kn: h.wind.kn, gusting: h.wind.gusting, bars: sc.bars });
  }
  if (b && !b.finished) {
    const tg = race.course.targets[b.pi];
    if (tg && tg.type !== 'start') drawMarkPointer(view, tg, b, tg.name, ui.touch ? 150 : 0);
  }
  if (ui.show?.mini && !ui.touch && view.w > 900) drawMiniChart(view, view.w - 160, view.h - 160, 144, race.course, race.boats, s.meId, b ? b.pi : -1);
}

/** The wind at the boat over the next 30 s, relative to now (for the gust bars). */
function forecastBars(race, b) {
  const out = [];
  windAt(race.wind, b.x, b.y, race.t, W);
  const now = W.kn || 1;
  for (let k = 1; k <= 6; k++) {
    // Where the boat will roughly be, if it keeps sailing.
    const t = race.t + k * 5;
    const x = b.x + Math.cos(b.h) * b.v * k * 5;
    const y = b.y + Math.sin(b.h) * b.v * k * 5;
    windAt(race.wind, x, y, t, W);
    out.push(W.kn / now);
  }
  return out;
}

function forecastShift(race, b) {
  windAt(race.wind, b.x, b.y, race.t + 20, W);
  return W.shift;
}
