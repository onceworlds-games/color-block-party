// The room: joining it (or a stand-in when the page runs on its own), reading the match's record, the host running the engine,
// and the messages (a dancer says they fell; a push tells the pushed). Nothing here draws.
import { Engine, isBotId } from './engine.js';
import { MAX_DANCERS, SETTINGS, SPEEDS } from './rules.js';

/** How the game joins its room: up to 12 dancers, a lone player can ready up and play with bots, the game draws its own lobby. */
export const JOIN = { maxPlayers: MAX_DANCERS, minPlayers: 1, lobby: 'bar', settings: SETTINGS };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, lo, hi, d = 0) => (fin(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, lo, hi, d = 0) => Math.round(num(v, lo, hi, d));
const str = (v, n = 64) => (typeof v === 'string' ? v.slice(0, n) : '');
const r2 = (v) => Math.round(v * 100) / 100;

/** { id: whole number } for the ids that are in the roster, each kept in range. */
function idMap(raw, ids, lo, hi) {
  const out = {};
  if (isObj(raw)) for (const id of ids) if (fin(raw[id])) out[id] = Math.min(hi, Math.max(lo, Math.round(raw[id])));
  return out;
}

// ---------------------------------------------------------------- a stand-in for a page opened on its own
export function makeStandalone() {
  const ow = {
    standalone: true,
    now: () => Date.now(),
    settings: {
      quality: 'high',
      reducedMotion: false,
      pixelRatio: (n = 2) => Math.min(window.devicePixelRatio || 1, n),
      on() {},
    },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    ui: { setOrientation() {} },
    player: { get: async () => ({ id: 'me', name: 'You', guest: true }), avatarUrl: async () => null },
    save: { get: async () => null, set: async () => {} },
    badges: { award: async () => false },
    leaderboards: { submit: async () => null },
    on() {},
    rooms: { join: async () => makeStubRoom(), on() {} },
  };
  return ow;
}

/** A solo room with the same shape as the real one: you, ready, a countdown, a match of bots, back to the lobby. */
function makeStubRoom() {
  const listeners = new Map();
  const on = (ev, fn) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev)?.delete(fn);
  };
  const emit = (ev, ...args) => {
    for (const fn of listeners.get(ev) ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const me = { id: 'me', name: 'You', presence: null, team: 0 };
  const players = new Map([['me', me]]);
  const settings = Object.fromEntries(SETTINGS.map((s) => [s.id, s.default]));
  let startedAt = 0;
  let timer = 0;
  let n = 0;
  const room = {
    id: 'solo',
    kind: 'solo',
    me,
    players,
    state: {},
    host: 'me',
    closed: false,
    connected: true,
    match: { phase: 'lobby', n: 0, min: 1, id: '', seed: 1, participants: [] },
    isHost: true,
    online: [me],
    spectating: false,
    spectators: [],
    on,
    get participants() {
      return room.match.phase === 'lobby' ? [] : [me];
    },
    get running() {
      return room.match.phase === 'playing';
    },
    get settings() {
      return settings;
    },
    isParticipant: () => room.match.phase !== 'lobby',
    matchNow: () => (room.match.phase === 'playing' ? Date.now() - startedAt : 0),
    setReady(ready) {
      me.ready = ready || undefined;
      if (ready && room.match.phase === 'lobby') {
        n++;
        room.match = { phase: 'starting', n, min: 1, id: `solo-${n}`, seed: Math.random(), participants: ['me'], startsAt: Date.now() + 3000 };
        emit('starting', room.match);
        timer = setTimeout(() => {
          me.ready = undefined;
          startedAt = Date.now();
          room.match = { ...room.match, phase: 'playing', startedAt };
          emit('matchstart', room.match);
        }, 3000);
      } else if (!ready && room.match.phase === 'starting') {
        clearTimeout(timer);
        const previous = room.match;
        room.match = { phase: 'lobby', n, min: 1, id: '', seed: 1, participants: [] };
        emit('matchend', room.match, previous);
      }
    },
    setSetting(id, value) {
      if (room.match.phase === 'lobby' && id in settings) settings[id] = value;
    },
    setState(key, value) {
      if (value === null || value === undefined) delete room.state[key];
      else room.state[key] = value;
    },
    setPresence(p) {
      me.presence = p;
    },
    presenceAt: () => null,
    send() {},
    clearReady() {},
    endMatch() {
      const previous = room.match;
      room.match = { phase: 'lobby', n, min: 1, id: '', seed: 1, participants: [] };
      emit('matchend', room.match, previous);
    },
  };
  return room;
}

// ---------------------------------------------------------------- the match, as every page sees it
export function createNet(ow, room, hooks) {
  const me = room.me.id;
  let engine = null; // only on the host's page, while a match plays
  let wroteRev = -1;
  let wroteBAt = -1e9;
  let wroteBPhase = '';
  let endedMid = '';
  let endedAt = -1e9;
  let rawG = null;
  let rawMid = '';
  let normG = null;
  let lastB = null;
  const buf = []; // the bots' last snapshots (everyone but the host draws bots from these)
  let bufRid = '';
  const local = { x: 6, y: 4, gh: false, f: 0, pc: 0, connected: true };
  const names = new Map();
  const botIdx = { ids: null, map: new Map() };

  // -------- the record
  function normalize(raw) {
    if (!isObj(raw) || raw.mid !== room.match.id || !Array.isArray(raw.ids)) return null;
    const ids = raw.ids.filter((s) => typeof s === 'string' && s.length <= 64).slice(0, MAX_DANCERS);
    const phase = ['step', 'end', 'board', 'final'].includes(raw.phase) ? raw.phase : null;
    if (!ids.length || !phase) return null;
    const bn = {};
    if (isObj(raw.bn)) for (const id of ids) if (isBotId(id) && typeof raw.bn[id] === 'string') bn[id] = raw.bn[id].slice(0, 16);
    const aw = isObj(raw.aw)
      ? { push: ids.includes(raw.aw.push) ? raw.aw.push : null, lucky: ids.includes(raw.aw.lucky) ? raw.aw.lucky : null }
      : null;
    return {
      mid: raw.mid,
      by: str(raw.by),
      sd: int(raw.sd, 0, 4294967295),
      ids,
      bn,
      rounds: int(raw.rounds, 1, 9, 3),
      speed: SPEEDS[raw.speed] ? raw.speed : 'normal',
      round: int(raw.round, 0, 99),
      rid: str(raw.rid, 90),
      phase,
      until: num(raw.until, 0, 1e12),
      rs: num(raw.rs, 0, 1e12),
      step: int(raw.step, 1, 99, 1),
      ss: int(raw.ss, 0, 4294967295),
      na: int(raw.na, 1, 16, ids.length),
      fa: num(raw.fa, 0, 1e12),
      ca: num(raw.ca, 0, 1e12),
      res: int(raw.res, 0, 99),
      out: idMap(raw.out, ids, 0, 99),
      scores: idMap(raw.scores, ids, 0, 9999),
      pts: idMap(raw.pts, ids, 0, 99),
      place: idMap(raw.place, ids, 0, 99),
      sv: idMap(raw.sv, ids, 0, 9999),
      pu: idMap(raw.pu, ids, 0, 999),
      win: Array.isArray(raw.win) ? raw.win.filter((id) => ids.includes(id)) : [],
      aw,
    };
  }

  /** This match's record, checked (null when there isn't one yet, or it belongs to another match). Same object until it changes. */
  function readG() {
    const raw = room.state.g;
    if (raw === rawG && rawMid === room.match.id) return normG;
    rawG = raw;
    rawMid = room.match.id;
    normG = room.match.phase === 'lobby' ? null : normalize(raw);
    return normG;
  }

  /** The id pushes carry: 'lobby' while players mill about waiting, else the round's id. */
  function currentRid() {
    if (room.match.phase !== 'playing') return 'lobby';
    return readG()?.rid ?? '';
  }

  // -------- bots
  function pullBots() {
    const b = room.state.b;
    if (b === lastB || !isObj(b)) return;
    lastB = b;
    if (typeof b.rid !== 'string' || !fin(b.t) || !Array.isArray(b.p)) return;
    if (b.rid !== bufRid) {
      buf.length = 0;
      bufRid = b.rid;
    }
    const last = buf[buf.length - 1];
    if (last && b.t <= last.t) {
      if (b.t > last.t - 1500) return;
      buf.length = 0;
    }
    buf.push({ t: b.t, p: b.p });
    if (buf.length > 8) buf.shift();
  }

  const okRow = (e) => Array.isArray(e) && e.length >= 6 && fin(e[0]) && fin(e[1]) && fin(e[2]) && fin(e[3]) && fin(e[4]) && fin(e[5]);

  function botIndex(g, id) {
    if (botIdx.ids !== g.ids) {
      botIdx.ids = g.ids;
      botIdx.map.clear();
      let k = 0;
      for (const x of g.ids) if (isBotId(x)) botIdx.map.set(x, k++);
    }
    return botIdx.map.get(id) ?? -1;
  }

  /** Where a bot is drawn, in `out` ({ x, y, vx, vy, ang, fl }): the host's own body, or between the last two snapshots. */
  function botView(g, id, rt, out) {
    if (engine && engine.g.mid === g.mid) {
      const b = engine.bots.get(id);
      if (!b) return false;
      const c = b.c;
      out.x = c.x;
      out.y = c.y;
      out.vx = c.vx;
      out.vy = c.vy;
      out.ang = Math.atan2(c.fy, c.fx);
      out.fl = (c.pushT > 0 ? 1 : 0) | (c.knockT > 0 ? 2 : 0) | (c.st !== 0 ? 4 : 0);
      return true;
    }
    const k = botIndex(g, id);
    const n = buf.length;
    if (k < 0 || n === 0) return false;
    let hi = 0;
    while (hi < n && buf[hi].t <= rt) hi++;
    const a = buf[Math.max(0, hi - 1)];
    const b = buf[Math.min(n - 1, hi)];
    const ra = a.p[k];
    const rb = b.p[k];
    if (!okRow(ra) || !okRow(rb)) return false;
    const f = a === b ? 0 : Math.min(1, Math.max(0, (rt - a.t) / Math.max(1, b.t - a.t)));
    out.x = ra[0] + (rb[0] - ra[0]) * f;
    out.y = ra[1] + (rb[1] - ra[1]) * f;
    out.vx = ra[2] + (rb[2] - ra[2]) * f;
    out.vy = ra[3] + (rb[3] - ra[3]) * f;
    let d = rb[4] - ra[4];
    d = ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    out.ang = ra[4] + d * f;
    out.fl = (f < 0.5 ? ra[5] : rb[5]) | 0;
    return true;
  }

  // -------- the host
  /** What the engine knows of the people: where they say they are, and whether they've fallen. */
  const H = {
    info(id) {
      if (id === me) return local;
      const p = room.players.get(id);
      if (!p) return null;
      const g = engine?.g;
      const pr = p.presence;
      const fresh = isObj(pr) && g && pr.rn === g.round;
      return {
        x: fresh && fin(pr.x) ? pr.x : undefined,
        y: fresh && fin(pr.y) ? pr.y : undefined,
        gh: fresh && pr.gh === true,
        f: fresh && fin(pr.f) ? pr.f : 0,
        pc: isObj(pr) && fin(pr.pc) ? Math.min(999, Math.max(0, Math.round(pr.pc))) : 0,
        connected: p.connected !== false,
      };
    },
  };

  function flush(now) {
    const g = engine.g;
    if (engine.rev !== wroteRev || room.state.g?.by !== me) {
      room.setState('g', g);
      wroteRev = engine.rev;
    }
    // the bots' bodies, about 12 times a second while they move (and once as each phase begins)
    if ((g.phase === 'step' && now - wroteBAt >= 80) || g.phase !== wroteBPhase) {
      room.setState('b', engine.snapshot(now));
      wroteBAt = now;
      wroteBPhase = g.phase;
    }
  }

  function hostTick() {
    if (!room.isHost) {
      engine = null;
      return;
    }
    if (!room.running || room.match.phase !== 'playing') return;
    const mid = room.match.id;
    if (!engine || engine.g.mid !== mid) {
      const raw = room.state.g;
      if (isObj(raw) && raw.mid === mid && Array.isArray(raw.ids)) {
        engine = Engine.adopt(raw, room.state.b, me); // a reload or a change of host: carry on from the room's copy
      } else {
        const humans = (room.match.participants ?? []).filter((id) => typeof id === 'string').slice(0, MAX_DANCERS);
        engine = Engine.create({ mid, seed: room.match.seed, humans, settings: room.settings, me });
        engine.start(room.matchNow());
      }
      wroteRev = -1;
      wroteBPhase = '';
    }
    const now = room.matchNow();
    const done = engine.update(now, H);
    flush(now);
    for (const ev of engine.takeEvents()) {
      if (ev.to === me) hooks.onKnock(ev.dx, ev.dy, ev.by);
      else if (room.players.has(ev.to)) room.send({ t: 'push', rid: engine.g.rid, by: ev.by, dx: ev.dx, dy: ev.dy }, { to: ev.to });
    }
    if (done && (endedMid !== mid || ow.now() - endedAt > 3000)) {
      endedMid = mid;
      endedAt = ow.now();
      room.endMatch();
    }
  }

  // -------- messages
  room.on('message', (d, from, at) => {
    if (!isObj(d) || !isObj(from) || typeof d.rid !== 'string') return;
    if (d.t === 'fell') {
      // a dancer says they fell on this step (the host writes it down once)
      if (engine && room.isHost && d.rid === engine.g.rid && Number.isInteger(d.step)) engine.reportFell(from.id, d.step);
    } else if (d.t === 'push') {
      onPush(d, from, at);
    }
  });

  function onPush(d, from, at) {
    if (!fin(d.dx) || !fin(d.dy) || Math.hypot(d.dx, d.dy) > 3) return;
    if (typeof d.bot === 'string') {
      // a person's shove on a bot: the host's bodies
      if (!engine || !room.isHost || !isBotId(d.bot) || d.rid !== engine.g.rid || !engine.g.ids.includes(from.id)) return;
      const body = engine.bots.get(d.bot);
      const pr = from.presence;
      if (body && isObj(pr) && fin(pr.x) && fin(pr.y) && Math.hypot(pr.x - body.c.x, pr.y - body.c.y) > 2.4) return;
      engine.knockBot(d.bot, d.dx, d.dy);
      return;
    }
    // someone shoved me
    if (d.rid !== currentRid()) return;
    if (fin(at) && ow.now() - at > 500) return;
    let by = from.id;
    if (typeof d.by === 'string') {
      if (from.id !== room.host || !isBotId(d.by)) return;
      by = d.by;
    }
    const g = readG();
    if (room.match.phase === 'playing' && (!g || !g.ids.includes(by))) return;
    hooks.onKnock(d.dx, d.dy, by);
  }

  room.on('host', () => {
    if (!room.isHost) engine = null;
  });
  room.on('reconnect', () => {
    engine = null;
  });
  room.on('disconnect', () => {
    engine = null;
  });
  room.on('matchend', () => {
    engine = null;
    buf.length = 0;
    bufRid = '';
    lastB = null;
  });
  const timer = setInterval(hostTick, 100);
  timer.unref?.(); // (a page never needs this; a test process can exit)

  return {
    room,
    me,
    local,
    get engine() {
      return engine;
    },
    /** The match's record for this match, or null. */
    g: readG,
    currentRid,
    hostTick,
    /** Call each frame: picks up the bots' newest snapshot. */
    sync: pullBots,
    botView,
    /** A dancer's display name. */
    name(id, g) {
      if (g && g.bn[id]) return g.bn[id];
      const p = room.players.get(id);
      if (p && typeof p.name === 'string' && p.name) names.set(id, p.name.slice(0, 24));
      return names.get(id) ?? 'Player';
    },
    /** Says you fell on this step (the host writes it in the record; its own page just tells its engine). */
    fell(rid, step) {
      if (engine) engine.reportFell(me, step);
      else if (room.host !== me) room.send({ t: 'fell', rid, step }, { to: room.host });
    },
    /** Your shove reached someone: a bot (the host's bodies) or a person (they knock themselves). */
    push(targetId, dx, dy) {
      const rid = currentRid();
      if (isBotId(targetId)) {
        if (engine) engine.knockBot(targetId, dx, dy);
        else if (room.host !== me) room.send({ t: 'push', rid, bot: targetId, dx: r2(dx), dy: r2(dy) }, { to: room.host });
      } else {
        room.send({ t: 'push', rid, dx: r2(dx), dy: r2(dy) }, { to: targetId });
      }
    },
    /** The room is gone: stop the host's ticker. */
    destroy() {
      clearInterval(timer);
      engine = null;
    },
  };
}
