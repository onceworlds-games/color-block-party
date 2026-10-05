// The host's engine: the rules of a whole match, round by round and step by step, plus the bots' bodies.
// Pure (no window, no platform): net.js runs it on the host's page and the tests run it with bots only.
//
// Everything the other pages need is in one plain record `g` (see `Engine.create`), replaced (never edited) on every change
// so net.js can write it to the room as it is. Deadlines are match milliseconds, so a pause or a change of host keeps them.
//
// The people are judged by what their own pages say (they fell, in a message or in their presence) with the host's own look
// at where they stand as a backup; bots are judged exactly at the drop from their own bodies. `H` (given to `update`) is how the
// engine sees the people: `H.info(id)` gives { x, y, gh, f, connected, pc } or null for someone who is not in the room.
import {
  BANNER_MS, BOARD_MS, END_MS, FINAL_MS, GO_MS, GRACE_MS, MAX_DANCERS, PRE_MS, SPEEDS, STEPS_MAX, TABLE,
  botNames, chooseStepSeed, computeAwards, fellCode, makeFloor, rankMatch, reactMs, roundResult, roundSpawns, timeline,
} from './rules.js';
import { DT, applyKnock, newChar, newFloor, onFloor, pushContact, separate, snapToFloor, startFall, stepChar } from './sim.js';
import { newBrain, think } from './bots.js';
import { hash32, makeRng, strSeed } from './rng.js';

const DT_MS = 1000 / 60;
const r2 = (v) => Math.round(v * 100) / 100;
const clampInt = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);

export const isBotId = (id) => typeof id === 'string' && /^bot\d{1,2}$/.test(id);

export class Engine {
  /** @param g the record this engine plays (see create) */
  constructor(g) {
    this.g = g;
    this.rev = 1;
    this.bots = new Map(); // bot id -> { c: its body, brain }
    this.floor = newFloor(); // what the bots' bodies walk on
    this.fk = '';
    this.fd = null;
    this.droppedKey = '';
    this.reported = {}; // human id -> the step they said they fell on
    this.simNow = -1;
    this.events = []; // pushes by bots on people: { t: 'push', by, to, dx, dy }
    this.proxies = new Map();
    this.chars = [];
    this.nChars = 0;
    this.pushTotals = {};
    this.spawns = [];
    this.ctx = { phase: 'pre', step: 1, now: 0, ca: 0, colors: null, call: 0, chars: this.chars, n: 0 };
    this.out = { ix: 0, iy: 0, push: false };
    this.ff = false;
    this.noFF = false; // tests turn the fast-forward off to watch every step
    this.H = null;
  }

  /**
   * A new match. The record `g`: mid (match id), by (the host's id), sd (seed), ids (the roster: people first, then bots),
   * bn (bot names), rounds, speed, round, rid, phase ('step' | 'end' | 'board' | 'final'), until (when a phase ends),
   * rs (the round began), step, ss (the floor's seed), na (dancers it was made for), fa (the floor appears), ca (the call),
   * res (the step that has been judged), out (id -> the step they fell on), scores, sv (steps survived), pts, place, win,
   * pu (pushes landed) and aw (awards).
   */
  static create({ mid, seed, humans, settings, me }) {
    const sd = strSeed(`${mid}:${seed}`);
    const people = [...humans].slice(0, MAX_DANCERS).sort();
    const nBots = Math.max(0, Math.min(TABLE, MAX_DANCERS) - people.length);
    const botIds = Array.from({ length: nBots }, (_, i) => `bot${i + 1}`);
    const names = botNames(sd, nBots);
    const bn = {};
    botIds.forEach((id, i) => (bn[id] = names[i]));
    const rounds = [1, 3, 5].includes(Number(settings?.rounds)) ? Number(settings.rounds) : 3;
    const speed = SPEEDS[settings?.speed] ? settings.speed : 'normal';
    const ids = [...people, ...botIds];
    const zero = Object.fromEntries(ids.map((id) => [id, 0]));
    return new Engine({
      mid, by: me, sd, ids, bn, rounds, speed, round: 0, rid: `${mid}.0`, phase: 'step', until: 0, rs: 0, step: 1, ss: 0, na: ids.length,
      fa: 0, ca: 0, res: 0, out: {}, scores: zero, sv: { ...zero },
    });
  }

  /** Takes over a match from the room's copy of it (a new host, a reloaded host). Bots carry on from their last snapshot `b`. */
  static adopt(g, b, me) {
    const engine = new Engine({ ...g, by: me });
    engine.rebuild(b);
    return engine;
  }

