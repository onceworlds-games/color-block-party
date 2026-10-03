// Every call to the Onceworlds SDK goes through here. The SDK is absent when the game is opened on its own (store
// art, tests) and a method can be missing on an older platform, so each call is guarded and never throws into the game.

const ow = typeof window !== 'undefined' ? window.onceworlds : undefined;
const warned = new Set();

function guard(name, fn, fallback) {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') return v.catch((e) => (warn(name, e), fallback));
    return v === undefined ? fallback : v;
  } catch (e) {
    warn(name, e);
    return fallback;
  }
}

function warn(name, e) {
  if (warned.has(name)) return;
  warned.add(name);
  try {
    console.warn(`tack: ${name} failed`, e?.message ?? e);
  } catch {}
}

export const platform = {
  available: !!ow,
  standalone: !ow || ow.mode === 'standalone',
  sdk: ow,

  now() {
    return guard('now', () => (typeof ow?.now === 'function' ? ow.now() : Date.now()), Date.now());
  },

  // ------------------------------------------------------------------ rooms
  join(opts) {
    if (!ow?.rooms?.join) return Promise.resolve(null);
    return guard('rooms.join', () => ow.rooms.join(opts), Promise.resolve(null));
  },
  onRooms(event, fn) {
    guard('rooms.on', () => ow?.rooms?.on?.(event, fn), null);
  },

  // ------------------------------------------------------------------ player
  player() {
    return guard('player.get', () => ow?.player?.get?.(), Promise.resolve(null));
  },
  avatarUrl(id) {
    return guard('player.avatarUrl', () => ow?.player?.avatarUrl?.(id, 'head'), Promise.resolve(null));
  },

  // ------------------------------------------------------------------ saves
  async load(key) {
    const v = await guard('save.get', () => ow?.save?.get?.(key), Promise.resolve(null));
    return v ?? null;
  },
  save(key, value) {
    return guard('save.set', () => ow?.save?.set?.(key, value), Promise.resolve(null));
  },

  // ------------------------------------------------------------------ badges and boards
  award(id) {
    return guard('badges.award', () => ow?.badges?.award?.(id), Promise.resolve(false));
  },
  submit(board, score, lowerIsBetter = false) {
    if (!Number.isFinite(score)) return Promise.resolve(null);
    return guard('leaderboards.submit', () => ow?.leaderboards?.submit?.(board, score, lowerIsBetter ? { lowerIsBetter: true } : undefined), Promise.resolve(null));
  },
  top(board, limit = 10) {
    return guard('leaderboards.top', () => ow?.leaderboards?.top?.(board, { limit }), Promise.resolve(null));
  },

  // ------------------------------------------------------------------ touch controls
  setControls(spec) {
    guard('controls.set', () => ow?.controls?.set?.(spec), null);
  },
  get touch() {
    return guard('controls.touch', () => !!ow?.controls?.touch, false);
  },
  stick() {
    return guard('controls.stick', () => ow?.controls?.stick ?? null, null);
  },
  pressed(id) {
    return guard('controls.pressed', () => !!ow?.controls?.pressed?.(id), false);
  },

  // ------------------------------------------------------------------ settings
  pixelRatio() {
    return guard('settings.pixelRatio', () => ow?.settings?.pixelRatio?.(2), Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  },
  get quality() {
    return guard('settings.quality', () => ow?.settings?.quality ?? 'high', 'high');
  },
  get reducedMotion() {
    const sys = typeof matchMedia === 'function' && guard('matchMedia', () => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
    return guard('settings.reducedMotion', () => (ow?.settings ? !!ow.settings.reducedMotion : sys), sys);
  },
  onSettings(fn) {
    guard('settings.on', () => ow?.settings?.on?.('change', fn), null);
  },

  // ------------------------------------------------------------------ platform events and ui
  on(event, fn) {
    guard(`on ${event}`, () => ow?.on?.(event, fn), null);
  },
  showInvite() {
    guard('ui.showInvite', () => ow?.ui?.showInvite?.(), null);
  },
  rename() {
    return guard('player.rename', () => ow?.player?.rename?.(), Promise.resolve(null));
  },
};
