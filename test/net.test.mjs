// Several pages racing through a stand-in room: everyone builds the same race, sees everyone else, the host's rival
// skippers reach every page, a reload puts a boat back where it was, a new host carries the skippers on, and the
// results agree. No browser: the match controller is plain code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from './fakeroom.mjs';
import { makeMatch, buildMatch, tickMatch, onMatchState, dropMatch } from '../game/js/match.js';
import { makeBrain } from '../game/js/sim/skippers.js';
import { applyBoatPresence, readBots, readRecord, mshort } from '../game/js/net.js';
import { raceSetup } from '../game/js/sim/setup.js';

const LOOK = { livery: 1, pattern: 'plain', cls: 'dinghy', num: 7, name: 0 };

function client(srv, id) {
  const room = srv.join(id);
  const m = makeMatch();
  room.on('state', (k, v) => onMatchState(m, k, v));
  return { id, room, m, errors: [] };
}

function rejoin(srv, c) {
  srv.drop(c.id);
  const room = srv.join(c.id);
  c.room = room;
  c.m = makeMatch(); // a fresh page knows nothing
  room.on('state', (k, v) => onMatchState(c.m, k, v));
}

/** One frame for every page still open: build the race when a match is on, sail it (on autopilot). */
function frame(srv, clients, ms = 50) {
  srv.tick(ms);
  for (const c of clients) {
    if (!srv.rooms.has(c.id)) continue;
    const room = c.room;
    try {
      if (room.match.phase === 'playing' && room.match.id) {
        if (c.m.mid !== room.match.id) {
          buildMatch(c.m, room, { names: (x) => x.toUpperCase(), checkpoint: null });
          const mine = c.m.meId ? c.m.session.race.byId.get(c.m.meId) : null;
          if (mine) mine.pilot = { brain: makeBrain(c.id.length * 97 + 3, 2, 'textbook') };
        }
        tickMatch(c.m, room, null, LOOK, ms / 1000, srv.now);
      } else if (c.m.mid) dropMatch(c.m);
    } catch (e) {
      c.errors.push(e.stack ?? String(e));
    }
  }
}

function runUntil(srv, clients, cond, maxMs) {
  const end = srv.now + maxMs;
  while (srv.now < end) {
    frame(srv, clients);
    if (cond()) return true;
  }
  return false;
}

test('three pages race together: one race, everyone visible, skippers mirrored, results agreed', () => {
  const srv = makeServer({ seed: 5, settings: { course: 7, courseHi: 0, laps: 1, weather: 'moderate', fleet: 'six', rules: 'casual' } });
  const cs = ['ann', 'bo', 'cy'].map((id) => client(srv, id));
  srv.start(1);
  frame(srv, cs);
  const setups = cs.map((c) => c.m.setup);
  for (const s of setups) {
    assert.equal(s.courseId, 7);
    assert.deepEqual(s.entries.map((e) => e.id), setups[0].entries.map((e) => e.id));
  }
  assert.equal(setups[0].entries.filter((e) => e.bot).length, 3, 'filled to six with three skippers');
  // Sail for a while: other boats move on every page, and the skippers reach the non-hosts.
  runUntil(srv, cs, () => false, 90000);
  const host = cs.find((c) => c.room.isHost);
  const other = cs.find((c) => !c.room.isHost);
  const hb = host.m.session.race.byId.get('bot1');
  const ob = other.m.session.race.byId.get('bot1');
  assert.ok(Math.hypot(hb.x - ob.x, hb.y - ob.y) < 8, `bot1 agrees: ${hb.x},${hb.y} vs ${ob.x},${ob.y}`);
  const annOnBo = cs[1].m.session.race.byId.get('ann');
  const annOwn = cs[0].m.session.race.byId.get('ann');
  assert.ok(Math.hypot(annOnBo.x - annOwn.x, annOnBo.y - annOwn.y) < 8, 'ann is where her page says she is');
  // To the finish and the results.
  assert.ok(runUntil(srv, cs, () => cs.every((c) => c.m.record?.done), 12 * 60000), 'the race ended');
  const rows = cs.map((c) => JSON.stringify(c.m.record.res));
  assert.equal(rows[0], rows[1]);
  assert.equal(rows[1], rows[2]);
  const res = cs[0].m.record.res;
  assert.equal(res.length, 6);
  assert.ok(res.filter((r) => r.t !== null).length >= 4, 'most of the fleet finished');
  // Places are 1..n, finishers sorted by time.
  const fins = res.filter((r) => r.t !== null);
  for (let i = 1; i < fins.length; i++) assert.ok(fins[i].t >= fins[i - 1].t);
  // The host ends the match after the results: back to the harbour.
  assert.ok(runUntil(srv, cs, () => srv.match.phase === 'lobby', 60000), 'the match ended');
  for (const c of cs) assert.deepEqual(c.errors, []);
});

