// Sound, made in Web Audio: water and wind beds that follow the boat and the breeze, sail flutter when luffing, hull
// creaks, a bell buoy at the marks, the committee's horns and gun, a gull now and then, thunder before a squall, and a
// sparse plucked loop that quickens as the fleet closes up. Everything goes through a limiter; the platform sets the
// volume. Nothing here may throw into the game: every call is guarded.

let ctx = null;
let master = null;
let noise = null;
let beds = null;
let broken = false;
let plucks = null;
let musicNext = 0;
let musicStep = 0;
let gullAt = 0;
let thunderAt = 0;
let lastCue = '';
let lastCueAt = 0;

const rnd = (a, b) => a + Math.random() * (b - a);

function safe(fn) {
  if (broken) return;
  try {
    fn();
  } catch (e) {
    broken = true;
    try {
      console.warn('tack: sound is off', e?.message ?? e);
    } catch {}
  }
}

/** Creates the context on the first gesture (iPhones only allow sound to start from a tap in the game). */
export function unlock() {
  safe(() => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        broken = true;
        return;
      }
      ctx = new AC();
      build();
    }
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  });
}

export function suspend() {
  safe(() => ctx && ctx.state === 'running' && ctx.suspend().catch(() => {}));
}

export function resume() {
  safe(() => ctx && ctx.state !== 'running' && ctx.resume().catch(() => {}));
}

function build() {
  master = ctx.createGain();
  master.gain.value = 0.8;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  // Two seconds of noise, used by everything breathy.
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  beds = {
    water: bed('bandpass', 420, 0.8),
    rumble: bed('lowpass', 160, 0.5),
    wind: bed('bandpass', 1100, 0.6),
    flutter: bed('bandpass', 1500, 2.2),
  };
  // Sail flutter: the noise chopped by a fast wobble.
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 14;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth);
  depth.connect(beds.flutter.chop.gain);
  lfo.start();
  beds.lfo = lfo;
  plucks = makePlucks();
}

/** A looping noise bed through a filter, with a gain to ride. */
function bed(type, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f);
  f.connect(chop);
  chop.connect(g);
  g.connect(master);
  src.start(0, Math.random() * 1.5);
  return { src, f, g, chop };
}

/** Karplus-Strong plucks, computed once: a guitar-ish voice for the loop, on a D dorian scale. */
function makePlucks() {
  const notes = [146.83, 164.81, 174.61, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23];
  return notes.map((f) => {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 1.6);
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / f));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const next = (idx + 1) % period;
      const v = 0.4975 * (ring[idx] + ring[next]);
      out[i] = ring[idx];
      ring[idx] = v;
      idx = next;
    }
    // A soft attack, so it plucks rather than clicks.
    for (let i = 0; i < 64; i++) out[i] *= i / 64;
    return buf;
  });
}

function voice(at, gain, attack, hold, release) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.setValueAtTime(gain, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  g.connect(master);
  return g;
}

function noiseBurst(at, dur, type, freq, q, gain, sweepTo = null) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  f.Q.value = q;
  const g = voice(at, gain, Math.min(0.02, dur * 0.2), dur * 0.3, dur * 0.7);
  src.connect(f);
  f.connect(g);
  src.start(at, Math.random() * 1.5, dur + 0.1);
}

function tone(at, type, freq, dur, gain, freqTo = null, filter = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, at + dur);
  const g = voice(at, gain, 0.008, dur * 0.25, dur * 0.75);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    o.connect(f);
    f.connect(g);
  } else o.connect(g);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** The committee boat's horn: detuned saws, filtered; long or short. */
function horn(at, long) {
  const dur = long ? 1.15 : 0.32;
  const g = voice(at, long ? 0.22 : 0.18, 0.07, dur * 0.7, 0.25);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 720;
  f.Q.value = 0.7;
  f.connect(g);
  for (const hz of [98, 147.5, 196.4]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz * rnd(0.995, 1.005);
    o.connect(f);
    o.start(at);
    o.stop(at + dur + 0.4);
  }
}

