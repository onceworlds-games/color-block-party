// Tack: boot, the frame loop and the screens. (First slice: a local race against rival skippers.)

import { platform } from './platform.js';
import { makeView } from './render/view.js';
import { buildChart } from './render/chart.js';
import { makeAir } from './render/air.js';
import { makeSession, advance, me } from './session.js';
import { makeSceneState, aimCamera, drawScene } from './scene.js';
import { initInput, readInput } from './input.js';
import { makeNotices, eventNotice, currentNotice } from './hints.js';
import { botEntries, makeBrain } from './sim/skippers.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('chart');
const view = makeView(canvas, () => platform.pixelRatio());
view.resize();
addEventListener('resize', () => view.resize());
initInput(canvas);

async function fontsReady(ms = 1500) {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load("500 16px 'Spectral'"),
        document.fonts.load("italic 500 16px 'Spectral'"),
        document.fonts.load("500 16px 'Plex Mono'"),
      ]),
      new Promise((r) => setTimeout(r, ms)),
    ]);
  } catch {}
}

function newLocalRace() {
  const seed = Number(params.get('seed') ?? 11);
  const courseId = Number(params.get('course') ?? 1);
  const weather = params.get('weather') ?? 'moderate';
  const entries = [{ id: 'me', name: 'You', cls: 'dinghy' }, ...botEntries(seed, Number(params.get('bots') ?? 7), [1, 2, 3, 2, 1, 0, 3, 2, 1])];
  const s = makeSession({ seed, courseId, laps: 2, weather, rules: 'racing', entries, meId: 'me', preStart: Number(params.get('pre') ?? 60), looks: { me: { livery: 0, num: 7 } } });
  if (params.has('auto')) {
    const b = me(s);
    b.bot = { skill: 3, persona: 'textbook', brain: makeBrain(seed + 99, 3, 'textbook') };
  }
  return s;
}

const scene = makeSceneState();
const air = makeAir();
const notices = makeNotices();
let session = null;
let chart = null;
let clock = 0;
let last = performance.now();
let bearing = 225;

let workMs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const w0 = performance.now();
  try {
    tick(ts);
  } finally {
    workMs = workMs * 0.9 + (performance.now() - w0) * 0.1;
  }
}

function tick(ts) {
  const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000));
  last = ts;
  if (document.hidden) return;
  const now = ts / 1000;
  const input = readInput(dt);
  clock += dt;
  const auto = params.has('auto');
  advance(session, clock, auto ? null : input);
  for (const e of session.events) eventNotice(notices, e, session.meId, now);
  session.events.length = 0;
  aimCamera(view, scene, session, dt, input, platform.reducedMotion);
  drawScene(view, scene, session, {
    quality: params.get('q') ?? platform.quality,
    reduced: platform.reducedMotion,
    touch: platform.touch,
    notice: currentNotice(notices, now),
    now,
    bearing,
    chart,
    air,
    show: { mini: true },
  });
}

await fontsReady();
session = newLocalRace();
chart = buildChart(session.race);
bearing = Math.round(((session.race.seed % 360) + 360) % 360);
const ff = Number(params.get('ff') ?? 0);
if (ff > 0) {
  advance(session, ff, null, 1e6);
  session.events.length = 0;
  clock = ff;
}
// Frame the first picture at once (no swoop from the origin).
aimCamera(view, scene, session, 0.016, null, true);
view.cam.x = view.cam.tx;
view.cam.y = view.cam.ty;
view.cam.zoom = view.cam.tzoom;
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
window.__tack = { session: () => session, view, workMs: () => workMs };
