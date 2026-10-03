// The chart under the race: paper, shallow-water washes, depth contours and soundings, islands in hatched ink with a
// sand fringe, shoals, tidal streams, a compass rose and the course boundary. Built once per race, drawn every frame
// (only what is in view).

import { PALETTE, FONT_SERIF } from './view.js';
import { hashf, rng } from '../sim/rng.js';

const CELL = 2.5; // metres per depth sample

/** Smooth value noise (deterministic): 0..1. */
function vnoise(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hashf(seed, xi, yi);
  const b = hashf(seed, xi + 1, yi);
  const c = hashf(seed, xi, yi + 1);
  const d = hashf(seed, xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Depth (m) at a point: open water from noise, shoaling toward islands and over shoals. Negative is land. */
function depthAt(course, seed, x, y) {
  let d = 13 + 14 * (vnoise(seed, x / 130, y / 130) - 0.5) + 6 * (vnoise(seed + 7, x / 48, y / 48) - 0.5);
  for (const il of course.islands) {
    const dist = Math.hypot(x - il.x, y - il.y) - il.sr * 1.05;
    if (dist < 0) d = Math.min(d, dist * 0.5 - 0.5);
    else d -= 22 * Math.exp(-dist / 20);
  }
  for (const s of course.shoals) {
    const dx = x - s.x;
    const dy = y - s.y;
    const lx = (dx * s.c + dy * s.s) / s.rx;
    const ly = (-dx * s.s + dy * s.c) / s.ry;
    const e = Math.sqrt(lx * lx + ly * ly);
    d -= 15 * Math.exp(-((Math.max(0, e - 0.7) / 1.1) ** 2));
  }
  return d;
}

/** Builds the chart for a race: the depth grid, the wash texture, contours, soundings and labels. */
export function buildChart(race) {
  const c = race.course;
  const seed = (race.seed ^ (c.id * 2654435761)) >>> 0;
  const m = 150;
  const x0 = c.bounds.x0 - m;
  const y0 = c.bounds.y0 - m;
  const x1 = c.bounds.x1 + m;
  const y1 = c.bounds.y1 + m;
  const nx = Math.ceil((x1 - x0) / CELL) + 1;
  const ny = Math.ceil((y1 - y0) / CELL) + 1;
  const depth = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) depth[j * nx + i] = depthAt(c, seed, x0 + i * CELL, y0 + j * CELL);
  const chart = { x0, y0, x1, y1, nx, ny, depth, seed, course: c, wash: null, contours: [], soundings: [], tiles: new Map() };
  chart.wash = makeWash(chart);
  chart.contours = makeContours(chart, [2, 5, 10, 15, 20]);
  chart.soundings = makeSoundings(chart);
  chart.hatch = null;
  return chart;
}

/** The washes: shallows in teal (deeper means paler), a faint cool tint on all water. 1 texel = CELL metres. */
function makeWash(chart) {
  const { nx, ny, depth } = chart;
  let cv;
  try {
    cv = document.createElement('canvas');
  } catch {
    return null;
  }
  cv.width = nx;
  cv.height = ny;
  const g = cv.getContext('2d');
  const img = g.createImageData(nx, ny);
  const teal = [0x79, 0xa9, 0xa3];
  const slate = [0x4e, 0x6e, 0x7c];
  const alpha = new Float32Array(nx * ny);
  const mix = new Float32Array(nx * ny); // 0 teal .. 1 slate
  for (let k = 0; k < nx * ny; k++) {
    const d = depth[k];
    if (d < -0.5) continue; // land: drawn as ink and hatching on top
    // Ribbons of wash just inside each depth contour, as a chart-maker's brush lays them; shallows filled in.
    let rib = 0;
    for (const L of [5, 10, 15, 20]) rib = Math.max(rib, Math.exp(-(((d - (L - 1.6)) / 1.6) ** 2)) * (L <= 10 ? 1 : 0.7));
    const shallow = 1 / (1 + Math.exp((d - 4) * 1.4));
    const deep = 1 / (1 + Math.exp(-(d - 19) * 0.6));
    alpha[k] = Math.max(0.08 + 0.22 * rib, 0.34 * shallow, 0.2 * deep) * Math.min(1, (d + 0.5) * 2);
    mix[k] = deep;
  }
  // One soft pass, so texel edges never show.
  const blur = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          sum += alpha[jj * nx + ii];
          n++;
        }
      }
      blur[j * nx + i] = sum / n;
    }
  }
  for (let k = 0; k < nx * ny; k++) {
    const m = mix[k];
    img.data[k * 4] = teal[0] + (slate[0] - teal[0]) * m;
    img.data[k * 4 + 1] = teal[1] + (slate[1] - teal[1]) * m;
    img.data[k * 4 + 2] = teal[2] + (slate[2] - teal[2]) * m;
    img.data[k * 4 + 3] = Math.round(blur[k] * 255);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Marching squares over the depth grid: line segments per level, bucketed in 64 m tiles for culling. */
function makeContours(chart, levels) {
  const { nx, ny, depth, x0, y0 } = chart;
  const out = [];
  const jitter = (x, y) => (hashf(chart.seed, Math.round(x * 4), Math.round(y * 4)) - 0.5) * 0.5;
  for (const lv of levels) {
    const tiles = new Map();
    const add = (ax, ay, bx, by) => {
      const key = `${Math.floor(ax / 64)},${Math.floor(ay / 64)}`;
      let arr = tiles.get(key);
      if (!arr) tiles.set(key, (arr = []));
      arr.push(ax + jitter(ax, ay), ay + jitter(ay, ax), bx + jitter(bx, by), by + jitter(by, bx));
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = depth[j * nx + i];
        const b = depth[j * nx + i + 1];
        const c = depth[(j + 1) * nx + i + 1];
        const d = depth[(j + 1) * nx + i];
        const code = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const X = x0 + i * CELL;
        const Y = y0 + j * CELL;
        const top = [X + CELL * ((lv - a) / (b - a)), Y];
        const right = [X + CELL, Y + CELL * ((lv - b) / (c - b))];
        const bottom = [X + CELL * ((lv - d) / (c - d)), Y + CELL];
        const left = [X, Y + CELL * ((lv - a) / (d - a))];
        const seg = (p, q) => add(p[0], p[1], q[0], q[1]);
        switch (code) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    }
    out.push({ level: lv, tiles });
  }
  return out;
}

/** Soundings: depths printed on a jittered grid, as on a chart. */
function makeSoundings(chart) {
  const r = rng(chart.seed ^ 0x51ab);
  const list = [];
  for (let y = chart.y0 + 20; y < chart.y1 - 20; y += 34) {
    for (let x = chart.x0 + 20; x < chart.x1 - 20; x += 34) {
      const px = x + r.range(-12, 12);
      const py = y + r.range(-12, 12);
      const d = sampleDepth(chart, px, py);
      if (d < 0.8) continue;
      list.push({ x: px, y: py, text: String(Math.max(1, Math.round(d))) });
    }
  }
  return list;
}

/** Bilinear depth from the grid (outside it: open water). */
export function sampleDepth(chart, x, y) {
  const fx = (x - chart.x0) / CELL;
  const fy = (y - chart.y0) / CELL;
  if (fx < 0 || fy < 0 || fx >= chart.nx - 1 || fy >= chart.ny - 1) return 18;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const n = chart.nx;
  const d = chart.depth;
  return (d[j * n + i] * (1 - u) + d[j * n + i + 1] * u) * (1 - v) + (d[(j + 1) * n + i] * (1 - u) + d[(j + 1) * n + i + 1] * u) * v;
}

/** A small hatch tile for land (diagonal ink lines), made once. */
let hatchTile = null;
function getHatch(ctx) {
  if (hatchTile) return hatchTile;
  try {
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 16;
    const g = cv.getContext('2d');
    g.strokeStyle = 'rgba(30,42,51,0.22)';
    g.lineWidth = 1.1;
    g.beginPath();
    for (let k = -16; k <= 32; k += 6) {
      g.moveTo(k, 16);
      g.lineTo(k + 16, 0);
    }
    g.stroke();
    hatchTile = ctx.createPattern(cv, 'repeat');
  } catch {
    hatchTile = null;
  }
  return hatchTile;
}

/** Paper grain: a speckle tile, drawn in screen space and slid with the camera. */
let grainTile = null;
function getGrain(ctx) {
  if (grainTile) return grainTile;
  try {
    const cv = document.createElement('canvas');
    cv.width = 192;
    cv.height = 192;
    const g = cv.getContext('2d');
    const img = g.createImageData(192, 192);
    const r = rng(77);
    for (let k = 0; k < 192 * 192; k++) {
      const v = r.next();
      const dark = v < 0.5;
      const a = Math.pow(Math.abs(v - 0.5) * 2, 3) * 26;
      img.data[k * 4] = dark ? 60 : 255;
      img.data[k * 4 + 1] = dark ? 50 : 250;
      img.data[k * 4 + 2] = dark ? 35 : 240;
      img.data[k * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    grainTile = ctx.createPattern(cv, 'repeat');
  } catch {
    grainTile = null;
  }
  return grainTile;
}

/**
 * Draws the chart in world space. `q` is the quality ('low' | 'medium' | 'high'); `fog` washes out what is beyond
 * visibility (drawn later by the caller).
 */
export function drawChart(view, chart, q, compassBearing = 0) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const B = view.bounds(10);
  // Paper (screen space) with grain sliding with the world.
  view.screenTransform();
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, view.w, view.h);
  const off = (typeof location !== 'undefined' && location.search) || '';
  if (q !== 'low' && !off.includes('nograin')) {
    const grain = getGrain(ctx);
    if (grain && grain.setTransform) {
      const ox = (-view.cam.x * z) % 192;
      const oy = (-view.cam.y * z) % 192;
      try {
        grain.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
      } catch {}
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }
  view.worldTransform();
  // Washes: the texture scaled up smooth reads as ink washed onto the paper.
  if (chart.wash && !off.includes('nowash')) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(chart.wash, chart.x0 - CELL / 2, chart.y0 - CELL / 2, chart.nx * CELL, chart.ny * CELL);
  }
  // Outside the course: a faint shade, and the boundary as a dashed line with ticks.
  const cb = chart.course.bounds;
  ctx.fillStyle = 'rgba(78,110,124,0.05)';
  ctx.beginPath();
  ctx.rect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
  ctx.rect(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(30,42,51,0.45)';
  ctx.lineWidth = 1.2 / z;
  ctx.setLineDash([6 / z, 5 / z]);
  ctx.strokeRect(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
  ctx.setLineDash([]);
  if (z > 2) {
    ctx.beginPath();
    for (let x = Math.ceil(cb.x0 / 20) * 20; x <= cb.x1; x += 20) {
      if (x < B.x0 || x > B.x1) continue;
      ctx.moveTo(x, cb.y0);
      ctx.lineTo(x, cb.y0 - 2);
      ctx.moveTo(x, cb.y1);
      ctx.lineTo(x, cb.y1 + 2);
    }
    for (let y = Math.ceil(cb.y0 / 20) * 20; y <= cb.y1; y += 20) {
      if (y < B.y0 || y > B.y1) continue;
      ctx.moveTo(cb.x0, y);
      ctx.lineTo(cb.x0 - 2, y);
      ctx.moveTo(cb.x1, y);
      ctx.lineTo(cb.x1 + 2, y);
    }
    ctx.stroke();
  }
  // Depth contours: thin slate lines, the 5 m line heavier.
  if (q !== 'low' || z < 6) {
    for (const ct of chart.contours) {
      ctx.strokeStyle = ct.level <= 5 ? 'rgba(78,110,124,0.55)' : 'rgba(78,110,124,0.32)';
      ctx.lineWidth = (ct.level === 5 ? 1.3 : 0.9) / z;
      if (ct.level === 20) ctx.setLineDash([3 / z, 3 / z]);
      ctx.beginPath();
      const tx0 = Math.floor(B.x0 / 64);
      const tx1 = Math.floor(B.x1 / 64);
      const ty0 = Math.floor(B.y0 / 64);
      const ty1 = Math.floor(B.y1 / 64);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const segs = ct.tiles.get(`${tx},${ty}`);
          if (!segs) continue;
          for (let k = 0; k < segs.length; k += 4) {
            ctx.moveTo(segs[k], segs[k + 1]);
            ctx.lineTo(segs[k + 2], segs[k + 3]);
          }
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Soundings, when they can be read.
  if (z > 3.2 && q !== 'low') {
    const px = Math.min(13, Math.max(9, z * 1.25));
    ctx.save();
    view.screenTransform();
    ctx.font = `italic 400 ${px}px ${FONT_SERIF}`;
    ctx.fillStyle = 'rgba(78,110,124,0.62)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const p = { x: 0, y: 0 };
    for (const s of chart.soundings) {
      if (s.x < B.x0 || s.x > B.x1 || s.y < B.y0 || s.y > B.y1) continue;
      view.toScreen(s.x, s.y, p);
      ctx.fillText(s.text, p.x, p.y);
    }
    ctx.restore();
  }
  drawShoals(view, chart, q);
  drawIslands(view, chart, q);
  drawCurrents(view, chart);
  drawCompass(view, chart, compassBearing);
}

function drawIslands(view, chart, q) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const B = view.bounds(40);
  for (const il of chart.course.islands) {
    if (il.x + il.rr < B.x0 || il.x - il.rr > B.x1 || il.y + il.rr < B.y0 || il.y - il.rr > B.y1) continue;
    const path = () => {
      ctx.beginPath();
      il.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    // Sand fringe, then the land, hatched, then the inked coast.
    path();
    ctx.strokeStyle = PALETTE.sand;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.fillStyle = '#E9DDBF';
    ctx.fill();
    const hatch = q !== 'low' ? getHatch(ctx) : null;
    if (hatch) {
      ctx.save();
      path();
      ctx.clip();
      try {
        hatch.setTransform(new DOMMatrix([1 / z, 0, 0, 1 / z, 0, 0]));
      } catch {}
      ctx.fillStyle = hatch;
      ctx.fillRect(il.x - il.rr - 4, il.y - il.rr - 4, il.rr * 2 + 8, il.rr * 2 + 8);
      ctx.restore();
    }
    // Stipple just inside the coast.
    if (q === 'high' && z > 2.5) {
      ctx.fillStyle = 'rgba(30,42,51,0.35)';
      const r = rng(il.seed * 31);
      for (let k = 0; k < il.poly.length; k++) {
        const [ax, ay] = il.poly[k];
        const [bx, by] = il.poly[(k + 1) % il.poly.length];
        for (let n = 0; n < 4; n++) {
          const t = r.next();
          const px = ax + (bx - ax) * t + (il.x - ax) * 0.06 * r.next();
          const py = ay + (by - ay) * t + (il.y - ay) * 0.06 * r.next();
          ctx.fillRect(px, py, 0.35, 0.35);
        }
      }
    }
    path();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.5 / z;
    ctx.stroke();
    // A hill: a small cluster of hachures at the centre.
    ctx.strokeStyle = 'rgba(30,42,51,0.5)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const hr = il.sr * 0.28;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      ctx.moveTo(il.x + Math.cos(a) * hr, il.y + Math.sin(a) * hr * 0.8);
      ctx.lineTo(il.x + Math.cos(a) * hr * 1.6, il.y + Math.sin(a) * hr * 1.3);
    }
    ctx.stroke();
  }
}

function drawShoals(view, chart, q) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  for (const s of chart.course.shoals) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230,207,160,0.55)';
    ctx.fill();
    ctx.setLineDash([1.5 / z, 3 / z]);
    ctx.strokeStyle = 'rgba(30,42,51,0.7)';
    ctx.lineWidth = 1.4 / z;
    ctx.stroke();
    ctx.setLineDash([]);
    if (q !== 'low') {
      ctx.fillStyle = 'rgba(30,42,51,0.45)';
      const r = rng(Math.round(s.x * 13 + s.y * 7));
      const n = Math.round(s.rx * s.ry * 0.5);
      for (let k = 0; k < n; k++) {
        const a = r.next() * Math.PI * 2;
        const rr = Math.sqrt(r.next()) * 0.9;
        ctx.fillRect(Math.cos(a) * s.rx * rr, Math.sin(a) * s.ry * rr, 0.3, 0.3);
      }
    }
    ctx.restore();
    if (z > 2.5) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1 / z, 1 / z);
      ctx.font = `italic 400 12px ${FONT_SERIF}`;
      ctx.fillStyle = 'rgba(30,42,51,0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Sh', 0, 0);
      ctx.restore();
    }
  }
}

