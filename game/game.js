// The page's game: your own dancer (simulated here, at 60 Hz), the screens, the effects and the sounds, all driven by the room.
// The host's page also runs the rules (net.js -> engine.js); everyone's page draws from the same record, so a reload or a change of
// host carries on. Per-round things are keyed by the round's id and thrown away when it changes.
import { BANNER_MS, GO_MS, PLAYER_COLORS, SETTINGS, fellCode, makeFloor, rankMatch, roundSpawns, timeline } from './rules.js';
import { DT, FALL_TIME, applyKnock, newChar, newFloor, onFloor, pushContact, resetChar, separate, snapToFloor, startFall, stepChar } from './sim.js';
import { isBotId } from './engine.js';
import { newBrain, think } from './bots.js';
import { makeRng, strSeed } from './rng.js';
import { View, drawActors, drawBackdrop, drawFloor, drawSpeakers } from './draw.js';
import * as ui from './ui.js';
import { fx } from './fx.js';
import { isOn, music, sfx, unlock } from './audio.js';
import { createInput } from './input.js';
import { JOIN, createNet } from './net.js';
import { clamp } from './theme.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const BPM = { chill: 112, normal: 124, fast: 136 };

const newActor = (id) => ({
  id, name: '', x: 0, y: 0, vx: 0, vy: 0, ang: Math.PI / 2, ps: false, kn: false, gh: false, st: 0, ft: 0, age: 9, color: '#fff',
  bot: false, me: false, av: null, seed: 0, ready: false, readyAge: 9, hop: 0, you: -1, noTag: false,
});

