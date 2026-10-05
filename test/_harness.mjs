// Test helpers: play whole matches in node with the pure engine, bots and physics. A "human" here is a page stood in for by a
// bot's brain: it has its own body, makes its own verdict at the drop and tells the host after a delay, like a real page does.
import { Engine, isBotId } from '../game/engine.js';
import { DT, applyKnock, newChar, newFloor, onFloor, pushContact, resetChar, separate, snapToFloor, startFall, stepChar } from '../game/sim.js';
import { newBrain, think } from '../game/bots.js';
import { makeRng } from '../game/rng.js';
import { fellCode, makeFloor, roundSpawns, timeline } from '../game/rules.js';

export const DT_MS = 1000 / 60;

export class SimHuman {
  constructor(id, seed, o = {}) {
    this.id = id;
    this.c = newChar(6, 4);
    this.c.id = id;
    this.brain = newBrain(makeRng(seed));
    this.latency = o.latency ?? 80; // ms before the host hears "I fell"
    this.away = Boolean(o.away); // a dropped connection: stands where it was, reports nothing
    this.silent = Boolean(o.silent); // connected but never says anything (a hidden tab)
    this.round = 0;
    this.decided = '';
    this.fcode = 0;
    this.pc = 0;
    this.hist = [];
    this.floor = newFloor();
    this.out = { ix: 0, iy: 0, push: false };
    this.fellOn = {}; // `${round}.${step}` -> true: what this page decided
    this.queue = [];
    this.ctx = { phase: 'pre', step: 1, now: 0, ca: 0, colors: null, call: 0, chars: [], n: 0 };
  }

  step(engine, now, chars) {
    const g = engine.g;
    const idx = g.ids.indexOf(this.id);
    if (g.round !== this.round && g.phase === 'step' && now >= g.rs) {
      this.round = g.round;
      const sp = roundSpawns(g.sd, g.round, g.ids.length)[idx];
      resetChar(this.c, sp.x, sp.y);
      this.fcode = 0;
      this.decided = '';
      this.hist.length = 0;
    }
    if (this.away) return;
    const c = this.c;
    if (g.phase === 'step' && g.round === this.round) {
      const fd = makeFloor(g.ss, g.step, g.na);
      const tl = timeline(g);
      this.floor.stand = fd.stand;
      this.floor.voidOn = now >= tl.da;
      const key = `${g.round}.${g.step}`;
      if (now >= tl.da && this.decided !== key) {
        this.decided = key;
        if (g.res < g.step && c.st === 0) {
          if (onFloor(this.floor, c.x, c.y, 0.1)) snapToFloor(this.floor, c);
          else {
            startFall(c);
            this.fellOn[key] = true;
            if (!this.silent) {
              this.fcode = fellCode(g.round, g.step);
              this.queue.push({ at: now + this.latency, step: g.step, round: g.round });
            }
          }
        }
      }
      const ctx = this.ctx;
      ctx.phase = now < tl.ca ? 'pre' : now < tl.da ? 'call' : 'down';
      ctx.step = g.step;
      ctx.now = now;
      ctx.ca = tl.ca;
      ctx.colors = fd.colors;
      ctx.call = fd.call;
      ctx.chars = chars;
      ctx.n = chars.length;
      think(this.brain, c, ctx, this.out);
    } else {
      this.floor.voidOn = false;
      this.out.ix = this.out.iy = 0;
      this.out.push = false;
    }
    stepChar(c, this.out.ix, this.out.iy, this.out.push, DT, this.floor);
    c.evPush = false;
    if (c.st === 0) separate(c, chars, chars.length, this.floor, 7);
    this.hist.push({ x: c.x, y: c.y });
    if (this.hist.length > 7) this.hist.shift();
  }

  /** What the host sees of this person: their position a moment ago, whether they've said they fell. */
  info() {
    if (this.away) return { x: undefined, y: undefined, gh: false, f: 0, pc: this.pc, connected: false };
    const p = this.hist[0] ?? this.c;
    return { x: p.x, y: p.y, gh: !this.silent && this.c.st !== 0, f: this.silent ? 0 : this.fcode, pc: this.pc, connected: true };
  }
}

/**
 * Plays a match to its end. `humans`: SimHuman objects (their ids go in the roster). Calls `onTick(engine, now)` every tick.
 * Returns { engine, now, ticks, rounds: [{ g at the round's end }] }.
 */
export function playMatch({ seed, humans = [], rounds = 3, speed = 'normal', noFF = true, onTick, maxTicks = 60 * 60 * 40 }) {
  const ids = humans.map((h) => h.id);
  const engine = Engine.create({ mid: `m${seed}`, seed, humans: ids, settings: { rounds, speed }, me: ids[0] ?? 'host' });
  engine.noFF = noFF;
  engine.start(0);
  const byId = new Map(humans.map((h) => [h.id, h]));
  const H = {
    info(id) {
      const h = byId.get(id);
      return h ? h.info() : null;
    },
  };
  const ended = [];
  let seenEnd = '';
  let now = 0;
  let ticks = 0;
  const chars = [];
  while (ticks < maxTicks) {
    now += DT_MS;
    ticks++;
    chars.length = 0;
    for (const b of engine.bots.values()) chars.push(b.c);
    for (const h of humans) chars.push(h.c);
    for (const h of humans) {
      h.step(engine, now, chars);
      // their shoves
      if (h.c.pushT > 0 && h.c.st === 0) {
        for (const o of chars) {
          if (o === h.c || o.st !== 0 || h.c.hits.includes(o) || !pushContact(h.c, o.x, o.y)) continue;
          h.c.hits.push(o);
          h.pc++;
          if (isBotId(o.id)) engine.knockBot(o.id, o.x - h.c.x, o.y - h.c.y);
          else applyKnock(o, o.x - h.c.x, o.y - h.c.y);
        }
      }
      while (h.queue.length && h.queue[0].at <= now) {
        const q = h.queue.shift();
        if (q.round === engine.g.round) engine.reportFell(h.id, q.step);
      }
    }
    const done = engine.update(now, H);
    for (const ev of engine.takeEvents()) {
      const h = byId.get(ev.to);
      if (h && h.c.st === 0) applyKnock(h.c, ev.dx, ev.dy);
    }
    const g = engine.g;
    if (g.phase === 'end' && seenEnd !== g.rid) {
      seenEnd = g.rid;
      ended.push(g);
    }
    if (onTick) onTick(engine, now);
    if (done) break;
  }
  return { engine, now, ticks, ended, humans };
}
