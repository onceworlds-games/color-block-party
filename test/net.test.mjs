import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet, makeStandalone, JOIN } from '../game/net.js';
import { isBotId } from '../game/engine.js';
import { MAX_DANCERS, SETTINGS, TABLE, timeline } from '../game/rules.js';

const DT_MS = 1000 / 60;

/** Just enough of a Room to run a page's net layer in node. */
class FakeRoom {
  constructor(meId, hostId, participants, startedAt = 0) {
    this.listeners = new Map();
    this.me = { id: meId, name: meId, presence: null };
    this.players = new Map(participants.map((id) => [id, id === meId ? this.me : { id, name: id, presence: null, connected: true }]));
    this.host = hostId;
    this.state = {};
    this.closed = false;
    this.connected = true;
    this.clockMs = 0;
    this.sent = [];
    this.ended = 0;
    this.writes = [];
    this.settings = { rounds: 3, speed: 'normal' };
    this.match = { phase: 'playing', id: 'M1', seed: 77, participants, startedAt };
  }
  get isHost() {
    return this.connected && this.host === this.me.id;
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    return this.match.phase === 'playing' ? this.clockMs - this.match.startedAt : 0;
  }
  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
  }
  emit(ev, ...args) {
    for (const fn of this.listeners.get(ev) ?? []) fn(...args);
  }
  setState(k, v) {
    this.writes.push(k);
    if (v == null) delete this.state[k];
    else this.state[k] = v;
  }
  send(d, o) {
    this.sent.push({ d, to: o?.to });
  }
  endMatch() {
    this.ended++;
  }
}

const ow = { now: () => 0 };

function host(participants = ['h', 'p2']) {
  const room = new FakeRoom('h', 'h', participants);
  const knocks = [];
  ow.now = () => room.clockMs;
  const net = createNet(ow, room, { onKnock: (dx, dy, by) => knocks.push({ dx, dy, by }) });
  const advance = (ms) => {
    for (let t = 0; t < ms; t += DT_MS) {
      room.clockMs += DT_MS;
      net.hostTick();
      net.sync();
    }
  };
  return { room, net, knocks, advance };
}

test('the host writes the record and the bots, and the page reads them back checked', () => {
  const { room, net, advance } = host();
  advance(500);
  const g = net.g();
  assert.ok(g, 'a record');
  assert.equal(g.mid, 'M1');
  assert.deepEqual(g.ids.slice(0, 2), ['h', 'p2']);
  assert.equal(g.ids.length, TABLE);
  assert.ok(g.ids.slice(2).every(isBotId));
  assert.equal(g.by, 'h');
  assert.equal(g.rounds, 3);
  assert.equal(g.round, 1);
  assert.equal(g.phase, 'step');
  assert.ok(Object.keys(g.bn).length === 6 && Object.values(g.bn).every((n) => typeof n === 'string'));
  assert.equal(net.g(), g, 'the same object until something changes');
  assert.ok(room.state.b && room.state.b.rid === g.rid && room.state.b.p.length === 6);
  assert.ok(room.state.b.p.every((row) => row.length === 6 && row.every(Number.isFinite)));
  JSON.stringify(room.state);
  // the bots are drawn from the host's own bodies
  const v = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, fl: 0 };
  assert.ok(net.botView(g, 'bot1', 0, v));
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  assert.equal(net.currentRid(), g.rid);
});

test('a whole match through the host\'s page: people judged from their messages and presence, the match ended once', () => {
  const { room, net, advance } = host();
  const p2 = room.players.get('p2');
  let guard = 0;
  let sawFinal = false;
  while (room.ended === 0 && guard++ < 60 * 60 * 15) {
    advance(1000 / 60);
    const g = net.g();
    // the second person stands still at their spawn, publishing presence; the host's own person too
    if (g) {
      p2.presence = { x: 6, y: 4, vx: 0, vy: 0, a: 0, ps: false, kn: false, gh: false, f: 0, pc: 2, rn: g.round };
      room.me.presence = { x: 6, y: 5, rn: g.round };
      net.local.x = 6;
      net.local.y = 5;
      if (g.phase === 'final') sawFinal = true;
    }
  }
  assert.ok(sawFinal);
  assert.equal(room.ended, 1, 'the match is ended once, by the host');
  const g = net.g();
  assert.equal(g.phase, 'final');
  assert.equal(g.pu.p2, 2, 'pushes landed come from presence');
  assert.ok(g.ids.every((id) => typeof g.scores[id] === 'number'));
});

test('messages are checked: a verdict for the wrong round or step is ignored, the right one counts', () => {
  const { room, net, advance } = host();
  advance(300);
  const g = net.g();
  const engine = net.engine;
  assert.ok(engine);
  room.emit('message', { t: 'fell', rid: 'other.1', step: g.step }, { id: 'p2' }, 0);
  room.emit('message', { t: 'fell', rid: g.rid, step: g.step + 5 }, { id: 'p2' }, 0);
  room.emit('message', { t: 'fell', rid: g.rid, step: 'x' }, { id: 'p2' }, 0);
  room.emit('message', { t: 'fell', rid: g.rid, step: g.step }, { id: 'bot1' }, 0);
  room.emit('message', { t: 'fell', rid: g.rid, step: g.step }, { id: 'nobody' }, 0);
  room.emit('message', null, { id: 'p2' }, 0);
  room.emit('message', 'fell', { id: 'p2' }, 0);
  assert.deepEqual(engine.reported, {});
  room.emit('message', { t: 'fell', rid: g.rid, step: g.step }, { id: 'p2' }, 0);
  assert.deepEqual(engine.reported, { p2: g.step });
});

