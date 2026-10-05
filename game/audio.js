// All the sound, synthesized: a short sound for every action and a looping party tune from a tiny step sequencer.
// Nothing here may ever throw into the game: every entry point is wrapped, and a browser without Web Audio just stays quiet.
// The platform applies the player's volume and mute to everything connected to the destination.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let duck = null;
let noiseBuf = null;
let dead = false;

let musicMode = 'off'; // 'off' | 'menu' | 'play'
let timer = 0;
let nextTime = 0;
let stepIdx = 0;
let bpm = 124;
let cutUntil = 0;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MUSIC_LEVEL = { off: 0, menu: 0.38, play: 0.85 };

function safe(fn) {
  return (...args) => {
    if (dead) return undefined;
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  };
}

/** Starts the audio context. Call it from a tap or key press (phones keep sound off until then). */
export const unlock = safe(() => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      dead = true;
      return;
    }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.85;
    sfxBus.connect(master);
    duck = ctx.createGain();
    duck.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL[musicMode];
    musicBus.connect(duck);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
});

function tone(freq, dur, o = {}) {
  if (!ctx) return;
  const { type = 'sine', vol = 0.25, at = 0, slide = 0, attack = 0.006, bus = sfxBus, vib = 0 } = o;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  if (vib) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 9;
    lg.gain.value = freq * vib;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur, o = {}) {
  if (!ctx || !noiseBuf) return;
  const { vol = 0.2, at = 0, filter = 'highpass', freq = 2000, freq2 = 0, bus = sfxBus, q = 0.8 } = o;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------- sound effects
const JINGLES = [
  [523, 659, 784], // red
  [659, 784, 988], // yellow
  [587, 740, 880], // green
  [440, 554, 659], // blue
  [698, 880, 1047], // purple
  [494, 622, 740], // orange
];

export const sfx = {
  /** The call: a little tune for each colour. */
  call: safe((ci) => {
    const notes = JINGLES[ci] ?? JINGLES[0];
    notes.forEach((f, i) => {
      tone(f, 0.16, { type: 'triangle', vol: 0.3, at: i * 0.085, vib: 0.01 });
      tone(f * 2, 0.1, { type: 'sine', vol: 0.1, at: i * 0.085 });
    });
    tone(notes[2] * 1.5, 0.28, { type: 'triangle', vol: 0.22, at: 0.26 });
  }),
  /** The ticks before a drop; `k` is 2, 1, 0 as it gets closer. */
  tick: safe((k) => tone(520 + (2 - k) * 140, 0.07, { type: 'square', vol: 0.12 })),
  /** The drop: a record scratch, then the rumble of tiles going. */
  drop: safe(() => {
    noise(0.28, { filter: 'bandpass', freq: 900, freq2: 3200, vol: 0.32, q: 2 });
    tone(1100, 0.32, { type: 'sawtooth', vol: 0.16, slide: 0.12 });
    tone(220, 0.3, { type: 'sawtooth', vol: 0.12, at: 0.05, slide: 3 });
    noise(0.5, { filter: 'lowpass', freq: 500, freq2: 90, vol: 0.4, at: 0.1 });
  }),
  /** The floor coming back: a rising wave of pops. */
  rise: safe(() => {
    tone(260, 0.3, { type: 'triangle', vol: 0.16, slide: 3.2 });
    for (let i = 0; i < 5; i++) tone(520 + i * 120, 0.06, { type: 'sine', vol: 0.1, at: 0.05 + i * 0.05 });
  }),
  pop: safe((pitch = 1) => {
    tone(520 * pitch, 0.1, { type: 'sine', vol: 0.25, slide: 1.8 });
  }),
  push: safe((vol = 1) => {
    noise(0.16, { filter: 'bandpass', freq: 600, freq2: 2200, vol: 0.22 * vol, q: 1.2 });
    tone(180, 0.12, { type: 'triangle', vol: 0.12 * vol, slide: 2.2 });
  }),
  /** A cartoon boing for a landed push. */
  boing: safe((vol = 1) => {
    tone(190, 0.14, { type: 'sine', vol: 0.3 * vol, slide: 2.4 });
    tone(450, 0.34, { type: 'sine', vol: 0.26 * vol, at: 0.12, slide: 0.5, vib: 0.06 });
  }),
  /** "Wheee": falling into the dark. */
  fall: safe((vol = 1) => {
    tone(620, 0.22, { type: 'sine', vol: 0.26 * vol, slide: 1.7, vib: 0.03 });
    tone(1050, 0.62, { type: 'sine', vol: 0.26 * vol, at: 0.2, slide: 0.16, vib: 0.035 });
    noise(0.22, { filter: 'lowpass', freq: 700, vol: 0.18 * vol, at: 0.7 });
  }),
  /** The beep of the countdown. */
  count: safe((n) => {
    tone(n === 0 ? 880 : 520, n === 0 ? 0.36 : 0.16, { type: 'square', vol: 0.18 });
    if (n === 0) {
      tone(1320, 0.4, { type: 'triangle', vol: 0.2 });
      tone(660, 0.4, { type: 'triangle', vol: 0.16 });
    }
  }),
  ready: safe(() => {
    tone(660, 0.1, { type: 'triangle', vol: 0.22 });
    tone(990, 0.16, { type: 'triangle', vol: 0.22, at: 0.08 });
  }),
  star: safe(() => {
    tone(1480, 0.09, { type: 'sine', vol: 0.14 });
    tone(1970, 0.12, { type: 'sine', vol: 0.12, at: 0.06 });
  }),
  win: safe(() => {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(f, 0.22, { type: 'square', vol: 0.12, at: i * 0.1 });
      tone(f, 0.26, { type: 'triangle', vol: 0.2, at: i * 0.1 });
    });
  }),
  fanfare: safe(() => {
    const line = [523, 523, 523, 784, 659, 784, 1047];
    const gaps = [0, 0.12, 0.24, 0.36, 0.66, 0.78, 0.96];
    line.forEach((f, i) => {
      tone(f, i === 6 ? 0.7 : 0.2, { type: 'square', vol: 0.12, at: gaps[i] });
      tone(f, i === 6 ? 0.8 : 0.22, { type: 'triangle', vol: 0.22, at: gaps[i] });
    });
    tone(262, 0.8, { type: 'triangle', vol: 0.2, at: 0.96 });
    for (let i = 0; i < 6; i++) tone(1568 + i * 140, 0.08, { type: 'sine', vol: 0.08, at: 1.0 + i * 0.07 });
  }),
};

