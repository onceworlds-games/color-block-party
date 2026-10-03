// A race in the room. Every page builds the same race from the match's seed, participants and settings. Each page
// simulates its own boat and puts it in presence; the host's page sails the rival skippers and puts them in room state;
// the host checks finishes and writes the results. A reload restores the boat from its own presence (or the save
// checkpoint), a new host adopts the skippers from their last snapshot, and nothing depends on one page's memory.

import { makeSession, advance, decorate } from './session.js';
import { raceSetup } from './sim/setup.js';
import { SIM_DT, standings, HORNS } from './sim/race.js';
import { makeBrain } from './sim/skippers.js';
import { applyBoatPresence, applyBotRow, boatPresence, decodeLook, fin, mshort, packBots, readBots, readRecord } from './net.js';

export const RESULTS_PUBLIC_MS = 35000;
export const RESULTS_PRIVATE_MS = 180000;
const RETIRE_HIDE_S = 15;

export function makeMatch() {
  return {
    mid: null,
    setup: null,
    session: null,
    meId: null,
    bots: [],
    botBuf: [],
    botsLocal: false,
    record: null,
    recordStr: '',
    lastPres: 0,
    lastBots: 0,
    lastRec: 0,
    gone: new Map(),
    doneSeen: false,
    endCalled: false,
    back: false, // this page's player tapped Harbour on the results
  };
}

/** Tears the race down (the match ended or the page left it). */
export function dropMatch(m) {
  m.mid = null;
  m.setup = null;
  m.session = null;
  m.bots = [];
  m.botBuf = [];
  m.record = null;
  m.recordStr = '';
  m.gone.clear();
  m.doneSeen = false;
  m.endCalled = false;
  m.back = false;
}

/** The participants' looks, from their presence (defaults when there is none yet). */
function looksOf(room, ids, names) {
  const out = {};
  for (const id of ids) {
    const p = room.players.get(id);
    const lk = decodeLook(p?.presence?.lk) ?? {};
    out[id] = { ...lk, name: names(id) };
  }
  return out;
}

/** Builds (or rebuilds) the race for the room's current match. */
export function buildMatch(m, room, { names, checkpoint }) {
  const match = room.match;
  const ids = (match.participants ?? []).filter((x) => typeof x === 'string').slice(0, 10);
  const setup = raceSetup(room.settings, match.seed >>> 0, ids, looksOf(room, ids, names));
  const meId = !room.spectating && ids.includes(room.me.id) ? room.me.id : null;
  const botIds = setup.entries.filter((e) => e.bot).map((e) => e.id);
  const isHost = room.isHost;
  const local = [...(meId ? [meId] : []), ...(isHost ? botIds : [])];
  const looks = {};
  for (const e of setup.entries) looks[e.id] = { livery: e.livery, pattern: e.pattern, num: e.num, name: e.name, flag: e.flag, wake: e.wake };
  const session = makeSession({ ...setup, entries: setup.entries, meId, local, looks, kind: setup.trial ? 'trial' : 'race' });
  dropMatch(m);
  m.mid = match.id;
  m.setup = setup;
  m.session = session;
  m.meId = meId;
  m.bots = botIds.map((id) => session.race.byId.get(id));
  m.botsLocal = isHost;
  const race = session.race;
  const target = Math.max(0, room.matchNow() / 1000);
  // My boat: back where it was (a reload), or at the start area now (a first look after the gun).
  const mine = meId ? race.byId.get(meId) : null;
  const p = room.players.get(room.me.id)?.presence;
  let restored = false;
  if (mine && p && p.s === 'r' && p.m === mshort(match.id)) restored = restoreBoat(mine, p, race, session);
  if (mine && !restored && checkpoint && checkpoint.m === mshort(match.id)) restored = restoreBoat(mine, checkpoint, race, session);
  if (!restored) setClock(race, session, Math.max(0, target - 0.5));
  // Rival skippers: the host's last snapshot, if this page is the host now and one exists.
  const snap = readBots(room.state.bots, match.id, m.bots.length);
  if (snap) {
    m.botBuf = [snap];
    if (isHost) adoptBots(m, snap, race);
  }
  m.record = readRecord(room.state.race, match.id);
  return m;
}

function setClock(race, session, t) {
  race.t = t;
  session.simT = t;
  race.hornNext = HORNS.filter((h) => t >= race.gunT - h).length;
  if (t >= race.gunT) {
    race.gunFired = true;
    race.phase = 'race';
  }
}

/** Puts a boat back from a presence or checkpoint record (every number checked). */
function restoreBoat(b, p, race, session) {
  if (!applyBoatPresence(b, { ...p, s: 'r' }, null, race.wind ? p.m : '', race) && p.m === undefined) return false;
  const t = fin(p.t, 0, 36000, -1);
  if (t < 0) return false;
  b.remote = false;
  b.track.side = p.ts === 1 ? 1 : p.ts === -1 ? -1 : 0;
  b.man = null;
  setClock(race, session, t);
  return true;
}