export class Game {
  constructor({ ow, room, canvas }) {
    this.ow = ow;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = new View();
    this.input = createInput(() => this.ow.controls);
    this.me = newChar(6, 4);
    this.floorSim = newFloor();
    this.lobbyFloor = newFloor();
    this.fl = { kind: 'party', t: 0, beat: 0, popT: 99, colors: null, call: 0, dropT: -1, warn: 0 };
    this.clock = 0; // animation time, seconds
    this.last = 0;
    this.acc = 0;
    this.freezeUntil = 0;
    this.titleUp = true;
    this.lobbyHidden = false;
    this.flash = 0;
    this.closed = null;
    this.stats = { matches: 0, wins: 0, pushes: 0 };
    this.avatars = new Map();
    this.pool = new Map(); // id -> the actor drawn for them
    this.fxs = new Map(); // id -> what this page remembers about them this round (keyed by the round: cleared when it changes)
    this.entries = new Map();
    this.actors = [];
    this.others = [];
    this.lastHit = new Map();
    this.floorKey = '';
    this.fd = null;
    this.tl = null;
    this.g = null;
    this.scene = 'lobby';
    this.phase = 'lobby';
    this.prevPhase = 'lobby';
    this.sceneAt = 0;
    this.matchNow = 0;
    this.spectating = false;
    this.popT = 99;
    this.dropT = -1;
    this.warn = 0;
    this.callAge = -1;
    this.frac = 1;
    this.rid = '';
    this.stepKey = '';
    this.phaseKey = '';
    this.decided = '';
    this.fcode = 0;
    this.pc = 0;
    this.pushed = false;
    this.roundAt = 0;
    this.outAt = -9;
    this.pushBuf = 0;
    this.prevPush = false;
    this.cdNum = 9;
    this.goMid = '';
    this.fired = { rise: false, call: false, drop: false, tick: 9 };
    this.spawns = [];
    this.lastG = null;
    this.results = null;
    this.finalAt = 0;
    this.nextRain = 0;
    this.savedMid = '';
    this.boardKey = '';
    this.boardRows = [];
    this.musicMode = '';
    this.bpm = 124;
    this.controlsKey = '';
    this.errors = 0;
    this.chips = null;
    this.chipsOn = false;
    this.playRect = null;
    this.closedRect = null;
    this.settingList = SETTINGS.map((s) => ({ id: s.id, label: s.label, text: '' }));
    this.demo = [];
    this.demoActors = [];
    this.tmpBot = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, fl: 0 };
    this.brainOut = { ix: 0, iy: 0, push: false };
    this.aim = { x: 0, y: 0 };
    this.demoCtx = { phase: 'free', step: 0, now: 0, ca: 0, colors: null, call: 0, chars: [], n: 0 };
    this.initDemo();
    this.bindRoom(room);
  }

  // ---------------------------------------------------------------- the room
  bindRoom(room) {
    this.net?.destroy();
    this.room = room;
    this.meId = room.me.id;
    this.net = createNet(this.ow, room, { onKnock: (dx, dy, by) => this.knocked(dx, dy, by) });
    this.rid = '';
    this.stepKey = '';
    this.phaseKey = '';
    this.fxs.clear();
    this.prevPhase = room.match.phase;
    this.me.id = this.meId;
    const spot = this.lobbySpot();
    resetChar(this.me, spot.x, spot.y);
    room.on('starting', () => {
      this.cdNum = 9;
      this.results = null;
      this.lastG = null;
    });
    room.on('matchend', () => {
      this.pushBuf = 0;
    });
    room.on('close', (reason) => {
      if (room !== this.room) return;
      if (reason === 'kicked' || reason === 'disconnected' || reason === 'replaced') this.closed = reason;
    });
  }

  async rejoin() {
    this.closed = null;
    try {
      const room = await this.ow.rooms.join(JOIN);
      this.titleUp = false;
      this.bindRoom(room);
    } catch {
      this.closed = 'disconnected';
    }
  }

  // ---------------------------------------------------------------- boot
  start() {
    const ow = this.ow;
    this.applyLevel();
    this.resize();
    addEventListener('resize', () => this.resize());
    try {
      ow.settings.on('change', () => {
        this.applyLevel();
        this.resize();
      });
    } catch {
      // settings events are optional
    }
    this.canvas.addEventListener('pointerdown', (e) => this.tap(e.clientX, e.clientY));
    // iPhones start sound on the lift of a tap, not the touch: ask again then
    for (const type of ['pointerup', 'touchend', 'click']) {
      addEventListener(type, () => {
        unlock();
        this.applyMusic(true);
      });
    }
    addEventListener('keydown', (e) => {
      unlock();
      if (this.titleUp && !e.repeat && (e.code === 'Enter' || e.code === 'Space')) this.play();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) unlock();
    });
    try {
      ow.save
        .get('stats')
        .then((v) => {
          if (isObj(v)) {
            this.stats = {
              matches: Math.max(0, Math.round(Number(v.matches)) || 0),
              wins: Math.max(0, Math.round(Number(v.wins)) || 0),
              pushes: Math.max(0, Math.round(Number(v.pushes)) || 0),
            };
          }
        })
        .catch(() => {});
    } catch {
      // saves are optional
    }
    const loop = (ts) => {
      requestAnimationFrame(loop);
      try {
        this.tick(ts);
      } catch (err) {
        if (this.errors++ < 3) queueMicrotask(() => { throw err; }); // reported to the creator; the loop carries on
      }
    };
    requestAnimationFrame(loop);
  }

  applyLevel() {
    const s = this.ow.settings;
    fx.setLevel(s.quality, s.reducedMotion);
    this.view.calm = Boolean(s.reducedMotion);
  }

  resize() {
    const w = Math.max(200, window.innerWidth || 800);
    const h = Math.max(160, window.innerHeight || 450);
    const pr = this.ow.settings.pixelRatio?.(2) ?? Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * pr);
    this.canvas.height = Math.round(h * pr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view.resize(w, h, pr);
    this.layout(0);
    this.view.snap();
  }

  /** Where the floor goes: roomy between the settings and the Ready strip in the lobby, under the call HUD in a match. */
  layout(dt) {
    const view = this.view;
    const u = ui.unit(view);
    if (this.inMatchScene()) {
      view.fit(ui.hudMetrics(view).height + (this.spectating ? 30 * u : 0), 18 * u);
    } else {
      view.fit(66 * u, 94 * u);
    }
    if (dt > 0) view.glide(dt);
  }

  inMatchScene() {
    return this.scene === 'step' || this.scene === 'end' || this.scene === 'board' || this.scene === 'final';
  }

  // ---------------------------------------------------------------- input
  tap(x, y) {
    unlock();
    this.applyMusic(true);
    if (this.closed) {
      if (this.closedRect && inside(this.closedRect, x, y)) this.rejoin();
      return;
    }
    if (this.titleUp) {
      this.play();
      return;
    }
    if (this.chipsOn && this.chips && this.room.isHost) {
      for (let i = 0; i < this.chips.count; i++) {
        const r = this.chips.rects[i];
        if (inside(r, x, y)) {
          this.cycleSetting(r.id);
          return;
        }
      }
    }
  }

  cycleSetting(id) {
    const s = SETTINGS.find((e) => e.id === id);
    if (!s) return;
    const values = s.options.map((o) => (isObj(o) ? o.value : o));
    const next = values[(values.indexOf(this.room.settings[id]) + 1) % values.length];
    this.room.setSetting(id, next);
    sfx.pop(1.1);
  }

  play() {
    if (!this.titleUp) return;
    this.titleUp = false;
    unlock();
    this.applyMusic(true);
    this.room.hideLobby(false);
    this.roundAt = this.clock;
    sfx.pop(1.2);
  }

  // ---------------------------------------------------------------- one frame
  tick(ts) {
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 1 / 60;
    this.last = ts;
    this.clock += dt;
    this.observe();
    this.syncControls();
    const frozen = ts < this.freezeUntil;
    if (!frozen) {
      this.acc += dt;
      let n = 0;
      const inp = this.input.read();
      if (inp.push && !this.prevPush) this.pushBuf = 0.15;
      this.prevPush = inp.push;
      while (this.acc >= DT && n < 6) {
        this.simStep(inp);
        this.acc -= DT;
        n++;
      }
      if (n >= 6) this.acc = 0;
    }
    if (this.titleUp && this.scene === 'lobby') this.stepDemo();
    this.buildActors();
    this.publish();
    this.net.hostTick();
    if (!frozen) fx.update(dt);
    this.layout(dt);
    this.draw();
  }

  /** What controls the screen asks for: the stick and Push while you can move, nothing on the title, the results and for watchers. */
  syncControls() {
    const want = this.titleUp || this.spectating || this.scene === 'board' || this.scene === 'final' ? '' : 'play';
    if (want === this.controlsKey) return;
    this.controlsKey = want;
    try {
      this.ow.controls.set(want ? { stick: 'analog', buttons: [{ id: 'push', label: 'Push', key: ' ' }] } : null);
    } catch {
      // controls are optional
    }
  }

  // ---------------------------------------------------------------- reading the room
  floorData(g) {
    const key = `${g.ss}:${g.step}:${g.na}`;
    if (key !== this.floorKey || !this.fd) {
      this.fd = makeFloor(g.ss, g.step, g.na);
      this.floorKey = key;
    }
    return this.fd;
  }

  participating() {
    return this.room.match.phase === 'playing' && this.room.isParticipant();
  }

  observe() {
    const { room, ow } = this;
    const m = room.match;
    const phase = m.phase;
    this.phase = phase;
    this.matchNow = room.matchNow();
    this.net.sync();
    this.spectating = room.spectating;
    const g = phase === 'playing' ? this.net.g() : null;
    this.g = g;
    if (phase !== this.prevPhase) {
      this.onPhase(phase, this.prevPhase);
      this.prevPhase = phase;
    }
    if (this.titleUp && phase === 'lobby' && !this.lobbyHidden) {
      room.hideLobby(true);
      this.lobbyHidden = true;
    } else if (!this.titleUp) {
      this.lobbyHidden = false;
    }
    // the countdown's beeps, and the GO!
    if (phase === 'starting' && fin(m.startsAt)) {
      const left = m.startsAt - ow.now();
      const num = left > 0 ? Math.min(3, Math.ceil(left / 1000)) : 0;
      if (num !== this.cdNum && left > -300) {
        this.cdNum = num;
        sfx.count(num);
      }
    }
    if (phase === 'playing' && this.goMid !== m.id) {
      this.goMid = m.id;
      if (fin(m.startsAt) && ow.now() - m.startsAt < 1500 && this.cdNum !== 0) sfx.count(0);
    }
    let scene = 'lobby';
    if (phase === 'playing') scene = !g || this.matchNow + 60 < g.rs ? 'wait' : g.phase;
    if (scene !== this.scene) {
      this.scene = scene;
      this.sceneAt = this.clock;
    }
    if (g && scene !== 'wait') {
      if (g.rid !== this.rid) this.onNewRound(g);
      this.syncStep(g);
    } else {
      this.floorSim.voidOn = false;
    }
    this.applyMusic(false);
    if (this.scene === 'final' && this.clock > this.nextRain) {
      this.nextRain = this.clock + 0.16;
      fx.confetti(6, -1.2, 7, 12);
    }
  }

  onPhase(phase, prev) {
    if (phase === 'playing' && prev !== 'playing') {
      this.pc = 0;
      this.results = null;
    }
    if (phase === 'lobby' && prev !== 'lobby') this.enterLobby(prev);
  }

  /** Back in the arena (a match ended, or its countdown was stopped): on your feet, with the results card still up for a while. */
  enterLobby(prev) {
    this.rid = '';
    this.stepKey = '';
    this.phaseKey = '';
    this.decided = '';
    this.fcode = 0;
    this.fxs.clear();
    fx.reset();
    music.uncut();
    this.bpm = 124;
    if (prev === 'playing') {
      const spot = this.lobbySpot();
      resetChar(this.me, spot.x, spot.y);
    }
    this.roundAt = this.clock;
    if (prev === 'playing' && this.lastG && this.lastG.phase === 'final') this.results = { g: this.lastG, at: this.clock };
    this.lastG = null;
  }

  lobbySpot() {
    const ids = [...this.room.players.keys()].sort();
    const i = Math.max(0, ids.indexOf(this.meId));
    return { x: 1.6 + (i % 5) * 2.2, y: 2.2 + (Math.floor(i / 5) % 3) * 2.1 };
  }

  onNewRound(g) {
    this.rid = g.rid;
    this.stepKey = '';
    this.phaseKey = '';
    this.decided = '';
    this.fcode = 0;
    this.pushed = false;
    this.roundAt = this.clock;
    this.fxs.clear();
    fx.reset();
    music.uncut();
    this.spawns = roundSpawns(g.sd, g.round, g.ids.length);
    this.bpm = BPM[g.speed] ?? 124;
    music.tempo(this.bpm);
    if (this.participating()) {
      const idx = g.ids.indexOf(this.meId);
      if (idx >= 0) {
        const sp = this.spawns[idx] ?? { x: 6, y: 4 };
        const pr = this.room.me.presence;
        // a reload in the middle of a round puts you back where you were
        const back = isObj(pr) && pr.rn === g.round && fin(pr.x) && fin(pr.y);
        resetChar(this.me, back ? clamp(pr.x, 0.4, 11.6) : sp.x, back ? clamp(pr.y, 0.4, 7.6) : sp.y);
        if (back && pr.gh === true) {
          this.me.st = 2;
          this.fcode = fin(pr.f) ? pr.f : 0;
        }
        if (g.out[this.meId] !== undefined) this.me.st = 2;
      }
    }
    sfx.pop(0.9);
  }

  /** The match's record, this frame: the floor, the clocks of the step, the sounds that go with them, and your verdict. */
  syncStep(g) {
    const now = this.matchNow;
    const me = this.me;
    if (g.phase === 'step') {
      const tl = timeline(g);
      const fd = this.floorData(g);
      this.tl = tl;
      this.floorSim.stand = fd.stand;
      this.floorSim.voidOn = now >= tl.da;
      this.popT = Math.max(0, (now - (g.step === 1 ? g.rs : g.fa)) / 1000);
      this.dropT = now >= tl.da ? (now - tl.da) / 1000 : -1;
      this.warn = now >= g.ca && now < tl.da && tl.da - now < 450 ? 1 - (tl.da - now) / 450 : 0;
      this.callAge = now >= g.ca ? (now - g.ca) / 1000 : -1;
      this.frac = now >= g.ca ? clamp((tl.da - now) / (tl.da - g.ca), 0, 1) : 1;
      this.stepEdges(g, tl, fd, now);
      this.decide(g, tl, now);
    } else {
      this.floorSim.voidOn = false;
      this.tl = null;
      this.phaseEdges(g);
    }
    // the host says you're out and your page didn't: fall (a close call decided from where you stood)
    if (this.participating() && me.st === 0 && g.out[this.meId] !== undefined) {
      startFall(me);
      this.outAt = this.clock;
    }
  }

  /** The sounds and shakes of a step, once each: the floor coming up, the call, the ticks, the drop. */
  stepEdges(g, tl, fd, now) {
    const key = `${g.rid}.${g.step}`;
    const f = this.fired;
    if (key !== this.stepKey) {
      this.stepKey = key;
      f.rise = f.call = f.drop = false;
      f.tick = 9;
    }
    const start = g.step === 1 ? g.rs : g.fa;
    if (!f.rise && now >= start) {
      f.rise = true;
      if (g.step > 1 && now - start < 500) sfx.rise();
    }
    if (!f.call && now >= g.ca) {
      f.call = true;
      if (now - g.ca < 500) sfx.call(fd.call);
    }
    if (now >= g.ca && now < tl.da) {
      const k = Math.floor((tl.da - now) / 350);
      if (k < 3 && k !== f.tick) {
        f.tick = k;
        sfx.tick(k);
      }
    }
    if (!f.drop && now >= tl.da) {
      f.drop = true;
      if (now - tl.da < 700) {
        sfx.drop();
        music.cut(1.0);
        fx.shake(0.45);
        if (!fx.calm) this.flash = 0.35;
      }
    }
  }

  /** The drop, from this page's own dancer: over a tile that stays, or falling. */
  decide(g, tl, now) {
    const key = `${g.rid}.${g.step}`;
    if (now < tl.da || this.decided === key) return;
    this.decided = key;
    const me = this.me;
    if (!this.participating() || g.res >= g.step || me.st !== 0) return;
    if (onFloor(this.floorSim, me.x, me.y, 0.1)) {
      snapToFloor(this.floorSim, me);
      fx.text(me.x, me.y - 1.5, 'SAFE!', '#7dff9e', 24);
      sfx.star();
    } else {
      startFall(me);
      this.fcode = fellCode(g.round, g.step);
      this.outAt = this.clock;
      this.freezeUntil = performance.now() + 90;
      this.net.fell(g.rid, g.step);
    }
  }

  /** The round's end, the scoreboard and the podium, once each. */
  phaseEdges(g) {
    const key = `${g.rid}.${g.phase}`;
    if (key === this.phaseKey) return;
    this.phaseKey = key;
    if (g.phase === 'end') {
      sfx.win();
      music.uncut();
      for (const id of g.win) {
        const a = this.pool.get(id);
        if (a) fx.burst(a.x, a.y - 0.6, 22);
      }
      fx.confetti(6, -1, 36, 12);
      if (this.participating()) {
        const survived = g.out[this.meId] !== undefined ? g.out[this.meId] - 1 : g.step;
        if (survived >= 15) this.award('survivor');
        if (g.win.includes(this.meId) && !this.pushed) this.award('untouchable');
      }
    } else if (g.phase === 'board') {
      sfx.star();
    } else if (g.phase === 'final') {
      this.finalAt = this.clock;
      this.lastG = g;
      sfx.fanfare();
      fx.confetti(6, -1, 50, 12);
      this.finishMatch(g);
    }
  }

  award(id) {
    try {
      this.ow.badges.award(id)?.catch?.(() => {});
    } catch {
      // badges are optional
    }
  }

  /** Once per match: your stats, your badges and the leaderboard. */
  finishMatch(g) {
    if (this.savedMid === g.mid || !this.participating()) return;
    this.savedMid = g.mid;
    const mine = rankMatch(g.ids, g.scores, g.sv).find((e) => e.id === this.meId);
    if (!mine) return;
    const stats = { matches: this.stats.matches + 1, wins: this.stats.wins + (mine.place === 1 ? 1 : 0), pushes: this.stats.pushes + this.pc };
    this.stats = stats;
    try {
      this.ow.save.set('stats', stats)?.catch?.(() => {});
    } catch {
      // saves are optional
    }
    if (mine.place === 1) {
      this.award('first-win');
      try {
        this.ow.leaderboards.submit('wins', stats.wins)?.catch?.(() => {});
      } catch {
        // boards are optional
      }
    }
    if (stats.matches >= 10) this.award('party-animal');
  }

  applyMusic(force) {
    if (!isOn()) return;
    const mode = this.scene === 'step' ? 'play' : 'menu';
    if (!force && mode === this.musicMode) return;
    this.musicMode = mode;
    music.tempo(this.bpm);
    music.mode(mode);
  }

  // ---------------------------------------------------------------- your dancer
  /** A knock from a shove (the room told this page): it only lands on a dancer on their feet who the pusher is next to. */
  knocked(dx, dy, by) {
    const me = this.me;
    if (me.st !== 0 || this.spectating) return;
    const a = this.pool.get(by);
    if (a && Math.hypot(a.x - me.x, a.y - me.y) > 2.6) return;
    if (applyKnock(me, dx, dy) && this.g && this.g.phase === 'step') this.pushed = true;
  }

  canMove() {
    if (this.spectating) return false;
    return true;
  }

  simStep(inp) {
    const me = this.me;
    let ix = 0;
    let iy = 0;
    let push = false;
    if (this.canMove()) {
      ix = inp.x;
      iy = inp.y;
      push = this.pushBuf > 0;
    }
    if (this.pushBuf > 0) this.pushBuf -= DT;
    if (this.spectating) return;
    if (push && me.st === 0 && me.cd <= 0 && me.pushT <= 0 && me.knockT <= 0) {
      // a little help aiming: a shove from standing still, or toward someone close, goes at them
      const aim = this.aimAt(me, ix, iy);
      if (aim) {
        ix = aim.x;
        iy = aim.y;
      }
    }
    stepChar(me, ix, iy, push, DT, this.floorSim);
    if (me.evPush) {
      me.evPush = false;
      this.pushBuf = 0;
    }
    if (me.st !== 0) return;
    separate(me, this.others, this.others.length, this.floorSim, 1);
    if (me.pushT > 0) {
      for (let i = 0; i < this.others.length; i++) {
        const o = this.others[i];
        if (me.hits.includes(o.id) || !pushContact(me, o.x, o.y)) continue;
        me.hits.push(o.id);
        this.net.push(o.id, o.x - me.x, o.y - me.y);
        this.hitLanded(o);
      }
    }
  }

  /** The direction to the nearest dancer within reach of a shove, if you're standing still or already heading roughly their way. */
  aimAt(me, ix, iy) {
    const len = Math.hypot(ix, iy);
    let best = null;
    let bestD = 1.9;
    for (let i = 0; i < this.others.length; i++) {
      const o = this.others[i];
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3 || d >= bestD) continue;
      if (len > 0.25 && (dx * ix + dy * iy) / (d * len) < 0.5) continue;
      bestD = d;
      best = o;
    }
    if (!best) return null;
    const dx = best.x - me.x;
    const dy = best.y - me.y;
    this.aim.x = dx / bestD;
    this.aim.y = dy / bestD;
    return this.aim;
  }

  /** Your shove reached someone: stars, a boing and a tiny freeze, right now. */
  hitLanded(o) {
    fx.stars(o.x, o.y, 6);
    fx.sparks(o.x, o.y, 6);
    sfx.boing();
    fx.shake(0.16);
    this.freezeUntil = performance.now() + 60;
    this.lastHit.set(o.id, this.clock);
    if (this.g && this.g.phase === 'step') this.pc = Math.min(999, this.pc + 1);
  }

  /** Tells the room where you are (the SDK sends at most 20 a second). */
  publish() {
    if (this.spectating) return;
    const inMatch = this.phase === 'playing';
    if (!inMatch && this.titleUp) return; // still on the title: not in the arena yet
    const me = this.me;
    const rn = this.g && this.g.rid === this.rid ? this.g.round : 0;
    const L = this.net.local;
    L.x = me.x;
    L.y = me.y;
    L.gh = me.st !== 0;
    L.f = this.fcode;
    L.pc = this.pc;
    this.room.setPresence({
      x: r2(me.x),
      y: r2(me.y),
      vx: r1(me.vx),
      vy: r1(me.vy),
      a: r2(Math.atan2(me.fy, me.fx)),
      ps: me.pushT > 0,
      kn: me.knockT > 0,
      gh: me.st !== 0,
      f: this.fcode,
      pc: this.pc,
      rn,
    });
  }

  // ---------------------------------------------------------------- everyone on the floor
  initDemo() {
    for (let i = 0; i < 6; i++) {
      const c = newChar(1.6 + (i % 3) * 4.2, 1.8 + Math.floor(i / 3) * 3.6);
      c.id = `demo${i}`;
      this.demo.push({ c, brain: newBrain(makeRng(900 + i * 7)) });
      this.demoActors.push(newActor(`demo${i}`));
    }
  }

  stepDemo() {
    const ctx = this.demoCtx;
    ctx.now = this.clock * 1000;
    ctx.chars.length = 0;
    for (const d of this.demo) ctx.chars.push(d.c);
    ctx.n = ctx.chars.length;
    const out = this.brainOut;
    // a fixed step per frame is plenty for background dancers
    for (const d of this.demo) {
      think(d.brain, d.c, ctx, out);
      stepChar(d.c, out.ix, out.iy, false, 1 / 60, this.lobbyFloor);
      separate(d.c, ctx.chars, ctx.n, this.lobbyFloor, 3);
    }
  }

  avatar(id) {
    let e = this.avatars.get(id);
    if (e) return e.img;
    e = { img: null };
    this.avatars.set(id, e);
    try {
      this.ow.player
        .avatarUrl(id, 'head')
        .then((url) => {
          if (!url) return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onerror = () => {
            if (e.img === img) e.img = null;
          };
          img.src = url;
          e.img = img;
        })
        .catch(() => {});
    } catch {
      // avatars are optional
    }
    return null;
  }

  colorIndex(id, g, sorted) {
    if (g) {
      const i = g.ids.indexOf(id);
      return i < 0 ? 0 : i;
    }
    return Math.max(0, sorted.indexOf(id));
  }

  pooled(id) {
    let a = this.pool.get(id);
    if (!a) {
      a = newActor(id);
      this.pool.set(id, a);
    }
    return a;
  }

  /** Fills `this.actors` (everyone to draw, with what they're doing) and `this.others` (the ones you can bump and push). */
  buildActors() {
    const list = this.actors;
    const others = this.others;
    list.length = 0;
    others.length = 0;
    const scene = this.scene;
    if (scene === 'board' || scene === 'final') return;
    if (this.titleUp && scene === 'lobby') {
      this.demo.forEach((d, i) => {
        const a = this.demoActors[i];
        a.x = d.c.x;
        a.y = d.c.y;
        a.vx = d.c.vx;
        a.vy = d.c.vy;
        a.ang = Math.atan2(d.c.fy, d.c.fx);
        a.color = PLAYER_COLORS[(i * 2 + 1) % 12];
        a.bot = true;
        a.noTag = true;
        a.seed = 40 + i * 13;
        a.age = 9;
        a.st = 0;
        list.push(a);
      });
      return;
    }
    const g = scene === 'step' || scene === 'end' ? this.g : null;
    const sorted = g ? null : [...this.room.players.keys()].sort();
    const ids = g ? g.ids : sorted;
    const now = this.matchNow;
    const dt = 1 / 60;
    for (let idx = 0; idx < ids.length; idx++) {
      const id = ids[idx];
      const isMe = id === this.meId;
      if (isMe && this.spectating) continue;
      const bot = isBotId(id);
      if (!isMe && !bot && !this.room.players.has(id)) continue; // gone from the room: not on the floor any more
      const a = this.pooled(id);
      a.me = isMe;
      a.bot = bot;
      a.noTag = false;
      let ok = true;
      if (isMe) {
        const me = this.me;
        a.x = me.x;
        a.y = me.y;
        a.vx = me.vx;
        a.vy = me.vy;
        a.ang = Math.atan2(me.fy, me.fx);
        a.ps = me.pushT > 0;
        a.kn = me.knockT > 0;
        a.gh = me.st !== 0;
      } else if (bot) {
        const v = this.tmpBot;
        ok = Boolean(g) && this.net.botView(g, id, now - 190, v);
        if (ok) {
          a.x = v.x;
          a.y = v.y;
          a.vx = v.vx;
          a.vy = v.vy;
          a.ang = v.ang;
          a.ps = (v.fl & 1) !== 0;
          a.kn = (v.fl & 2) !== 0;
          a.gh = (v.fl & 4) !== 0 || g.out[id] !== undefined;
        } else {
          this.atSpawn(a, idx);
        }
      } else {
        const pr = this.room.presenceAt(id, { angles: ['a'], snap: 3 });
        const raw = this.room.players.get(id)?.presence;
        const stale = g ? !isObj(raw) || raw.rn !== g.round : false;
        if (!isObj(pr) || !fin(pr.x) || !fin(pr.y)) {
          if (g) this.atSpawn(a, idx);
          else continue; // nobody to draw yet
        } else if (stale) {
          this.atSpawn(a, idx);
        } else {
          a.x = clamp(pr.x, -1, 13);
          a.y = clamp(pr.y, -1, 9);
          a.vx = fin(pr.vx) ? pr.vx : 0;
          a.vy = fin(pr.vy) ? pr.vy : 0;
          a.ang = fin(pr.a) ? pr.a : Math.PI / 2;
          a.ps = pr.ps === true;
          a.kn = pr.kn === true;
          a.gh = isObj(raw) && raw.gh === true;
        }
        if (g && g.out[id] !== undefined) a.gh = true;
      }
      a.name = this.net.name(id, g);
      a.av = bot ? null : this.avatar(id);
      a.color = PLAYER_COLORS[this.colorIndex(id, g, sorted) % PLAYER_COLORS.length];
      a.seed = strSeed(id) & 0xffff;
      a.ready = !g && this.phase !== 'playing' && this.room.players.get(id)?.ready === true;
      a.hop = scene === 'end' && g && g.win.includes(id) ? 1 : 0;
      a.you = a.me && !this.titleUp && (scene === 'step' || scene === 'lobby' || scene === 'wait') ? this.clock - this.roundAt : -1;
      this.track(a, dt);
      list.push(a);
      if (!isMe && a.st === 0) others.push(a);
    }
  }

  atSpawn(a, idx) {
    const sp = this.spawns[idx] ?? { x: 6, y: 4 };
    a.x = sp.x;
    a.y = sp.y;
    a.vx = a.vy = 0;
    a.ps = a.kn = a.gh = false;
  }

  /** What this page remembers about a dancer: when they appeared, fell, pushed, were knocked. Turns flags into sounds and effects, once. */
  track(a, dt) {
    let f = this.fxs.get(a.id);
    if (!f) {
      f = { gh: a.gh, fellAt: a.gh ? -99 : 0, ps: false, kn: false, spawnAt: this.clock, dust: 0, ready: false, readyAt: -9 };
      this.fxs.set(a.id, f);
    }
    if (a.gh && !f.gh) {
      f.gh = true;
      f.fellAt = this.clock;
      this.onFall(a);
    } else if (!a.gh && f.gh) {
      f.gh = false;
    }
    if (a.ps && !f.ps) {
      f.ps = true;
      sfx.push(a.me ? 1 : 0.45);
    } else if (!a.ps) {
      f.ps = false;
    }
    if (a.kn && !f.kn) {
      f.kn = true;
      this.onKnockFx(a);
    } else if (!a.kn) {
      f.kn = false;
    }
    a.ft = f.gh ? this.clock - f.fellAt : 0;
    a.st = !f.gh ? 0 : a.ft < FALL_TIME ? 1 : 2;
    a.age = this.clock - f.spawnAt;
    if (a.st === 0 && Math.hypot(a.vx, a.vy) > 3) {
      f.dust -= dt;
      if (f.dust <= 0) {
        fx.dust(a.x, a.y);
        f.dust = 0.1;
      }
    }
    if (a.ready && !f.ready) {
      f.ready = true;
      f.readyAt = this.clock;
      if (!a.me) sfx.ready();
    } else if (!a.ready) {
      f.ready = false;
    }
    a.readyAge = this.clock - f.readyAt;
  }

  onFall(a) {
    fx.puff(a.x, a.y, a.me ? 16 : 10);
    fx.ring(a.x, a.y, '#fff', 1.1);
    sfx.fall(a.me ? 1 : 0.45);
    if (a.me) fx.shake(0.5);
  }

  onKnockFx(a) {
    fx.stars(a.x, a.y, 5);
    if (a.me) {
      sfx.boing();
      fx.shake(0.22);
    } else if (this.clock - (this.lastHit.get(a.id) ?? -9) > 0.7) {
      sfx.boing(0.45);
    }
  }

  // ---------------------------------------------------------------- drawing
  entryFor(id, g, score = 0, pts = 0) {
    let e = this.entries.get(id);
    if (!e) {
      e = { id, name: '', av: null, color: '#fff', seed: 0, bot: false, me: false, score: 0, pts: 0 };
      this.entries.set(id, e);
    }
    e.bot = isBotId(id);
    e.me = id === this.meId;
    e.name = this.net.name(id, g);
    e.av = e.bot ? null : this.avatar(id);
    e.color = PLAYER_COLORS[Math.max(0, g.ids.indexOf(id)) % PLAYER_COLORS.length];
    e.seed = strSeed(id) & 0xffff;
    e.score = score;
    e.pts = pts;
    return e;
  }

  beat() {
    const p = (this.clock * (this.bpm / 60)) % 1;
    return Math.exp(-p * 5) * (this.ow.settings.reducedMotion ? 0.25 : 1);
  }

  draw() {
    const { ctx, view } = this;
    const pr = view.pr;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.globalAlpha = 1;
    const t = this.clock;
    const beat = this.beat();
    drawBackdrop(ctx, view, t, beat);
    const scene = this.scene;
    const g = this.g;
    const fl = this.fl;
    fl.t = t;
    fl.beat = beat;
    if (scene === 'step' && this.fd) {
      fl.kind = 'match';
      fl.colors = this.fd.colors;
      fl.call = this.fd.call;
      fl.popT = this.popT;
      fl.dropT = this.dropT;
      fl.warn = this.warn;
    } else {
      fl.kind = 'party';
      fl.popT = scene === 'end' ? t - this.sceneAt : 99;
      fl.dropT = -1;
      fl.warn = 0;
    }
    ctx.save();
    const off = fx.offset(clamp(view.s * 0.35, 4, 14));
    ctx.translate(off.x, off.y);
    drawSpeakers(ctx, view, beat);
    drawFloor(ctx, view, fl);
    if (scene === 'lobby' && !this.titleUp && !this.results && this.phase === 'lobby') ui.drawFloorHint(ctx, view, 'Stand on the color!', t);
    drawActors(ctx, view, this.actors, t);
    fx.draw(ctx, view);
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(this.flash * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, view.w, view.h);
      this.flash = Math.max(0, this.flash - 0.06);
    }
    this.overlays(g, t);
  }

  overlays(g, t) {
    const { ctx, view, ow, room } = this;
    const scene = this.scene;
    const now = this.matchNow;
    const u = ui.unit(view);
    this.chipsOn = false;
    this.playRect = null;
    if (this.closed) {
      const msg = this.closed === 'kicked' ? 'You were removed' : this.closed === 'replaced' ? 'Playing in another tab' : 'Disconnected';
      const btn = this.closed === 'disconnected' ? 'REJOIN' : this.closed === 'replaced' ? 'PLAY HERE' : 'PLAY';
      this.closedRect = ui.drawClosed(ctx, view, msg, btn, t);
      return;
    }
    if (scene === 'lobby' || scene === 'wait') {
      if (scene === 'lobby' && !this.titleUp) {
        if (this.results && t - this.results.at < 7) {
          this.drawResults(this.results.g, t - this.results.at + 9, t);
        } else {
          this.results = null;
          for (let i = 0; i < this.settingList.length; i++) {
            const s = SETTINGS[i];
            const value = room.settings[s.id];
            const opt = s.options.find((o) => (isObj(o) ? o.value : o) === value);
            this.settingList[i].text = String(isObj(opt) ? opt.label : (opt ?? value));
          }
          this.chips = ui.drawSettings(ctx, view, this.settingList, room.isHost && this.phase === 'lobby', t);
          this.chipsOn = this.phase === 'lobby';
          if (this.phase === 'lobby' && !this.spectating) this.drawReadyCue(t);
        }
      }
    } else if (scene === 'step' && g) {
      const tl = this.tl;
      const call = this.fd && tl && now >= g.ca && now < tl.da + 700 ? this.fd.call : -1;
      const alive = g.ids.reduce((n, id) => n + (g.out[id] === undefined ? 1 : 0), 0);
      ui.drawHud(ctx, view, {
        t,
        round: g.round,
        rounds: g.rounds,
        call,
        callAge: this.callAge,
        frac: tl && now >= tl.da ? 0 : this.frac,
        warn: this.warn,
        alive,
        out: this.participating() && this.me.st !== 0,
        score: this.participating() ? (g.scores[this.meId] ?? 0) : null,
        top: this.spectating ? 30 * u : 0,
      });
      if (g.step === 1 && now < g.rs + BANNER_MS) {
        const last = g.rounds > 1 && g.round === g.rounds;
        ui.drawBanner(ctx, view, last ? 'FINAL ROUND' : `ROUND ${g.round}`, 'Stand on the color!', Math.max(0, (now - g.rs) / 1000), BANNER_MS / 1000);
      }
      if (this.participating() && this.me.st !== 0 && t - this.outAt < 1.1) ui.drawOut(ctx, view, t - this.outAt);
      if (this.spectating) ui.drawWatching(ctx, view);
    } else if (scene === 'end' && g) {
      const winners = g.win.map((id) => this.entryFor(id, g));
      ui.drawWinner(ctx, view, { winners, me: g.win.includes(this.meId) && this.participating(), age: t - this.sceneAt });
      if (this.spectating) ui.drawWatching(ctx, view);
    } else if (scene === 'board' && g) {
      const key = `${g.rid}.board`;
      if (key !== this.boardKey) {
        this.boardKey = key;
        this.boardRows = [...g.ids].sort((p, q) => (g.scores[q] ?? 0) - (g.scores[p] ?? 0));
      }
      const rows = this.boardRows.map((id) => this.entryFor(id, g, g.scores[id] ?? 0, g.pts[id] ?? 0));
      ui.drawBoard(ctx, view, { rows, age: t - this.sceneAt, round: g.round, rounds: g.rounds });
      if (this.spectating) ui.drawWatching(ctx, view);
    } else if (scene === 'final' && g) {
      this.drawResults(g, t - this.finalAt, t);
    }
    // the big countdown, then GO!
    const m = room.match;
    if (this.phase === 'starting' && fin(m.startsAt)) {
      const left = m.startsAt - ow.now();
      if (left > 0) {
        const num = Math.min(3, Math.ceil(left / 1000));
        ui.drawCountdown(ctx, view, num, 1 - (left - (num - 1) * 1000) / 1000);
      }
    } else if (this.phase === 'playing' && fin(m.startsAt)) {
      const since = ow.now() - m.startsAt;
      if (since >= 0 && since < GO_MS) ui.drawCountdown(ctx, view, 0, since / GO_MS);
    }
    if (this.titleUp) this.playRect = ui.drawTitle(ctx, view, t);
  }

  drawReadyCue(t) {
    const { room } = this;
    const hostOfFriends = room.isHost && room.kind !== 'public' && room.kind !== 'solo';
    if (hostOfFriends) {
      if (room.canStart) ui.drawReadyCue(this.ctx, this.view, 'START', t);
    } else if (!room.me.ready) {
      ui.drawReadyCue(this.ctx, this.view, 'READY?', t);
    }
  }

  drawResults(g, age, t) {
    const ranked = rankMatch(g.ids, g.scores, g.sv);
    const top = [0, 1, 2].map((i) => (ranked[i] ? this.entryFor(ranked[i].id, g, ranked[i].score) : null));
    const mine = ranked.find((e) => e.id === this.meId);
    const awards = [
      { kind: 'push', entry: g.aw?.push ? this.entryFor(g.aw.push, g, g.scores[g.aw.push] ?? 0) : null },
      { kind: 'lucky', entry: g.aw?.lucky ? this.entryFor(g.aw.lucky, g, g.scores[g.aw.lucky] ?? 0) : null },
    ];
    ui.drawPodium(this.ctx, this.view, { top, age, t, me: mine ? { place: mine.place } : null, awards });
  }
}