/** Tidal streams: a fletched arrow and its rate in knots. */
function drawCurrents(view, chart) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  for (const c of chart.course.currents) {
    const vx = c.vx * c.c - c.vy * c.s;
    const vy = c.vx * c.s + c.vy * c.c;
    const sp = Math.hypot(vx, vy);
    if (sp < 0.05) continue;
    const ux = vx / sp;
    const uy = vy / sp;
    const len = 26;
    // A faint band for the stream's extent.
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = 'rgba(78,110,124,0.06)';
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(78,110,124,0.85)';
    ctx.fillStyle = 'rgba(78,110,124,0.85)';
    ctx.lineWidth = 1.6 / z;
    for (const off of [-1, 1]) {
      const ox = c.x - uy * off * 14;
      const oy = c.y + ux * off * 14;
      ctx.beginPath();
      ctx.moveTo(ox - ux * len / 2, oy - uy * len / 2);
      ctx.lineTo(ox + ux * len / 2, oy + uy * len / 2);
      ctx.stroke();
      // Head.
      const hx = ox + ux * len / 2;
      const hy = oy + uy * len / 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - ux * 4 - uy * 2, hy - uy * 4 + ux * 2);
      ctx.lineTo(hx - ux * 4 + uy * 2, hy - uy * 4 - ux * 2);
      ctx.closePath();
      ctx.fill();
      // Fletching.
      for (let k = 0; k < 3; k++) {
        const fx = ox - ux * (len / 2 - k * 2);
        const fy = oy - uy * (len / 2 - k * 2);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx - ux * 2 - uy * 2, fy - uy * 2 + ux * 2);
        ctx.stroke();
      }
    }
    if (z > 1.8) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1 / z, 1 / z);
      ctx.font = `italic 500 13px ${FONT_SERIF}`;
      ctx.fillStyle = PALETTE.slate;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${(sp / 0.514).toFixed(1)} kn`, 0, 0);
      ctx.restore();
    }
  }
}

/** A compass rose at the corner of the course; north turned to the race's bearing. */
function drawCompass(view, chart, bearing) {
  const ctx = view.ctx;
  const z = view.cam.zoom;
  const cb = chart.course.bounds;
  const cx = cb.x0 + 34;
  const cy = cb.y1 - 34;
  const B = view.bounds(40);
  if (cx < B.x0 || cx > B.x1 || cy < B.y0 || cy > B.y1) return;
  const R = 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(30,42,51,0.55)';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.moveTo(R * 0.82, 0);
  ctx.arc(0, 0, R * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  // Degree ticks, every 10, longer every 30.
  ctx.rotate((-bearing * Math.PI) / 180);
  ctx.beginPath();
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180 - Math.PI / 2;
    const r0 = d % 30 === 0 ? R * 0.72 : R * 0.82;
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  ctx.stroke();
  // The star: north filled red, the rest ink.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 - Math.PI / 2;
    const l = R * 0.7;
    const w = R * 0.12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * l, Math.sin(a) * l);
    ctx.lineTo(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fillStyle = k === 0 ? PALETTE.red : 'rgba(30,42,51,0.75)';
    ctx.fill();
  }
  if (z > 1.5) {
    ctx.scale(1 / z, 1 / z);
    ctx.font = `600 ${Math.round(Math.min(16, R * z * 0.38))}px ${FONT_SERIF}`;
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -R * z * 1.18);
  }
  ctx.restore();
}