/** Turns the remote skippers into this page's own, from their last snapshot (a new host carries on). */
function adoptBots(m, snap, race) {
  m.bots.forEach((b, i) => {
    const row = snap.b[i];
    if (!row) return;
    applyBotRow(b, row, row, 1, race);
    b.remote = false;
    b.man = null;
    if (b.bot && !b.bot.brain) b.bot.brain = makeBrain(i + 1, b.bot.skill ?? 2, b.bot.persona ?? 'textbook');
    if (b.bot?.brain) {
      b.bot.brain.going = true; // past the start plan: race
      b.bot.brain.next = 0;
    }
  });
  m.botsLocal = true;
}

/**
 * One frame of the match. Returns the race events for the picture and sound. `input` drives my boat; `look` is my
 * look for presence; `frameDt` the frame's seconds.
 */
export function tickMatch(m, room, input, look, frameDt, nowMs) {
  const s = m.session;
  if (!s) return [];
  const race = s.race;
  const mid = m.mid;
  const target = Math.max(0, room.matchNow() / 1000);
  const isHost = room.isHost && room.connected;
  // The host role moved here: adopt the skippers.
  if (isHost && !m.botsLocal) {
    const snap = m.botBuf[m.botBuf.length - 1] ?? readBots(room.state.bots, mid, m.bots.length);
    if (snap) adoptBots(m, snap, race);
    else {
      for (const b of m.bots) b.remote = false;
      m.botsLocal = true;
    }
  } else if (!isHost && m.botsLocal && m.bots.length) {
    // Lost the role (a drop): the new host's snapshots take over.
    for (const b of m.bots) b.remote = true;
    m.botsLocal = false;
  }
  // Other people's boats, from presence (smoothed).
  for (const b of race.boats) {
    if (b.bot || b.id === m.meId) continue;
    const pl = room.players.get(b.id);
    if (!pl) {
      if (!m.gone.has(b.id)) m.gone.set(b.id, target);
      b.retired = !b.finished;
      b.hidden = target - m.gone.get(b.id) > RETIRE_HIDE_S;
      b.remote = true;
      continue;
    }
    m.gone.delete(b.id);
    b.hidden = false;
    b.retired = false;
    b.away = pl.connected === false;
    b.ghost = b.away || race.trial;
    let at = null;
    try {
      at = room.presenceAt(b.id, { angles: ['h'], snap: 25 });
    } catch {}
    applyBoatPresence(b, pl.presence, at, mid, race);
  }
  // The skippers on other pages: between the host's last two snapshots, a little in the past.
  if (!m.botsLocal && m.botBuf.length) {
    const tt = room.matchNow() - 150;
    let a = m.botBuf[0];
    let c = m.botBuf[m.botBuf.length - 1];
    for (let i = 0; i + 1 < m.botBuf.length; i++) {
      if (m.botBuf[i].t <= tt && m.botBuf[i + 1].t >= tt) {
        a = m.botBuf[i];
        c = m.botBuf[i + 1];
      }
    }
    const k = c.t > a.t ? Math.max(0, Math.min(1, (tt - a.t) / (c.t - a.t))) : 1;
    m.bots.forEach((b, i) => {
      if (a.b[i] && c.b[i]) applyBotRow(b, a.b[i], c.b[i], k, race);
    });
  }
  // The host keeps the officer's record of the first finish (the race's closing time follows it).
  const rec = m.record;
  if (rec?.first !== null && rec?.first !== undefined && (race.firstFinishT === null || rec.first < race.firstFinishT)) race.firstFinishT = rec.first;
  // Step what this page sails, catching up at most twice real time after a pause.
  const behind = target - s.simT;
  const maxSteps = behind > 0.25 ? Math.ceil((frameDt * 2) / SIM_DT) + 1 : 4;
  const mine = m.meId ? race.byId.get(m.meId) : null;
  const finishedBefore = mine?.finished;
  advance(s, target, mine && !mine.finished ? input : null, maxSteps);
  const events = s.events.splice(0);
  // Presence: my boat, twenty times a second (the platform paces it).
  if (mine && nowMs - m.lastPres >= 50) {
    m.lastPres = nowMs;
    try {
      room.setPresence(boatPresence(mine, mid, s.simT, look, m.back));
    } catch {}
  }
  if (isHost) hostDuties(m, room, nowMs, target);
  if (mine && mine.finished && !finishedBefore) m.justFinished = true;
  return events;
}