/** The player's own horn (cosmetic): brass, a foghorn, a whistle or a conch. */
let myHornId = 'brass';
export function setHorn(id) {
  myHornId = id;
}
function myHorn(at) {
  if (myHornId === 'fog') {
    const g = voice(at, 0.24, 0.12, 1.3, 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 480;
    f.connect(g);
    for (const hz of [61.7, 92.5, 123.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz * 1.04, at);
      o.frequency.exponentialRampToValueAtTime(hz, at + 0.3);
      o.connect(f);
      o.start(at);
      o.stop(at + 2.1);
    }
  } else if (myHornId === 'whistle') {
    tone(at, 'sine', 1320, 0.22, 0.09, 1480);
    tone(at + 0.26, 'sine', 1480, 0.6, 0.1, 1400);
  } else if (myHornId === 'conch') {
    tone(at, 'triangle', 196, 1.1, 0.16, 207.7, 900);
    tone(at, 'sine', 392, 1.1, 0.05, 415.3);
    noiseBurst(at, 1.1, 'bandpass', 700, 2, 0.05);
  } else horn(at, true);
}

/** A bell buoy: inharmonic partials, long decays. */
function bell(at) {
  const f0 = rnd(600, 700);
  for (const [k, gain, dec] of [[1, 0.16, 2.6], [2.02, 0.09, 1.8], [2.74, 0.07, 1.4], [5.4, 0.04, 0.8], [8.93, 0.02, 0.5]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f0 * k * rnd(0.997, 1.003);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dec);
    o.connect(g);
    g.connect(master);
    o.start(at);
    o.stop(at + dec + 0.05);
  }
}

function gull(at) {
  const calls = Math.round(rnd(2, 4));
  for (let i = 0; i < calls; i++) {
    const t = at + i * rnd(0.22, 0.32);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const base = rnd(1150, 1450);
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.24);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vg = ctx.createGain();
    vg.gain.value = 40;
    vib.connect(vg);
    vg.connect(o.frequency);
    const g = voice(t, 0.035, 0.02, 0.05, 0.18);
    o.connect(g);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.3);
    vib.stop(t + 0.3);
  }
}

function thunder(at) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = rnd(90, 140);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(rnd(0.12, 0.2), at + rnd(0.6, 1.2));
  g.gain.exponentialRampToValueAtTime(0.0001, at + rnd(3.5, 5));
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(at);
  src.stop(at + 5.2);
}

/** A hull creak: a resonant filter sweeping down over a scrape of noise. */
function creak(at, k) {
  noiseBurst(at, 0.28 * k, 'bandpass', rnd(380, 460), 14, 0.16 * k, rnd(220, 260));
}

/** One-shot sounds by name. */
export function cue(name) {
  safe(() => {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // The same cue twice within a breath: let the first one speak.
    if (name === lastCue && now - lastCueAt < 0.06) return;
    lastCue = name;
    lastCueAt = now;
    const t = now + 0.005;
    switch (name) {
      case 'hornLong':
        horn(t, true);
        break;
      case 'hornShort':
        horn(t, false);
        break;
      case 'gun':
        noiseBurst(t, 0.35, 'lowpass', 900, 0.7, 0.4, 120);
        tone(t, 'sine', 70, 0.5, 0.35, 38);
        horn(t + 0.08, true);
        break;
      case 'start':
        tone(t, 'triangle', rnd(520, 560), 0.12, 0.07);
        tone(t + 0.09, 'triangle', rnd(780, 820), 0.16, 0.06);
        break;
      case 'ocs':
        horn(t, false);
        horn(t + 0.42, false);
        break;
      case 'ocsOther':
        horn(t, false);
        break;
      case 'clean':
        // tk-tk: two small clicks, then the hull settles.
        noiseBurst(t, 0.03, 'bandpass', rnd(1700, 2000), 6, 0.22);
        noiseBurst(t + 0.09, 0.03, 'bandpass', rnd(2100, 2400), 6, 0.18);
        creak(t + 0.15, 0.6);
        break;
      case 'messy':
        creak(t, 1);
        noiseBurst(t + 0.05, 0.4, 'bandpass', 1300, 1.2, 0.08);
        break;
      case 'irons':
        noiseBurst(t, 0.6, 'bandpass', 1600, 2.5, 0.07, 1100);
        break;
      case 'gust':
        noiseBurst(t, 0.9, 'bandpass', rnd(380, 450), 1.4, 0.12, rnd(1300, 1600));
        break;
      case 'foul':
        tone(t, 'square', 140, 0.22, 0.09, null, 900);
        tone(t, 'square', 147, 0.22, 0.07, null, 900);
        break;
      case 'bump':
        tone(t, 'sine', rnd(85, 100), 0.16, 0.25, 48);
        noiseBurst(t, 0.06, 'lowpass', 600, 0.7, 0.12);
        break;
      case 'ground':
        noiseBurst(t, 0.7, 'lowpass', 260, 0.8, 0.22, 90);
        tone(t, 'sine', 60, 0.3, 0.25, 35);
        break;
      case 'bell':
        bell(t);
        break;
      case 'wrong':
        tone(t, 'triangle', 330, 0.18, 0.08, 250);
        tone(t + 0.16, 'triangle', 247, 0.24, 0.08, 196);
        break;
      case 'finish':
        myHorn(t);
        bell(t + 0.3);
        break;
      case 'myHorn':
        myHorn(t);
        break;
      case 'finishOther':
        horn(t, false);
        break;
      case 'steal':
        tone(t, 'sine', rnd(660, 700), 0.1, 0.05);
        break;
      case 'ui':
        noiseBurst(t, 0.025, 'bandpass', rnd(900, 1300), 3, 0.15);
        tone(t, 'triangle', rnd(300, 340), 0.06, 0.04);
        break;
      default:
    }
  });
}