  /** Starts the first round: after the big GO! (so the first banner never sits under it). */
  start(now) {
    this.simNow = now;
    this.startRound(1, Math.max(now, GO_MS));
  }

  set(patch) {
    this.g = { ...this.g, ...patch };
    this.rev++;
  }

  /** The bots' bodies from a snapshot (or at their spawns). */
  rebuild(b) {
    const g = this.g;
    this.spawns = roundSpawns(g.sd, Math.max(1, g.round), g.ids.length);
    this.bots.clear();
    const snap = b && b.rid === g.rid && Array.isArray(b.p) ? b.p : null;
    let k = 0;
    g.ids.forEach((id, i) => {
      if (!isBotId(id)) return;
      const c = newChar(this.spawns[i].x, this.spawns[i].y);
      c.id = id;
      const p = snap ? snap[k] : null;
      k++;
      if (Array.isArray(p) && p.length >= 6 && p.every(Number.isFinite)) {
        c.x = Math.min(11.7, Math.max(0.3, p[0]));
        c.y = Math.min(7.7, Math.max(0.3, p[1]));
        c.vx = p[2];
        c.vy = p[3];
        c.fx = Math.cos(p[4]);
        c.fy = Math.sin(p[4]);
        if ((p[5] | 0) & 4) c.st = 2;
      }
      if (g.out?.[id] !== undefined) c.st = 2;
      this.bots.set(id, { c, brain: newBrain(makeRng(hash32(g.sd, Math.max(1, g.round) * 100 + i))) });
    });
  }

  floorData() {
    const g = this.g;
    const key = `${g.ss}:${g.step}:${g.na}`;
    if (key !== this.fk || !this.fd) {
      this.fd = makeFloor(g.ss, g.step, g.na);
      this.fk = key;
    }
    return this.fd;
  }

  startRound(n, now) {
    const g = this.g;
    this.spawns = roundSpawns(g.sd, n, g.ids.length);
    this.bots.clear();
    g.ids.forEach((id, i) => {
      if (!isBotId(id)) return;
      const c = newChar(this.spawns[i].x, this.spawns[i].y);
      c.id = id;
      this.bots.set(id, { c, brain: newBrain(makeRng(hash32(g.sd, n * 100 + i))) });
    });
    this.reported = {};
    this.droppedKey = '';
    this.floor.voidOn = false;
    const ss = chooseStepSeed(hash32(g.sd, n), 1, g.ids.length, this.spawns, reactMs(1, g.speed));
    this.set({
      round: n, rid: `${g.mid}.${n}`, phase: 'step', until: 0, rs: now, step: 1, ss, na: g.ids.length,
      fa: now + BANNER_MS, ca: now + BANNER_MS + PRE_MS, res: 0, out: {}, pts: undefined, win: undefined, place: undefined,
    });
  }

  /** Advances to `now` (match ms). Returns true once the podium has had its time and the match should be ended. */
  update(now, H) {
    this.H = H ?? null;
    if (this.simNow < 0) this.simNow = now;
    let n = 0;
    while (this.simNow + DT_MS <= now + 1e-6 && n < 12) {
      this.simNow += DT_MS;
      this.simBots(this.simNow);
      this.logic(this.simNow);
      n++;
    }
    if (this.simNow + DT_MS <= now) this.simNow = now; // far behind (a hidden page): skip, don't replay
    this.logic(now);
    return this.g.phase === 'final' && now >= this.g.until;
  }

  logic(t) {
    const g = this.g;
    if (g.phase === 'step') {
      const tl = timeline(g);
      if (g.res < g.step) {
        if (t >= tl.da + GRACE_MS) this.resolve(t);
      } else if (t >= tl.ea) {
        this.nextStep(t, tl);
      }
    } else if (g.phase === 'end') {
      if (t >= g.until) {
        if (g.round >= g.rounds) this.toFinal(t);
        else this.set({ phase: 'board', until: t + BOARD_MS });
      }
    } else if (g.phase === 'board') {
      if (t >= g.until) this.startRound(g.round + 1, t);
    }
  }

