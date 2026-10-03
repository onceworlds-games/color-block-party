// One frame of a race, layer by layer, and the camera that frames it.

import { drawChart } from './render/chart.js';
import { drawAir, drawBarbs } from './render/air.js';
import { drawBoat, drawShadow, drawTag, drawWakes, updateWakes } from './render/boats.js';
import { drawMarks, drawLaylines } from './render/marks.js';
import { drawBoatRing, drawClock, drawFog, drawMarkPointer, drawMiniChart, drawNotice, drawStamp, drawStandings, drawWindRose } from './render/hud.js';
import { updateCamera, PALETTE, LIVERIES } from './render/view.js';
import { hudData, me, standingRows } from './session.js';
import { coneStrength } from './sim/shadow.js';
import { windAt, windSample } from './sim/wind.js';
import { timeToLineFor } from './hints.js';

const W = windSample();
const TAGP = { x: 0, y: 0 };

export function makeSceneState() {
  return { zoomBias: 0, chartView: false, wakes: new Map(), lastT: 0, bars: [], barsAt: -1, rows: [], rowsAt: -1, tracks: new Map(), trackT: -Infinity, plotAt: -1 };
}

const TRACK_DT = 1; // seconds of race time between plotted points
const TRACK_MAX = 1800; // points per boat

/** Each boat's path from the gun, a point a second: the race as plotted (chart view and the results). */
export function recordTracks(sc, race) {
  if (race.t < race.gunT || race.t < sc.trackT + TRACK_DT) return;
  sc.trackT = race.t;
  for (const b of race.boats) {
    if (b.hidden || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    let tr = sc.tracks.get(b.id);
    if (!tr) sc.tracks.set(b.id, (tr = { pts: [], done: false, livery: 0 }));
    tr.livery = b.livery ?? 0;
    if (tr.done || tr.pts.length >= TRACK_MAX * 2) continue;
    tr.pts.push(b.x, b.y);
    if (b.finished || b.retired) tr.done = true;
  }
}

/** What the plotted race covers (the tracks and the marks), for framing the results; the course's bounds before any. */
export function plotBounds(sc, race) {
  if (sc.boundsAt === sc.trackT && sc.bounds) return sc.bounds;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const tr of sc.tracks.values()) for (let i = 0; i < tr.pts.length; i += 2) add(tr.pts[i], tr.pts[i + 1]);
  if (!Number.isFinite(x0)) return race.course.bounds;
  for (const tg of race.course.targets) add(tg.x, tg.y);
  sc.boundsAt = sc.trackT;
  sc.bounds = { x0: x0 - 12, y0: y0 - 18, x1: x1 + 12, y1: y1 + 12 };
  return sc.bounds;
}