test('shoves: validated, recent, and only from somebody in the match', () => {
  const { room, net, knocks, advance } = host();
  advance(300);
  const g = net.g();
  const send = (d, from, at = room.clockMs) => room.emit('message', d, from, at);
  send({ t: 'push', rid: g.rid, dx: 1, dy: 0 }, { id: 'p2' });
  assert.equal(knocks.length, 1, 'a shove from a player in the round lands');
  send({ t: 'push', rid: 'nope', dx: 1, dy: 0 }, { id: 'p2' });
  send({ t: 'push', rid: g.rid, dx: NaN, dy: 0 }, { id: 'p2' });
  send({ t: 'push', rid: g.rid, dx: 40, dy: 0 }, { id: 'p2' });
  send({ t: 'push', rid: g.rid, dx: 1, dy: 0 }, { id: 'stranger' });
  send({ t: 'push', rid: g.rid, dx: 1, dy: 0 }, { id: 'p2' }, room.clockMs - 900);
  send({ t: 'push', rid: g.rid, dx: 1, dy: 0, by: 'bot2' }, { id: 'p2' });
  assert.equal(knocks.length, 1, 'none of those land');
  // a person shoving a bot reaches the host's body for it
  const bot = net.engine.bots.get('bot3');
  net.engine.bots.get('bot3').c.x = 6;
  net.engine.bots.get('bot3').c.y = 4;
  room.players.get('p2').presence = { x: 5.4, y: 4, rn: g.round };
  send({ t: 'push', rid: g.rid, bot: 'bot3', dx: 1, dy: 0 }, { id: 'p2', presence: room.players.get('p2').presence });
  assert.ok(bot.c.knockT > 0, 'the bot was knocked');
  const far = net.engine.bots.get('bot4');
  far.c.x = 10;
  far.c.y = 7;
  send({ t: 'push', rid: g.rid, bot: 'bot4', dx: 1, dy: 0 }, { id: 'p2', presence: { x: 2, y: 2 } });
  assert.equal(far.c.knockT, 0, 'not from across the floor');
  // your own shoves: on a bot, straight to the host's body; on a person, a message to them
  net.push('bot5', 1, 0);
  net.push('p2', 1, 0);
  assert.deepEqual(room.sent.at(-1).d, { t: 'push', rid: g.rid, dx: 1, dy: 0 });
  assert.equal(room.sent.at(-1).to, 'p2');
});

test('on a guest\'s page a bot\'s shove counts only when the host sends it', () => {
  const { room: hostRoom, advance } = host();
  advance(300);
  const room = new FakeRoom('p2', 'h', ['h', 'p2']);
  const knocks = [];
  ow.now = () => room.clockMs;
  createNet(ow, room, { onKnock: (dx, dy, by) => knocks.push(by) });
  room.state.g = JSON.parse(JSON.stringify(hostRoom.state.g));
  room.clockMs = hostRoom.clockMs;
  const rid = room.state.g.rid;
  room.emit('message', { t: 'push', rid, dx: 1, dy: 0, by: 'bot2' }, { id: 'h' }, room.clockMs);
  assert.deepEqual(knocks, ['bot2']);
  room.emit('message', { t: 'push', rid, dx: 1, dy: 0, by: 'bot2' }, { id: 'h2' }, room.clockMs);
  room.emit('message', { t: 'push', rid, dx: 1, dy: 0, by: 'zed' }, { id: 'h' }, room.clockMs);
  room.emit('message', { t: 'push', rid, dx: 1, dy: 0, by: 'bot99' }, { id: 'h' }, room.clockMs);
  assert.deepEqual(knocks, ['bot2'], 'not from other players, not from ids that are not bots, not from bots that are not in the match');
});

test('the lobby has its own round id for shoves', () => {
  const { room, net, knocks } = host();
  room.match = { phase: 'lobby' };
  assert.equal(net.currentRid(), 'lobby');
  room.emit('message', { t: 'push', rid: 'lobby', dx: 1, dy: 0 }, { id: 'p2' }, 0);
  assert.equal(knocks.length, 1);
  assert.equal(net.g(), null);
});