/**
 * Rides the beds every frame: water with the boat's speed, wind with the breeze (and gusts), flutter with the sail's
 * luff; music tempo with how close the fleet is; a gull now and then; thunder when a squall's front is near.
 */
export function update(s, b) {
  safe(() => {
    if (!ctx || !beds || ctx.state !== 'running' || !s) return;
    const now = ctx.currentTime;
    const race = s.race;
    const v = b ? b.v : 2.5;
    const kn = b ? b.rawKn || b.wkn || 8 : race.wind.baseKn;
    const gust = b ? Math.max(0, (b.rawGust ?? 1) - 1) : 0;
    const k = 0.25;
    beds.water.g.gain.setTargetAtTime(b ? 0.05 + Math.min(1, v / 6) * 0.11 : 0.05, now, k);
    beds.water.f.frequency.setTargetAtTime(280 + v * 95, now, k);
    beds.rumble.g.gain.setTargetAtTime(b ? 0.04 + Math.min(1, v / 6) * 0.06 : 0.03, now, k);
    beds.wind.g.gain.setTargetAtTime(0.012 + Math.min(1, kn / 22) * 0.05 + gust * 0.08, now, 0.6);
    beds.wind.f.frequency.setTargetAtTime(700 + kn * 40 + gust * 500, now, 0.6);
    beds.flutter.g.gain.setTargetAtTime(b ? Math.min(1, b.luff ?? 0) * 0.1 : 0, now, 0.08);
    beds.lfo.frequency.setTargetAtTime(10 + kn * 0.5, now, 0.3);
    // The loop: quieter alone, quicker when rivals are close.
    let near = 200;
    if (b) for (const o of race.boats) if (o !== b && !o.finished && !o.retired) near = Math.min(near, Math.hypot(o.x - b.x, o.y - b.y));
    const bpm = 76 + 44 * Math.max(0, Math.min(1, (60 - near) / 50));
    const beat = 60 / bpm / 2;
    if (musicNext < now) musicNext = now + 0.05;
    while (musicNext < now + 0.12) {
      playStep(musicNext, musicStep++, near);
      musicNext += beat;
    }
    if (b && now > gullAt) {
      if (gullAt > 0) gull(now + 0.05);
      gullAt = now + rnd(25, 60);
    }
    if (race.wind.front && b) {
      const fy = race.wind.area.y0 - 90 + (race.t - race.wind.front.t0) * race.wind.front.speed;
      const d = b.y - fy;
      if (d > 0 && d < 220 && now > thunderAt) {
        thunder(now + 0.05);
        thunderAt = now + rnd(9, 20) * (0.5 + d / 220);
      }
    }
  });
}

// A sparse figure: mostly rests; the bass on the bar, a few notes over it.
const FIGURE = [0, -1, 4, -1, 2, -1, -1, 5, 0, -1, 4, -1, 6, -1, 3, -1];
function playStep(at, step, near) {
  if (!plucks) return;
  const i = step % FIGURE.length;
  const n = FIGURE[i];
  const bar = Math.floor(step / FIGURE.length) % 4;
  if (n < 0) return;
  // Sparser when the fleet is far away.
  if (near > 90 && i % 4 !== 0 && Math.random() < 0.6) return;
  const idx = Math.max(0, Math.min(plucks.length - 1, n + (bar === 2 ? 2 : bar === 3 ? -1 : 0) + (i % 4 === 0 ? 0 : 2)));
  const src = ctx.createBufferSource();
  src.buffer = plucks[idx];
  src.playbackRate.value = rnd(0.997, 1.003);
  const g = ctx.createGain();
  g.gain.value = i % 4 === 0 ? 0.11 : 0.07;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 2600;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(at);
  src.stop(at + 1.6);
}