test('a reload puts the boat back where it was; the host leaving hands the skippers on; three matches in a row', () => {
  const srv = makeServer({ seed: 11, settings: { course: 7, courseHi: 0, laps: 1, weather: 'shifty', fleet: 'six', rules: 'racing' } });
  const cs = ['ann', 'bo', 'cy'].map((id) => client(srv, id));
  for (let n = 1; n <= 3; n++) {
    srv.start(n);
    runUntil(srv, cs.filter((c) => srv.players.has(c.id)), () => false, 70000);
    // Reload bo mid-race.
    const bo = cs[1];
    const before = bo.m.session.race.byId.get('bo');
    const pos = { x: before.x, y: before.y, pi: before.pi };
    rejoin(srv, bo);
    frame(srv, cs);
    const after = bo.m.session.race.byId.get('bo');
    assert.ok(Math.hypot(after.x - pos.x, after.y - pos.y) < 6, `bo restored near ${pos.x},${pos.y}: ${after.x},${after.y}`);
    assert.equal(after.pi, pos.pi);
    assert.equal(bo.m.mid, srv.match.id);
    // The host's page drops mid-race (match 2): another page takes the skippers on.
    if (n === 2) {
      const hostC = cs.find((c) => c.room.isHost);
      const b1Before = { ...hostC.m.session.race.byId.get('bot1') };
      srv.drop(hostC.id);
      runUntil(srv, cs, () => false, 20000);
      const newHost = cs.find((c) => srv.rooms.has(c.id) && c.room.isHost);
      assert.ok(newHost && newHost !== hostC, 'a new host');
      const b1 = newHost.m.session.race.byId.get('bot1');
      assert.equal(b1.remote, false, 'the new host sails the skippers');
      assert.ok(b1.finished || Math.hypot(b1.x - b1Before.x, b1.y - b1Before.y) > 5, 'and they keep sailing');
      // The dropped page comes back as the same player.
      rejoin(srv, hostC);
    }
    assert.ok(runUntil(srv, cs, () => srv.match.phase === 'lobby', 15 * 60000), `match ${n} ran to the end`);
    for (const c of cs) {
      frame(srv, cs);
      assert.equal(c.m.mid, null, 'nothing left over in the harbour');
    }
  }
  assert.equal(srv.ended, 3);
  for (const c of cs) assert.deepEqual(c.errors, []);
});

test('presence and snapshots from a lying page are checked before use', () => {
  const srv = makeServer({ seed: 3, settings: { course: 1, fleet: 'six' } });
  const a = client(srv, 'a');
  srv.start(1);
  frame(srv, [a]);
  const race = a.m.session.race;
  const b = race.boats[1];
  const x0 = b.x;
  for (const bad of [null, 5, 'x', { s: 'r', m: 'nope' }, { s: 'r', m: mshort(srv.match.id), x: NaN, y: Infinity, h: 'a', v: 1e9, pi: -4 }]) {
    applyBoatPresence(b, bad, null, srv.match.id, race);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.h));
    assert.ok(b.v >= 0 && b.v <= 15 && b.pi >= 0);
  }
  void x0;
  assert.equal(readBots({ m: mshort(srv.match.id), t: 1, b: [[1, 2]] }, srv.match.id, 5), null);
  assert.equal(readBots({ m: 'other', t: 1, b: [] }, srv.match.id, 0), null);
  assert.equal(readRecord({ m: 'old' }, srv.match.id), null);
  const r = readRecord({ m: mshort(srv.match.id), fin: { x: -5, y: 'a', z: 40.5 }, done: 'yes' }, srv.match.id);
  assert.deepEqual(r.fin, { z: 40.5 });
  assert.equal(r.done, false);
});

test('a public server goes back to the harbour once every sailor has tapped Harbour, not before', () => {
  const srv = makeServer({ seed: 5, settings: { course: 7, courseHi: 0, laps: 1, weather: 'fresh', fleet: 'humans', rules: 'casual' } });
  const cs = ['ann', 'bo', 'cy'].map((id) => client(srv, id));
  srv.start(1);
  assert.ok(runUntil(srv, cs, () => cs.every((c) => c.m.record?.done), 12 * 60000), 'the race ended');
  // Two have tapped; the third is still reading: the host waits.
  cs[0].m.back = true;
  cs[1].m.back = true;
  assert.ok(!runUntil(srv, cs, () => srv.match.phase === 'lobby', 15000), 'one sailor still reading: no early end');
  cs[2].m.back = true;
  assert.ok(runUntil(srv, cs, () => srv.match.phase === 'lobby', 8000), 'all tapped: back in a few seconds');
  for (const c of cs) assert.deepEqual(c.errors, []);
});

test('a lone sailor with rival skippers gets a shorter pre-start; two or more get the full minute', () => {
  const one = raceSetup({ fleet: 'six' }, 9, ['ann'], {});
  const two = raceSetup({ fleet: 'six' }, 9, ['ann', 'bo'], {});
  assert.equal(one.preStart, 45);
  assert.equal(two.preStart, 60);
});

test('a page drawing four frames a second still keeps pace with the room clock', () => {
  const srv = makeServer({ seed: 5, settings: { course: 7, courseHi: 0, laps: 1, weather: 'fresh', fleet: 'six', rules: 'casual' } });
  const cs = ['ann', 'bo'].map((id) => client(srv, id));
  srv.start(1);
  runUntil(srv, cs, () => false, 90000);
  for (let i = 0; i < 240; i++) frame(srv, cs, 250); // a minute of quarter-second frames
  for (const c of cs) {
    const behind = c.room.matchNow() / 1000 - c.m.session.simT;
    assert.ok(behind < 1.5, `${c.id} is ${behind.toFixed(1)} s behind the room's clock`);
    assert.deepEqual(c.errors, []);
  }
});
