// Input: keyboard, the platform's touch stick and buttons, and a gamepad, folded into one small state the race reads.
// Keys held when the window loses focus are let go; nothing here ever throws into the frame loop.

import { platform } from './platform.js';

const keys = new Set();
const state = {
  steer: 0, // -1..1, positive turns clockwise on the chart (to starboard)
  push: false, // past the helm's groove
  hike: false,
  chart: false, // hold to see the whole course
  zoom: 0, // wheel / [ ] steps since last read
  tackQueued: false,
  any: false, // touched the game since last read (for hints and idle)
  rampL: 0,
  rampR: 0,
};

let enabled = true;
let gamepadBroken = false;

const STEER_KEYS_L = ['a', 'arrowleft'];
const STEER_KEYS_R = ['d', 'arrowright'];

function down(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return; // never swallow browser shortcuts
  const k = (e.key || '').toLowerCase();
  if (k === 'tab') {
    // Held for the whole-course chart while racing; on every other screen Tab moves between the buttons as usual.
    if (!enabled) return;
    e.preventDefault();
    state.chart = true;
    state.any = true;
    return;
  }
  if (k === ' ' || k === 'spacebar') {
    if (!e.repeat && enabled) state.tackQueued = true;
    if (enabled) e.preventDefault();
    state.any = true;
    return;
  }
  if (k === '[' || k === '-') state.zoom -= 1;
  if (k === ']' || k === '=' || k === '+') state.zoom += 1;
  if (STEER_KEYS_L.includes(k) || STEER_KEYS_R.includes(k) || k === 'shift' || k === 'h' || k === 'w' || k === 'arrowup') {
    if (k.startsWith('arrow')) e.preventDefault();
    keys.add(k);
    state.any = true;
  }
}

function up(e) {
  const k = (e.key || '').toLowerCase();
  if (k === 'tab') state.chart = false;
  keys.delete(k);
}

function clearAll() {
  keys.clear();
  state.chart = false;
  state.tackQueued = false;
  state.rampL = state.rampR = 0;
}

export function initInput(target) {
  addEventListener('keydown', down, { passive: false });
  addEventListener('keyup', up);
  addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => document.hidden && clearAll());
  target.addEventListener(
    'wheel',
    (e) => {
      state.zoom += e.deltaY < 0 ? 1 : -1;
      e.preventDefault();
    },
    { passive: false },
  );
  target.addEventListener('pointerdown', () => (state.any = true));
}

/** Turns the input on or off (off on menus: Space and arrows then belong to the page's buttons). */
export function setInputEnabled(on) {
  enabled = on;
  if (!on) clearAll();
}

function readGamepad() {
  if (gamepadBroken || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  try {
    for (const g of navigator.getGamepads()) if (g && g.connected) return g;
  } catch {
    gamepadBroken = true;
  }
  return null;
}

let padTackWas = false;

/** Reads the input for one frame. `dt` in seconds. */
export function readInput(dt) {
  const l = STEER_KEYS_L.some((k) => keys.has(k));
  const r = STEER_KEYS_R.some((k) => keys.has(k));
  // A short ramp: a tap is a small correction, a hold is the full rate.
  state.rampL = l ? Math.min(1, state.rampL + dt / 0.14) : 0;
  state.rampR = r ? Math.min(1, state.rampR + dt / 0.14) : 0;
  let steer = l && r ? 0 : state.rampR - state.rampL;
  steer = Math.sign(steer) * (0.35 + 0.65 * Math.abs(steer)) * (steer !== 0 ? 1 : 0);
  let push = false;
  let hike = keys.has('shift') || keys.has('h');
  // Touch: the platform's analog stick steers; its buttons tack and hike.
  if (platform.touch) {
    const st = platform.stick();
    if (st && Number.isFinite(st.x) && Math.abs(st.x) > 0.12) {
      const x = Math.max(-1, Math.min(1, st.x));
      steer = Math.sign(x) * ((Math.abs(x) - 0.12) / 0.88) ** 1.3;
      push = Math.abs(x) > 0.9;
      state.any = true;
    }
    if (platform.pressed('hike')) hike = true;
  }
  const pad = readGamepad();
  if (pad) {
    const x = pad.axes?.[0] ?? 0;
    if (Math.abs(x) > 0.15) {
      steer = Math.sign(x) * ((Math.abs(x) - 0.15) / 0.85) ** 1.3;
      push = Math.abs(x) > 0.92;
      state.any = true;
    }
    const tack = !!pad.buttons?.[0]?.pressed;
    if (tack && !padTackWas) state.tackQueued = true;
    padTackWas = tack;
    if (pad.buttons?.[1]?.pressed || pad.buttons?.[7]?.pressed || pad.buttons?.[6]?.pressed) hike = true;
  }
  state.steer = enabled ? Math.max(-1, Math.min(1, steer)) : 0;
  state.push = enabled && push;
  state.hike = enabled && hike;
  const out = { steer: state.steer, push: state.push, hike: state.hike, chart: state.chart, zoom: state.zoom, tack: enabled && state.tackQueued, any: state.any };
  state.tackQueued = false;
  state.zoom = 0;
  state.any = false;
  return out;
}

/** The touch layout for racing: an analog stick that steers, Tack (the big one) and Hike. */
export const RACE_CONTROLS = {
  stick: 'analog',
  buttons: [
    { id: 'tack', label: 'Tack', key: ' ' },
    { id: 'hike', label: 'Hike', key: 'h' },
  ],
};