  // ------------------------------------------------------------------ the bots' bodies
  refreshChars() {
    const g = this.g;
    let n = 0;
    for (const b of this.bots.values()) this.chars[n++] = b.c;
    for (let i = 0; i < g.ids.length; i++) {
      const id = g.ids[i];
      if (isBotId(id)) continue;
      let p = this.proxies.get(id);
      if (!p) {
        p = newChar();
        p.id = id;
        this.proxies.set(id, p);
      }
      const info = this.H ? this.H.info(id) : null;
      if (info && Number.isFinite(info.x) && Number.isFinite(info.y)) {
        p.x = info.x;
        p.y = info.y;
      } else {
        p.x = this.spawns[i]?.x ?? 6;
        p.y = this.spawns[i]?.y ?? 4;
      }
      p.st = g.out[id] !== undefined || (info && info.gh === true) ? 2 : 0;
      this.chars[n++] = p;
    }
    this.nChars = n;
  }

  simBots(t) {
    const g = this.g;
    if (g.phase !== 'step' || this.bots.size === 0) return;
    const tl = timeline(g);
    const fl = this.floorData();
    const floor = this.floor;
    floor.stand = fl.stand;
    floor.voidOn = t >= tl.da;
    const key = `${g.rid}.${g.step}`;
    if (floor.voidOn && this.droppedKey !== key) {
      // the drop: a bot whose centre isn't over a tile that stays falls
      this.droppedKey = key;
      for (const b of this.bots.values()) {
        if (b.c.st !== 0) continue;
        if (onFloor(floor, b.c.x, b.c.y, 0.1)) snapToFloor(floor, b.c);
        else startFall(b.c);
      }
    }
    this.refreshChars();
    const ctx = this.ctx;
    ctx.phase = t < tl.ca ? 'pre' : t < tl.da ? 'call' : 'down';
    ctx.step = g.step;
    ctx.now = t;
    ctx.ca = tl.ca;
    ctx.colors = fl.colors;
    ctx.call = fl.call;
    ctx.chars = this.chars;
    ctx.n = this.nChars;
    const out = this.out;
    let salt = 1;
    for (const [id, b] of this.bots) {
      const c = b.c;
      think(b.brain, c, ctx, out);
      stepChar(c, out.ix, out.iy, out.push, DT, floor);
      c.evPush = false;
      if (c.st === 0) {
        separate(c, this.chars, this.nChars, floor, salt);
        if (c.pushT > 0) this.contacts(id, c);
      }
      salt++;
    }
  }

  /** A bot's shove: whoever its fists reach is knocked away (a person is told by an event, a bot is knocked here). */
  contacts(id, c) {
    for (let k = 0; k < this.nChars; k++) {
      const o = this.chars[k];
      if (o === c || o.st !== 0 || c.hits.includes(o) || !pushContact(c, o.x, o.y)) continue;
      c.hits.push(o);
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      if (isBotId(o.id)) {
        if (applyKnock(o, dx, dy)) this.pushTotals[id] = (this.pushTotals[id] ?? 0) + 1;
      } else {
        this.events.push({ t: 'push', by: id, to: o.id, dx: r2(dx), dy: r2(dy) });
        this.pushTotals[id] = (this.pushTotals[id] ?? 0) + 1;
      }
    }
  }

  /** A person's shove reached a bot. */
  knockBot(id, dx, dy) {
    const b = this.bots.get(id);
    return Boolean(b) && this.g.phase === 'step' && applyKnock(b.c, dx, dy);
  }

  takeEvents() {
    const list = this.events;
    this.events = [];
    return list;
  }

  /** A person says they fell on this step. */
  reportFell(id, step) {
    if (isBotId(id) || !this.g.ids.includes(id) || !Number.isInteger(step) || step !== this.g.step || this.g.phase !== 'step') return false;
    this.reported[id] = step;
    return true;
  }

  // ------------------------------------------------------------------ judging a drop
  posOf(id) {
    const b = this.bots.get(id);
    if (b) return b.c;
    const info = this.H ? this.H.info(id) : null;
    if (info && Number.isFinite(info.x) && Number.isFinite(info.y)) return info;
    return this.spawns[this.g.ids.indexOf(id)] ?? { x: 6, y: 4 };
  }