/** The plotted tracks in each sail's colour, inked in over a couple of seconds when the results open. */
function drawTracks(view, sc, meId, reveal) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  let longest = 0;
  for (const tr of sc.tracks.values()) longest = Math.max(longest, tr.pts.length / 2);
  const upto = Math.ceil(longest * reveal);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [id, tr] of sc.tracks) {
    const n = Math.min(tr.pts.length / 2, upto);
    if (n < 2) continue;
    const mine = id === meId;
    const color = (LIVERIES[tr.livery] ?? LIVERIES[0]).color;
    ctx.beginPath();
    ctx.moveTo(tr.pts[0], tr.pts[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(tr.pts[2 * i], tr.pts[2 * i + 1]);
    // A dark under-stroke keeps every colour (the pale ones above all) legible on the washes.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#0E2A3A';
    ctx.lineWidth = (mine ? 5.4 : 4) / z;
    ctx.stroke();
    ctx.globalAlpha = mine ? 1 : 0.92;
    ctx.strokeStyle = color;
    ctx.lineWidth = (mine ? 2.8 : 2) / z;
    ctx.stroke();
    if (reveal < 1 && n < tr.pts.length / 2) {
      ctx.beginPath();
      ctx.arc(tr.pts[2 * n - 2], tr.pts[2 * n - 1], 3.2 / z, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  ctx.restore();
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
  const streaks = ui.streaks ?? (ui.reduced ? 26 : ui.quality === 'low' ? 40 : ui.quality === 'medium' ? 70 : 100);
  drawAir(view, ui.air, race.wind, t, dt, streaks, ui.reduced);
  if (ui.quality !== 'low') drawBarbs(view, race.wind, t);
  // The race as plotted: with the results (inked in), or while the chart view is held.
  recordTracks(sc, race);
  if (ui.plot) {
    if (sc.plotAt < 0) sc.plotAt = ui.now;
    drawTracks(view, sc, s.meId, ui.reduced || ui.plot === 'all' ? 1 : Math.min(1, (ui.now - sc.plotAt) / 2.4));
  } else {
    sc.plotAt = -1;
    if (sc.chartView) drawTracks(view, sc, s.meId, 1);
  }
  // Every shadow that falls on a boat (store art and watching), or those that matter to the player.
  if (ui.cones && b === null && !race.noShadows) {
    // Store art and watching: only the strongest shadows (ui.cones of them), so they explain rather than clutter.
    const list = [];
    for (const o of race.boats) {
      if (o.finished || o.retired || o.ghost) continue;
      const ms = Math.hypot(o.wx, o.wy) || 1;
      let st = 0;
      for (const x of race.boats) if (x !== o) st = Math.max(st, coneStrength(o.x, o.y, o.wx / ms, o.wy / ms, x.x, x.y));
      if (st > 0.14) list.push([st, o]);
    }
    list.sort((p, q) => q[0] - p[0]);
    for (const [st, o] of list.slice(0, typeof ui.cones === 'number' ? ui.cones : 3)) drawShadow(view, o, st > 0.22);
  } else if (b && !race.noShadows) {
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
  drawMarks(view, race.course, b ? b.pi : -1, ui.now, t - race.gunT, ui.reduced, !!(b && b.ocs));
  // Laylines near the next mark.
  if (b && !b.finished && b.pi > 0) {
    windAt(race.wind, b.x, b.y, t, W);
    const h = hudData(s, t);
    drawLaylines(view, race.course.targets[b.pi], W, h.best.up, h.best.down, b);
  }
  // Boats, with the visibility of fog.
  const vis = race.wind.visibility;
  const fog = b && Number.isFinite(vis);
  if (ui.extra) for (const g of ui.extra) drawBoat(view, g, ui.now);
  for (const o of race.boats) {
    if (o.hidden) continue;
    o.alpha = o.retired ? 0.35 : o.finished || o.parked ? 0.6 : o.ghost && o !== b ? 0.45 : 1;
    if (fog && o !== b && Math.hypot(o.x - b.x, o.y - b.y) > vis) continue;
    o.foul = o.foulFlag > 0;
    if (!(fog && o === b)) drawBoat(view, o, ui.now);
  }
  // Fog over the world, with the player's own boat clear above it.
  if (fog) {
    view.screenTransform();
    drawFog(view, b, vis, t);
    view.worldTransform();
    if (!b.hidden) drawBoat(view, b, ui.now);
  }
  // Name tags (screen space).
  view.screenTransform();
  if (ui.names !== false && ui.hud !== false) {
    for (const o of race.boats) {
      if (o === b || o.alpha < 0.3 || o.hidden) continue;
      if (b && Number.isFinite(vis) && Math.hypot(o.x - b.x, o.y - b.y) > vis) continue;
      if (view.cam.zoom < 3.2) continue;
      // Names stay out from under the platform's buttons, the clock and the standings.
      view.toScreen(o.drawX, o.drawY, TAGP);
      const ty = TAGP.y - Math.max(18, view.cam.zoom * 3.4);
      if ((TAGP.x < 190 && ty < 124) || (TAGP.x > view.w - 230 && ty < 150) || (Math.abs(TAGP.x - view.w / 2) < 90 && ty < 70)) continue;
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
    h.lift = ui.lift ?? null;
    h.dirty = b.shadow < 0.88 ? Math.round((1 - b.shadow) * 100) : 0;
    drawBoatRing(view, b, h);
  }
  // Narrow screens: the clock sits between the platform's buttons (top left) and the standings (top right), and
  // notices drop below both.
  const narrow = view.w < 480;
  const clockX = narrow ? (148 + (view.w - 126 - 6 - 6)) / 2 : view.w / 2;
  drawClock(view, h, clockX);
  if (ui.stamp) drawStamp(view, ui.stamp, now);
  drawNotice(view, ui.notice, now, narrow ? 148 : 90);
  if (ui.show?.standings !== false) {
    if (now - sc.rowsAt > 0.25) {
      sc.rows = standingRows(s);
      sc.rowsAt = now;
    }
    drawStandings(view, sc.rows, s.meId, view.w < 640, narrow);
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