/** Host only: publish the skippers, keep the record of finishes, close the race, end the match after the results. */
function hostDuties(m, room, nowMs, target) {
  const s = m.session;
  const race = s.race;
  const mid = m.mid;
  if (m.bots.length && nowMs - m.lastBots >= 100) {
    m.lastBots = nowMs;
    try {
      room.setState('bots', packBots(race, m.bots, mid, room.matchNow()));
    } catch {}
  }
  if (nowMs - m.lastRec < 250) return;
  m.lastRec = nowMs;
  const prev = m.record ?? readRecord(room.state.race, mid);
  const finT = { ...(prev?.fin ?? {}) };
  const raceNow = target - race.gunT;
  const minT = race.course.total / 11; // no boat sails the course faster than this
  for (const b of race.boats) {
    if (!b.finished || finT[b.id] !== undefined || !Number.isFinite(b.finishT)) continue;
    if (b.pi < race.course.targets.length || b.finishT < minT || b.finishT > raceNow + 3) continue;
    finT[b.id] = b.finishT;
  }
  let first = null;
  for (const t of Object.values(finT)) first = first === null ? t : Math.min(first, t);
  // Over when everyone still in it has finished, or the line closes after the winner, or the hard limit.
  const active = race.boats.filter((b) => !b.hidden && !(b.retired && !b.finished));
  const allIn = active.length > 0 && active.every((b) => finT[b.id] !== undefined);
  const window = race.trial ? Math.max(120, 0.5 * (first ?? 0)) : Math.max(60, 0.3 * (first ?? 0));
  const closed = first !== null && raceNow > first + window;
  const hard = target > race.hardLimit;
  let done = prev?.done === true;
  let endAt = prev?.endAt ?? null;
  let res = prev?.res ?? null;
  if (!done && (allIn || closed || hard) && raceNow > 0) {
    done = true;
    endAt = room.matchNow();
    res = resultsRows(race, finT);
  }
  const rec = { m: mshort(mid), by: room.me.id, fin: finT, first, done, endAt, res };
  const str = JSON.stringify(rec);
  if (str !== m.recordStr) {
    m.recordStr = str;
    m.record = readRecord(rec, mid);
    try {
      room.setState('race', rec);
    } catch {}
  }
  // After the results have been up long enough: back to the harbour (a private server's host continues by hand).
  if (done && !m.endCalled && endAt !== null) {
    const priv = room.kind === 'private';
    const waited = room.matchNow() - endAt;
    // A public server doesn't wait out the clock once every sailor has tapped Harbour.
    if (waited > (priv ? RESULTS_PRIVATE_MS : RESULTS_PUBLIC_MS) || (!priv && waited > EARLY_END_MS && everyoneBack(m, room))) endMatch(m, room);
  }
}

const EARLY_END_MS = 2500;

/** Is every sailor still here (people, not rival skippers) back on the harbour button? A page that is gone doesn't hold anyone up. */
export function everyoneBack(m, room) {
  let any = false;
  for (const id of m.setup?.humans ?? []) {
    if (id === m.meId) {
      if (!m.back) return false;
      any = true;
      continue;
    }
    const pl = room.players.get(id);
    if (!pl || pl.connected === false) continue;
    const p = pl.presence;
    if (!p || p.s !== 'r' || p.m !== mshort(m.mid) || p.rd !== 1) return false;
    any = true;
  }
  return any || room.spectating === false;
}

export function endMatch(m, room) {
  if (m.endCalled) return;
  m.endCalled = true;
  try {
    room.endMatch();
  } catch {}
}

/** The final order: finishers by time (ties by id), then the rest by how far they got. */
export function resultsRows(race, finT) {
  const order = standings(race);
  const fins = order.filter((b) => finT[b.id] !== undefined).sort((a, b) => finT[a.id] - finT[b.id] || (a.id < b.id ? -1 : 1));
  const rest = order.filter((b) => finT[b.id] === undefined);
  return [...fins, ...rest].map((b, i) => ({
    id: b.id,
    n: String(b.name ?? '').slice(0, 24),
    b: b.bot ? 1 : 0,
    p: i + 1,
    t: finT[b.id] ?? null,
    pi: b.pi,
    lv: b.livery ?? 0,
  }));
}

/** A room state update: snapshots of the skippers and the race record. */
export function onMatchState(m, key, value) {
  if (!m.session) return;
  if (key === 'bots') {
    const snap = readBots(value, m.mid, m.bots.length);
    if (!snap) return;
    const last = m.botBuf[m.botBuf.length - 1];
    if (last && snap.t <= last.t) return;
    m.botBuf.push(snap);
    if (m.botBuf.length > 4) m.botBuf.shift();
  } else if (key === 'race') {
    const r = readRecord(value, m.mid);
    if (r) {
      m.record = r;
      m.recordStr = JSON.stringify(value);
    }
  }
}

export { decorate };