test('everyone else draws the same record, and the bots between the host\'s snapshots', () => {
  const { room: hostRoom, net: hostNet, advance } = host();
  advance(1500);
  const guestRoom = new FakeRoom('p2', 'h', ['h', 'p2']);
  const guest = createNet(ow, guestRoom, { onKnock() {} });
  const relay = () => {
    guestRoom.state.g = JSON.parse(JSON.stringify(hostRoom.state.g));
    guestRoom.state.b = JSON.parse(JSON.stringify(hostRoom.state.b));
  };
  relay();
  guestRoom.clockMs = hostRoom.clockMs;
  guest.sync();
  const g = guest.g();
  assert.ok(g);
  assert.deepEqual(g.ids, hostNet.g().ids);
  assert.equal(guest.engine, null, 'only the host runs the rules');
  // two snapshots, then ask for the middle
  advance(100);
  relay();
  guest.sync();
  const b = hostRoom.state.b;
  const v = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, fl: 0 };
  assert.ok(guest.botView(g, 'bot2', b.t - 40, v));
  assert.ok(Number.isFinite(v.x) && v.x >= 0 && v.x <= 12);
  assert.ok(!guest.botView(g, 'p2', b.t, v), 'people are not bots');
  assert.ok(!guest.botView(g, 'bot99', b.t, v));
  assert.equal(guest.name('bot2', g), g.bn.bot2);
  assert.equal(guest.name('h', g), 'h');
});

test('a record from another match, or a broken one, is nothing; numbers are held in range', () => {
  const { room, net, advance } = host();
  advance(100);
  const good = room.state.g;
  room.state.g = { ...good, mid: 'M0' };
  assert.equal(net.g(), null);
  room.state.g = { ...good, ids: 'oops' };
  assert.equal(net.g(), null);
  room.state.g = { ...good, phase: 'dance' };
  assert.equal(net.g(), null);
  room.state.g = null;
  assert.equal(net.g(), null);
  room.state.g = { ...good, step: -4, scores: { h: 1e9, p2: 'x', bot1: NaN }, out: { h: 7.4 }, win: ['h', 'ghost'], rounds: 99, aw: { push: 'ghost', lucky: 'h' }, fa: 'soon' };
  const g = net.g();
  assert.ok(g);
  assert.equal(g.step, 1);
  assert.deepEqual(g.scores, { h: 9999 });
  assert.deepEqual(g.out, { h: 7 });
  assert.deepEqual(g.win, ['h']);
  assert.equal(g.rounds, 9);
  assert.deepEqual(g.aw, { push: null, lucky: 'h' });
  assert.equal(g.fa, 0);
});

test('a new host takes over from the room\'s copy and carries on', () => {
  const { room: oldRoom, net: oldNet, advance } = host();
  advance(2500);
  const gOld = oldNet.g();
  const newRoom = new FakeRoom('p2', 'p2', ['h', 'p2']);
  newRoom.state.g = JSON.parse(JSON.stringify(oldRoom.state.g));
  newRoom.state.b = JSON.parse(JSON.stringify(oldRoom.state.b));
  newRoom.clockMs = oldRoom.clockMs;
  ow.now = () => newRoom.clockMs;
  const net = createNet(ow, newRoom, { onKnock() {} });
  for (let t = 0; t < 600; t += DT_MS) {
    newRoom.clockMs += DT_MS;
    net.hostTick();
  }
  const g = net.g();
  assert.ok(g);
  assert.equal(g.by, 'p2', 'the new host wrote itself in');
  assert.equal(g.round, gOld.round, 'no reset');
  assert.ok(g.step >= gOld.step);
  assert.ok(net.engine);
  // losing the role drops the engine
  newRoom.host = 'h';
  newRoom.emit('host', 'h');
  assert.equal(net.engine, null);
  net.destroy();
});

test('a paused match stands still, a lost connection hands the role away', () => {
  const { room, net, advance } = host();
  advance(400);
  const rev = net.engine.rev;
  const now = room.matchNow();
  room.match = { ...room.match, paused: { since: room.clockMs } };
  for (let i = 0; i < 30; i++) net.hostTick();
  assert.equal(net.engine.rev, rev);
  assert.ok(now > 0);
  room.match = { ...room.match, paused: undefined };
  room.connected = false;
  net.hostTick();
  assert.equal(net.engine, null);
});

test('the stand-in room works on its own: ready, a countdown, a match, back to the lobby', async () => {
  const sa = makeStandalone();
  const room = await sa.rooms.join(JOIN);
  assert.equal(room.match.phase, 'lobby');
  assert.equal(room.isHost, true);
  assert.deepEqual(room.settings, { rounds: 3, speed: 'normal' });
  room.setSetting('rounds', 5);
  assert.equal(room.settings.rounds, 5);
  let started = false;
  room.on('matchstart', () => (started = true));
  room.setReady(true);
  assert.equal(room.match.phase, 'starting');
  await new Promise((r) => setTimeout(r, 3100));
  assert.ok(started);
  assert.equal(room.match.phase, 'playing');
  assert.ok(room.matchNow() >= 0);
  room.endMatch();
  assert.equal(room.match.phase, 'lobby');
  assert.equal(JOIN.maxPlayers, MAX_DANCERS);
  assert.equal(JOIN.minPlayers, 1);
  assert.equal(JOIN.lobby, 'bar');
  assert.deepEqual(JOIN.settings.map((s) => s.id), SETTINGS.map((s) => s.id));
  void timeline;
});