  resolve(t) {
    const g = this.g;
    const step = g.step;
    const out = { ...g.out };
    const probe = { voidOn: true, stand: this.floorData().stand };
    const code = fellCode(g.round, step);
    for (let i = 0; i < g.ids.length; i++) {
      const id = g.ids[i];
      if (out[id] !== undefined) continue;
      if (isBotId(id)) {
        const b = this.bots.get(id);
        if (!b || b.c.st !== 0) out[id] = step;
        continue;
      }
      const info = this.H ? this.H.info(id) : null;
      if (!info) {
        out[id] = step; // not in the room any more
        continue;
      }
      if (this.reported[id] === step || info.f === code || info.gh === true) {
        out[id] = step; // their own page says they fell
        continue;
      }
      // Silent: look at where they stand. Someone away stands where they were, exactly; someone connected only falls if
      // they are plainly over the dark (their own page decides the close calls).
      const sp = this.spawns[i] ?? { x: 6, y: 4 };
      const x = Number.isFinite(info.x) ? info.x : sp.x;
      const y = Number.isFinite(info.y) ? info.y : sp.y;
      if (!onFloor(probe, x, y, info.connected === false ? 0.1 : 0.45)) out[id] = step;
    }
    if (!this.conclude(t, out, step)) this.fastForward(t);
  }

  /** Writes a step's verdict. True if that ended the round. */
  conclude(t, out, step) {
    const g = this.g;
    const alive = g.ids.filter((id) => out[id] === undefined).length;
    this.set({ out, res: step });
    if (alive <= 1 || step >= STEPS_MAX) {
      this.endRound(t);
      return true;
    }
    return false;
  }

  endRound(t) {
    const g = this.g;
    const { place, pts, winners } = roundResult(g.ids, g.out);
    const scores = { ...g.scores };
    const sv = { ...g.sv };
    for (const id of g.ids) {
      scores[id] = (scores[id] ?? 0) + pts[id];
      sv[id] = (sv[id] ?? 0) + (g.out[id] !== undefined ? g.out[id] - 1 : g.step);
    }
    this.set({ phase: 'end', until: t + END_MS, place, pts, win: winners, scores, sv });
  }

  nextStep(t, tl) {
    const g = this.g;
    // a verdict that came in after the judging still counts, until the floor is back
    let late = null;
    for (const id of g.ids) {
      if (g.out[id] === undefined && !isBotId(id) && this.reported[id] === g.step) {
        late ??= { ...g.out };
        late[id] = g.step;
      }
    }
    if (late && this.conclude(t, late, g.step)) return;
    const gg = this.g;
    const alive = gg.ids.filter((id) => gg.out[id] === undefined);
    const positions = alive.map((id) => this.posOf(id));
    const step = gg.step + 1;
    const ss = chooseStepSeed(hash32(gg.sd, gg.round), step, alive.length, positions, reactMs(step, gg.speed));
    const fa = Math.max(tl.ea, t);
    this.set({ step, ss, na: alive.length, fa, ca: fa + PRE_MS });
  }

  /** With only bots left standing the rest of the round is played out at once (nobody wants to watch it). */
  fastForward(t) {
    const g = this.g;
    if (this.ff || this.noFF || g.phase !== 'step') return;
    if (g.ids.some((id) => !isBotId(id) && g.out[id] === undefined)) return;
    this.ff = true;
    let vt = t;
    for (let guard = 0; this.g.phase === 'step' && guard < 60000; guard++) {
      vt += DT_MS;
      this.simBots(vt);
      this.logic(vt);
    }
    this.ff = false;
    if (this.g.phase === 'end') this.set({ until: t + END_MS });
  }

  toFinal(t) {
    const g = this.g;
    const pu = {};
    for (const id of g.ids) pu[id] = isBotId(id) ? (this.pushTotals[id] ?? 0) : clampInt(this.H?.info(id)?.pc, 0, 999);
    const order = rankMatch(g.ids, g.scores, g.sv).map((e) => e.id);
    this.set({ phase: 'final', until: t + FINAL_MS, pu, aw: computeAwards(order, pu, g.sv) });
  }

  // ------------------------------------------------------------------ what the other pages draw the bots from
  snapshot(now) {
    const g = this.g;
    const p = [];
    g.ids.forEach((id, i) => {
      if (!isBotId(id)) return;
      const b = this.bots.get(id);
      const c = b ? b.c : newChar(this.spawns[i]?.x ?? 6, this.spawns[i]?.y ?? 4);
      const flags = (c.pushT > 0 ? 1 : 0) | (c.knockT > 0 ? 2 : 0) | (c.st !== 0 ? 4 : 0);
      p.push([r2(c.x), r2(c.y), r2(c.vx), r2(c.vy), r2(Math.atan2(c.fy, c.fx)), flags]);
    });
    return { rid: g.rid, t: Math.round(now), p };
  }
}
