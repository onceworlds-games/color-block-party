// A stand-in for the few browser APIs the game touches, so the real client code (drawing, screens, sound) can run in node.
// The canvas context checks what it's asked to draw: every number must be finite, saves and restores must balance, and nothing
// may call a method the real one doesn't have. This is not a browser: nothing is rendered.

const NUMERIC_ARGS = new Set([
  'arc', 'arcTo', 'ellipse', 'rect', 'fillRect', 'strokeRect', 'clearRect', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
  'translate', 'rotate', 'scale', 'setTransform', 'transform', 'fillText', 'strokeText', 'drawImage', 'createLinearGradient',
  'createRadialGradient',
]);
const METHODS = new Set([
  ...NUMERIC_ARGS, 'save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip', 'measureText', 'addColorStop', 'setLineDash',
  'createPattern', 'resetTransform', 'getTransform', 'isPointInPath',
]);
const PROPS = new Set([
  'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'lineCap', 'miterLimit', 'font', 'textAlign', 'textBaseline', 'globalAlpha',
  'globalCompositeOperation', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled', 'filter',
]);

export const stats = { calls: 0, saves: 0, depth: 0, maxDepth: 0, texts: [] };

export function makeContext(canvas) {
  const state = { alpha: 1 };
  const target = {};
  return new Proxy(target, {
    get(_, name) {
      if (name === 'canvas') return canvas;
      if (name === 'measureText') return (text) => ({ width: String(text).length * 9 });
      if (name === 'save') return () => (stats.depth++, stats.saves++, (stats.maxDepth = Math.max(stats.maxDepth, stats.depth)));
      if (name === 'restore') return () => {
        stats.depth--;
        if (stats.depth < 0) throw new Error('restore() without save()');
      };
      if (name === 'createLinearGradient' || name === 'createRadialGradient') {
        return (...args) => {
          for (const a of args) if (!Number.isFinite(a)) throw new Error(`${String(name)} got ${a}`);
          return { addColorStop() {} };
        };
      }
      if (METHODS.has(name)) {
        return (...args) => {
          stats.calls++;
          if (NUMERIC_ARGS.has(name)) {
            const list = name === 'drawImage' ? args.slice(1) : name === 'fillText' || name === 'strokeText' ? args.slice(1, 3) : args;
            for (const a of list) {
              if (typeof a === 'boolean') continue;
              if (!Number.isFinite(a)) throw new Error(`${String(name)}(${args.join(', ')}) got a non-finite number`);
            }
            if (name === 'fillText' || name === 'strokeText') {
              if (typeof args[0] !== 'string') throw new Error(`${String(name)} text must be a string`);
              if (name === 'fillText') stats.texts.push(args[0]);
            }
            if ((name === 'arc' || name === 'ellipse') && args[2] < 0) throw new Error(`${String(name)} with a negative radius ${args[2]}`);
            if (name === 'ellipse' && args[3] < 0) throw new Error(`ellipse with a negative radius ${args[3]}`);
          }
          return undefined;
        };
      }
      if (name === 'globalAlpha') return state.alpha;
      return target[name];
    },
    set(_, name, value) {
      if (!PROPS.has(name)) throw new Error(`the context has no property ${String(name)}`);
      if (name === 'globalAlpha') {
        if (!Number.isFinite(value) || value < -1e-9 || value > 1 + 1e-9) throw new Error(`globalAlpha ${value}`);
        state.alpha = value;
      }
      if (name === 'lineWidth' && !(value >= 0)) throw new Error(`lineWidth ${value}`);
      if (name === 'font' && !/\d+(\.\d+)?px/.test(value)) throw new Error(`bad font ${value}`);
      if ((name === 'fillStyle' || name === 'strokeStyle') && typeof value === 'string' && /NaN|undefined/.test(value)) throw new Error(`${String(name)} ${value}`);
      target[name] = value;
      return true;
    },
  });
}

export function makeCanvas() {
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    getContext() {
      return (this.ctx ??= makeContext(this));
    },
  };
  return canvas;
}

class FakeParam {
  constructor(value = 1) {
    this.value = value;
  }
  setValueAtTime(v) {
    if (!Number.isFinite(v)) throw new Error('param value');
  }
  linearRampToValueAtTime(v) {
    if (!Number.isFinite(v)) throw new Error('param ramp');
  }
  exponentialRampToValueAtTime(v) {
    if (!(v > 0)) throw new Error(`exponential ramp to ${v}`);
  }
  setTargetAtTime(v, t, k) {
    if (!Number.isFinite(v) || !Number.isFinite(t) || !(k > 0)) throw new Error('param target');
  }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.Q = new FakeParam(1);
  }
  connect(n) {
    return n;
  }
  disconnect() {}
  start() {}
  stop() {}
}

export class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = new FakeNode();
    FakeAudioContext.made++;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
}
FakeAudioContext.made = 0;

class FakeImage {
  constructor() {
    this.complete = true;
    this.naturalWidth = 64;
    this.naturalHeight = 64;
  }
  set src(v) {
    this._src = v;
  }
}

/** Installs the globals. Returns { canvas, listeners, raf, clock } to drive the page. */
export function installDom({ width = 800, height = 450, search = '' } = {}) {
  const listeners = {};
  const docListeners = {};
  const rafQueue = [];
  const clock = { now: 1_000_000, perf: 0 };
  const canvas = makeCanvas();
  const body = { style: {}, dataset: {} };
  globalThis.Date.now = () => clock.now;
  globalThis.performance = { now: () => clock.perf };
  globalThis.window = globalThis;
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  globalThis.devicePixelRatio = 2;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.Image = FakeImage;
  globalThis.location = { search };
  globalThis.addEventListener = (type, fn) => (listeners[type] ??= []).push(fn);
  globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => {
    const t = realSetInterval(fn, ms);
    t.unref?.(); // a page's timers never keep a test process alive
    return t;
  };
  const timers = [];
  globalThis.setTimeout = (fn, ms = 0) => {
    timers.push({ at: clock.now + ms, fn });
    return timers.length;
  };
  globalThis.clearTimeout = (id) => {
    if (timers[id - 1]) timers[id - 1].fn = null;
  };
  globalThis.document = {
    hidden: false,
    body,
    documentElement: { style: {} },
    getElementById: () => canvas,
    createElement: () => makeCanvas(),
    addEventListener: (type, fn) => (docListeners[type] ??= []).push(fn),
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve() },
  };
  const key = (type, code) => {
    for (const fn of listeners[type] ?? []) fn({ code, key: code, repeat: false, preventDefault() {} });
  };
  return {
    canvas,
    listeners,
    body,
    clock,
    key,
    keydown: (code) => key('keydown', code),
    keyup: (code) => key('keyup', code),
    tap: (x = 400, y = 225) => {
      for (const fn of canvas.listeners.pointerdown ?? []) fn({ clientX: x, clientY: y });
    },
    /** One animation frame, `ms` after the last. */
    frame(ms = 1000 / 60) {
      clock.now += ms;
      clock.perf += ms;
      for (const t of timers) {
        if (t.fn && t.at <= clock.now) {
          const fn = t.fn;
          t.fn = null;
          fn();
        }
      }
      const fns = rafQueue.splice(0);
      for (const fn of fns) fn(clock.perf);
    },
    resize(w, h) {
      globalThis.innerWidth = w;
      globalThis.innerHeight = h;
      for (const fn of listeners.resize ?? []) fn();
    },
  };
}
