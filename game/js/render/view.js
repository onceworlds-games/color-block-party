// The canvas, its pixel ratio and the camera. World units are metres; the camera keeps "up the screen" upwind.

export const PALETTE = {
  paper: '#EFE6D2',
  paperShade: '#E2D5B8',
  paperLight: '#F6F0E2',
  ink: '#1E2A33',
  inkSoft: '#3B4B57',
  teal: '#79A9A3',
  slate: '#4E6E7C',
  red: '#C2412F',
  mustard: '#D7A332',
  sand: '#E6CFA0',
  fog: '#E4E2DC',
};

/** Sail colours, each with a shape mark so colour is never the only cue. */
export const LIVERIES = [
  { id: 'coral', name: 'Coral', color: '#E5735A', shape: 'circle' },
  { id: 'cobalt', name: 'Cobalt', color: '#2F55A4', shape: 'triangle' },
  { id: 'mustard', name: 'Mustard', color: '#D7A332', shape: 'square' },
  { id: 'plum', name: 'Plum', color: '#7A3E6E', shape: 'diamond' },
  { id: 'pine', name: 'Pine', color: '#2F6B4F', shape: 'star' },
  { id: 'ink', name: 'Ink', color: '#1E2A33', shape: 'cross' },
  { id: 'clay', name: 'Clay', color: '#B5653F', shape: 'ring' },
  { id: 'sky', name: 'Sky', color: '#6FA8D6', shape: 'bar' },
  { id: 'rose', name: 'Rose', color: '#D98AA0', shape: 'chevron' },
  { id: 'olive', name: 'Olive', color: '#7D7F3A', shape: 'hex' },
];

export const FONT_SERIF = "'Spectral', 'Iowan Old Style', 'Palatino', Georgia, serif";
export const FONT_MONO = "'Plex Mono', 'SF Mono', Menlo, Consolas, monospace";

/** A canvas that fills its parent at the platform's pixel ratio. */
export function makeView(canvas, getRatio) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const view = {
    canvas,
    ctx,
    w: 1, // css pixels
    h: 1,
    dpr: 1,
    cam: { x: 0, y: 0, zoom: 6, tx: 0, ty: 0, tzoom: 6, shake: 0 }, // zoom: css px per metre
    resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      let dpr = 1;
      try {
        dpr = Math.max(0.5, Math.min(3, Number(getRatio()) || 1));
      } catch {
        dpr = Math.min(2, window.devicePixelRatio || 1);
      }
      // Never more than ~4.5 Mpx of canvas (phones cap canvas memory).
      const maxPx = 4.5e6;
      if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      view.w = w;
      view.h = h;
      view.dpr = pw / w;
    },
    /** Sets the world transform (metres) for the current camera. */
    worldTransform() {
      const c = view.cam;
      const z = c.zoom * view.dpr;
      const sx = c.shake ? (Math.random() - 0.5) * c.shake : 0;
      const sy = c.shake ? (Math.random() - 0.5) * c.shake : 0;
      ctx.setTransform(z, 0, 0, z, view.w * view.dpr * 0.5 - c.x * z + sx * view.dpr, view.h * view.dpr * 0.5 - c.y * z + sy * view.dpr);
    },
    /** Screen-space transform in css pixels. */
    screenTransform() {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    },
    toScreen(x, y, out) {
      const c = view.cam;
      out.x = view.w * 0.5 + (x - c.x) * c.zoom;
      out.y = view.h * 0.5 + (y - c.y) * c.zoom;
      return out;
    },
    toWorld(sx, sy, out) {
      const c = view.cam;
      out.x = c.x + (sx - view.w * 0.5) / c.zoom;
      out.y = c.y + (sy - view.h * 0.5) / c.zoom;
      return out;
    },
    /** The visible world rectangle, with a margin in metres. */
    bounds(margin = 0) {
      const c = view.cam;
      const hw = view.w / 2 / c.zoom + margin;
      const hh = view.h / 2 / c.zoom + margin;
      return { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
    },
  };
  return view;
}

/** Eases the camera toward its target (frame-rate independent). */
export function updateCamera(cam, dt, reduced) {
  const k = 1 - Math.exp(-dt * (reduced ? 3 : 4.5));
  const kz = 1 - Math.exp(-dt * 2.2);
  cam.x += (cam.tx - cam.x) * k;
  cam.y += (cam.ty - cam.y) * k;
  cam.zoom *= Math.exp((Math.log(cam.tzoom) - Math.log(cam.zoom)) * kz);
  cam.shake = reduced ? 0 : Math.max(0, cam.shake - dt * 18);
}