// ---------------------------------------------------------------- music
// Four bars of C, Am, F, G, sixteen steps a bar: four-on-the-floor kick, off-beat hats, a clap on 2 and 4, a bouncy bass, off-beat
// chord stabs and, while playing, a little arpeggio on top.
const BARS = [
  { bass: 48, chord: [60, 64, 67] },
  { bass: 45, chord: [57, 60, 64] },
  { bass: 41, chord: [57, 60, 65] },
  { bass: 43, chord: [59, 62, 67] },
];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const STAB_STEPS = [2, 6, 10, 14];

function scheduleStep(i, t) {
  const bar = BARS[Math.floor(i / 16) % 4];
  const s = i % 16;
  const play = musicMode === 'play';
  const beat = 60 / bpm / 4;
  if (t < cutUntil) return;
  if (s % 4 === 0) {
    // kick
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + 0.2);
  }
  if (s === 4 || s === 12) musicNoise(t, 0.12, 'bandpass', 1700, 0.28);
  if (s % 2 === 0 && s % 4 !== 0) musicNoise(t, 0.04, 'highpass', 7500, 0.16);
  else if (s % 2 === 1 && play) musicNoise(t, 0.025, 'highpass', 9000, 0.06);
  if (BASS_STEPS.includes(s)) musicTone(mtof(bar.bass + (s === 6 || s === 14 ? 12 : 0)), beat * 1.6, 'triangle', 0.34, t);
  if (STAB_STEPS.includes(s)) for (const n of bar.chord) musicTone(mtof(n), beat * 1.3, 'square', play ? 0.05 : 0.035, t);
  if (play && s % 2 === 0) musicTone(mtof(bar.chord[(s / 2) % 3] + 12), beat * 1.5, 'triangle', 0.1, t);
}

function musicTone(freq, dur, type, vol, t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(musicBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function musicNoise(t, dur, filter, freq, vol) {
  if (!noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(musicBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

const pump = safe(() => {
  if (!ctx || ctx.state !== 'running' || musicMode === 'off') return;
  const beat = 60 / bpm / 4;
  if (nextTime < ctx.currentTime - 0.25) nextTime = ctx.currentTime + 0.05; // a hidden page falls behind: don't replay the gap
  while (nextTime < ctx.currentTime + 0.14) {
    scheduleStep(stepIdx, nextTime);
    stepIdx = (stepIdx + 1) % 64;
    nextTime += beat;
  }
});

export const music = {
  /** 'menu' (soft), 'play' (louder, with the arpeggio) or 'off'. Starts the sequencer on first use. */
  mode: safe((mode) => {
    musicMode = mode;
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL[mode] ?? 0, ctx.currentTime, 0.25);
    if (mode !== 'off' && !timer) {
      nextTime = ctx.currentTime + 0.08;
      timer = setInterval(pump, 30);
    }
    if (mode === 'off' && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }),
  tempo: safe((value) => {
    bpm = Math.min(150, Math.max(90, value));
  }),
  /** The record scratch: the music stops for `sec` seconds, then it's back. */
  cut: safe((sec) => {
    if (!ctx) return;
    cutUntil = ctx.currentTime + sec;
    duck.gain.cancelScheduledValues(ctx.currentTime);
    duck.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    duck.gain.setTargetAtTime(1, ctx.currentTime + sec, 0.08);
  }),
  /** Back at once (a reload in the middle of a drop, a new round). */
  uncut: safe(() => {
    if (!ctx) return;
    cutUntil = 0;
    duck.gain.cancelScheduledValues(ctx.currentTime);
    duck.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
  }),
};

export const isOn = () => Boolean(ctx) && !dead;
