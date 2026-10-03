// A small stand-in for the platform's room, for testing the match controller with several pages in one process:
// players, presence, room state, the match (phase, id, seed, participants, clock), the host, drops and reloads.

export function makeServer({ seed = 99, settings = {}, kind = 'public' } = {}) {
  const srv = {
    now: 0, // ms, the room's clock
    matchStart: null,
    match: { phase: 'lobby', id: null, seed: 0, participants: [] },
    players: new Map(), // id -> { id, name, presence, connected }
    state: { 'ow.settings': settings },
    host: null,
    rooms: new Map(), // id -> client room
    kind,
    seed,
    ended: 0,
    order: [], // join order, for choosing a new host
  };
  srv.matchNow = () => (srv.match.phase === 'playing' && srv.matchStart !== null ? srv.now - srv.matchStart : 0);
  srv.pickHost = () => {
    const h = srv.players.get(srv.host);
    if (h && h.connected) return;
    const next = srv.order.find((id) => srv.players.get(id)?.connected);
    srv.host = next ?? null;
  };
  srv.start = (n = 1) => {
    srv.match = { phase: 'playing', id: `m${n}-${srv.seed}`, seed: srv.seed + n, participants: [...srv.players.values()].filter((p) => p.connected).map((p) => p.id), n };
    srv.matchStart = srv.now;
  };
  srv.end = () => {
    srv.match = { phase: 'lobby', id: null, seed: 0, participants: [] };
    srv.matchStart = null;
    srv.ended++;
  };
  /** A page joins (or comes back as the same player after a reload). */
  srv.join = (id, name = id) => {
    let p = srv.players.get(id);
    if (!p) {
      p = { id, name, presence: null, connected: true };
      srv.players.set(id, p);
      srv.order.push(id);
    }
    p.connected = true;
    srv.pickHost();
    const room = makeRoom(srv, id);
    srv.rooms.set(id, room);
    return room;
  };
  /** A page goes away: a reload or a drop keeps the seat (presence held); a leave removes the player. */
  srv.drop = (id) => {
    const p = srv.players.get(id);
    if (p) p.connected = false;
    srv.rooms.delete(id);
    srv.pickHost();
  };
  srv.leave = (id) => {
    srv.players.delete(id);
    srv.rooms.delete(id);
    srv.order = srv.order.filter((x) => x !== id);
    srv.pickHost();
  };
  srv.tick = (ms) => {
    srv.now += ms;
  };
  return srv;
}

function makeRoom(srv, id) {
  const listeners = {};
  const room = {
    me: { id },
    kind: srv.kind,
    get connected() {
      return srv.players.get(id)?.connected === true;
    },
    get isHost() {
      return srv.host === id && this.connected;
    },
    get host() {
      return srv.host;
    },
    get players() {
      return srv.players;
    },
    get state() {
      return srv.state;
    },
    get match() {
      return srv.match;
    },
    get settings() {
      return srv.state['ow.settings'] ?? {};
    },
    get spectating() {
      return srv.match.phase === 'playing' && !srv.match.participants.includes(id);
    },
    isParticipant: (x) => srv.match.participants.includes(x),
    matchNow: () => srv.matchNow(),
    presenceAt: (pid) => srv.players.get(pid)?.presence ?? null,
    setPresence(p) {
      const me = srv.players.get(id);
      if (me) me.presence = JSON.parse(JSON.stringify(p));
    },
    setState(k, v) {
      srv.state[k] = v === null ? undefined : JSON.parse(JSON.stringify(v));
      for (const [rid, r] of srv.rooms) if (rid !== id) r.emit('state', k, srv.state[k], id);
    },
    endMatch() {
      if (this.isHost) srv.end();
    },
    on(ev, fn) {
      (listeners[ev] ??= []).push(fn);
    },
    emit(ev, ...a) {
      for (const fn of listeners[ev] ?? []) fn(...a);
    },
  };
  return room;
}
