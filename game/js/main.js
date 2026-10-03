// Tack: boot, the frame loop, and which screen is up. The room is joined first, before anything heavy is built.

import { platform } from './platform.js';
import { JOIN, mshort } from './net.js';

// Join once, as the page loads (a reload must not miss its seat).
const joining = platform.available ? platform.join(JOIN) : Promise.resolve(null);

const { makeView, updateCamera } = await import('./render/view.js');
const { buildChart } = await import('./render/chart.js');
const { makeAir } = await import('./render/air.js');
const { makeSession, me, advance } = await import('./session.js');
const { makeSceneState, aimCamera, drawScene } = await import('./scene.js');
const { initInput, readInput, setInputEnabled, RACE_CONTROLS } = await import('./input.js');
const { makeNotices, eventNotice, currentNotice, notify, ordinal } = await import('./hints.js');
const { makeMatch, buildMatch, dropMatch, tickMatch, onMatchState, endMatch, RESULTS_PUBLIC_MS } = await import('./match.js');
const { botEntries } = await import('./sim/skippers.js');
const { cleanSettings, courseIndex, courseSettings, autoWeather, WEATHER_NAMES } = await import('./sim/setup.js');
const { PROFILE_KEY, parseProfile, newProfile, levelOf, unpackGhost, ghostAt, GHOST_HZ, BOAT_NAMES } = await import('./progress.js');
const { applyRace, awardOnce } = await import('./rewards.js');
const ui = await import('./ui.js');
const { lessonSession, careerSession, quickSession, tickSolo, soloOrder, settleCareer } = await import('./solo.js');
const { makeTeacher, teach } = await import('./tutorial.js');
const { CUPS } = await import('./career.js');
const { COURSES } = await import('./sim/course.js');
const audio = await import('./audio.js');

const canvas = document.getElementById('chart');
const view = makeView(canvas, () => platform.pixelRatio());
view.resize();
addEventListener('resize', () => view.resize());
initInput(canvas);

// ------------------------------------------------------------------------------------------------ state

const app = {
  room: null,
  profile: newProfile(),
  screen: 'title',
  closed: null,
  match: makeMatch(),
  solo: null,
  career: false,
  preview: null,
  previewKey: '',
  chart: null,
  chartFor: null,
  uiKey: '',
  lobbyHidden: null,
  controls: null,
  notices: makeNotices(),
  scene: makeSceneState(),
  air: makeAir(),
  teacher: null,
  results: null,
  ghost: null,
  ghostPts: [],
  ghostNext: 0,
  lastPresence: 0,
  dirty: false,
  lastSave: 0,
  quality: platform.quality,
  reduced: platform.reducedMotion,
};

const look = () => ({ ...app.profile.look, num: 7 });
const names = (id) => {
  const p = app.room?.players?.get(id);
  return String(p?.name ?? 'Sailor').slice(0, 24);
};

// ------------------------------------------------------------------------------------------------ saves

function markDirty() {
  app.dirty = true;
}

function flushSave(force = false) {
  const now = performance.now();
  if (!app.dirty || (!force && now - app.lastSave < 3000)) return;
  app.dirty = false;
  app.lastSave = now;
  platform.save(PROFILE_KEY, { ...app.profile, v: 1 });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushSave(true);
    saveCheckpoint();
    audio.suspend();
  } else audio.resume();
});

/** A race in progress, for a reload after the room has forgotten the boat (its seat hold ran out). */
function saveCheckpoint() {
  const m = app.match;
  const b = m.session && m.meId ? m.session.race.byId.get(m.meId) : null;
  if (!b || b.finished) return;
  platform.save('cp', { m: mshort(m.mid), t: m.session.simT, x: b.x, y: b.y, h: b.h, v: b.v, pi: b.pi, w: b.wind, ts: b.track.side, o: b.ocs ? 1 : 0, st: b.started ? 1 : 0, sT: b.startT, sm: b.stamina, s: 'r' });
}

// ------------------------------------------------------------------------------------------------ the room

function settings() {
  return cleanSettings(app.room?.settings ?? app.localSettings);
}
app.localSettings = cleanSettings({});

function hookRoom(room) {
  app.room = room;
  app.closed = null;
  room.on('state', (key, value) => {
    onMatchState(app.match, key, value);
    if (key === 'ow.settings') app.uiKey = '';
  });
  for (const ev of ['settings', 'ready', 'join', 'leave', 'rename', 'host', 'starting', 'match']) room.on(ev, () => (app.uiKey = ''));
  room.on('matchstart', () => {
    app.lobbyHidden = null;
    app.uiKey = '';
  });
  room.on('matchend', () => {
    dropMatch(app.match);
    app.results = null;
    app.lobbyHidden = null;
    app.uiKey = '';
  });
  room.on('close', (reason) => {
    if (reason === 'left' || reason === 'moved') return;
    app.closed = reason;
    dropMatch(app.match);
    app.uiKey = '';
  });
}

async function rejoin() {
  app.closed = null;
  app.uiKey = '';
  const room = await platform.join(JOIN);
  if (room) hookRoom(room);
}

function setLobbyHidden(hidden) {
  if (!app.room || app.lobbyHidden === hidden) return;
  app.lobbyHidden = hidden;
  try {
    app.room.hideLobby(hidden);
  } catch {}
}

function setControls(on) {
  const want = on ? 'race' : 'none';
  if (app.controls === want) return;
  app.controls = want;
  platform.setControls(on ? RACE_CONTROLS : null);
}

// ------------------------------------------------------------------------------------------------ what is on the water

/** The harbour's and title's background: rival skippers sailing the chosen course. */
function previewSession() {
  const st = settings();
  const ci = courseIndex(st) || 1;
  const weather = st.fleet === 'trial' ? 'classic' : st.weather === 'auto' ? 'moderate' : st.weather;
  const key = `${ci}:${weather}:${st.laps}`;
  if (app.previewKey !== key || !app.preview) {
    app.previewKey = key;
    const entries = botEntries(77, 6, [3, 2, 2, 1, 3, 2]);
    const s = makeSession({ seed: 4242 + ci, courseId: ci, laps: Math.min(2, st.laps), weather, rules: 'casual', entries, meId: null, preStart: 2, kind: 'preview' });
    advance(s, 40, null, 1e6);
    s.events.length = 0;
    s.clock = 40;
    app.preview = s;
  }
  return app.preview;
}

/** The session on screen now, and how to treat it. */
function current() {
  if (app.solo) return { s: app.solo.session, kind: 'solo' };
  const room = app.room;
  if (room && room.match?.phase === 'playing' && room.match.id) {
    if (app.match.mid !== room.match.id) {
      buildMatch(app.match, room, { names, checkpoint: app.checkpoint });
      app.results = null;
      app.ghost = null;
      app.ghostPts = [];
      app.ghostNext = 0;
      app.teacher = makeTeacher(app.profile, false);
      app.notices = makeNotices();
      if (app.match.setup?.trial) loadGhost(app.match.setup.courseId);
    }
    if (app.match.session) return { s: app.match.session, kind: 'match' };
  }
  return { s: previewSession(), kind: 'preview' };
}

async function loadGhost(courseId) {
  const g = unpackGhost(await platform.load(`ghost-${courseId}`));
  if (g && app.match.setup?.courseId === courseId) {
    app.ghost = { gh: g, boat: { id: 'ghost', name: 'Your best', drawX: 0, drawY: 0, drawH: 0, alpha: 0.4, ghost: true, livery: app.profile.look.livery, twa: 50, side: 1, v: 3, luff: 0, cls: g.cls, pattern: 'plain' } };
  }
}

// ------------------------------------------------------------------------------------------------ the loop

let last = performance.now();
let workMs = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  const w0 = performance.now();
  try {
    tick(ts);
  } catch (e) {
    // Never let one bad frame stop the game; report it once.
    if (!app.crashed) {
      app.crashed = true;
      console.error(e);
      setTimeout(() => {
        throw e;
      });
    }
  }
  workMs = workMs * 0.9 + (performance.now() - w0) * 0.1;
}

function tick(ts) {
  const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000));
  last = ts;
  if (document.hidden) return;
  const now = ts / 1000;
  const input = readInput(dt);
  if (input.any) audio.unlock();
  const cur = current();
  let events = [];
  let mine = null;
  if (cur.kind === 'solo') {
    events = tickSolo(app.solo, dt, input);
    mine = me(app.solo.session);
    if (app.solo.done && !app.solo.results) finishSolo();
  } else if (cur.kind === 'match') {
    events = tickMatch(app.match, app.room, input, look(), dt, performance.now());
    mine = app.match.meId ? me(app.match.session) : null;
    matchResults();
    recordGhost(app.match.session, mine);
  } else {
    const s = cur.s;
    s.clock = (s.clock ?? 0) + dt;
    if (s.race.phase === 'done' || s.clock > 400) app.previewKey = '';
    else advance(s, s.clock, null, 4);
    s.events.length = 0;
  }
  // Notices, sounds and in-context hints for the player's own boat.
  const meId = cur.s.meId;
  for (const e of events) {
    const cue = eventNotice(app.notices, e, meId, now, { slow: mine ? mine.v < mine.target * 0.85 : false });
    if (cue) audio.cue(cue, e, meId);
  }
  if (mine && app.teacher && teach(app.teacher, cur.s, mine, app.notices, now, platform.touch, app.solo?.kind === 'lesson' ? 99 : 2, dt)) markDirty();
  setControls(!!mine && !mine.finished && !app.closed && !(cur.kind === 'solo' && (app.solo.paused || app.solo.done)));
  presence(cur.kind);
  // Picture.
  if (app.chartFor !== cur.s.race) {
    app.chartFor = cur.s.race;
    app.chart = buildChart(cur.s.race);
    app.scene = makeSceneState();
  }
  if (cur.kind === 'preview') {
    framePreview(cur.s);
    updateCamera(view.cam, dt, app.reduced);
  } else aimCamera(view, app.scene, cur.s, dt, input, app.reduced);
  audio.update(cur.s, mine, dt, app.reduced);
  const extra = app.ghost && cur.kind === 'match' ? ghostBoat(cur.s) : null;
  drawScene(view, app.scene, cur.s, {
    quality: app.quality,
    reduced: app.reduced,
    touch: platform.touch,
    notice: cur.kind === 'preview' ? null : currentNotice(app.notices, now),
    now,
    bearing: bearingOf(cur.s.race),
    chart: app.chart,
    air: app.air,
    extra,
    show: { mini: cur.kind !== 'preview', standings: cur.kind !== 'preview', rose: cur.kind !== 'preview' },
    hud: cur.kind !== 'preview',
  });
  route(cur);
  flushSave();
}

const bearingOf = (race) => Math.round((((race.seed % 360) + 360) % 360) / 5) * 5;

/** The preview camera: the whole course, framed beside the harbour's panel (or the leaders under the title). */
function framePreview(s) {
  const cam = view.cam;
  const cb = s.race.course.bounds;
  if (app.screen === 'title') {
    let lead = null;
    for (const b of s.race.boats) if (!lead || b.pi > lead.pi || (b.pi === lead.pi && b.y < lead.y)) lead = b;
    if (lead) {
      cam.tx = lead.drawX;
      cam.ty = lead.drawY - 10;
      cam.tzoom = Math.min(view.w, view.h) / 95;
    }
    return;
  }
  // The free part of the screen: left of the panel and under the course's name (or between them on a phone).
  const narrow = view.w <= 640;
  const box = narrow ? { x0: 0, y0: 150, x1: view.w, y1: view.h * 0.42 + 40 } : { x0: 10, y0: 170, x1: view.w - Math.min(400, view.w * 0.46), y1: view.h - 20 };
  const z = Math.min((box.x1 - box.x0) / (cb.x1 - cb.x0 + 20), (box.y1 - box.y0) / (cb.y1 - cb.y0 + 20));
  cam.tzoom = Math.max(0.3, z);
  const cx = (cb.x0 + cb.x1) / 2;
  const cy = (cb.y0 + cb.y1) / 2;
  cam.tx = cx - ((box.x0 + box.x1) / 2 - view.w / 2) / cam.tzoom;
  cam.ty = cy - ((box.y0 + box.y1) / 2 - view.h / 2) / cam.tzoom;
}

// ------------------------------------------------------------------------------------------------ presence

function presence(kind) {
  const room = app.room;
  if (!room || kind === 'match') return;
  const now = performance.now();
  if (now - app.lastPresence < 1500) return;
  app.lastPresence = now;
  const s = app.solo ? 'l' : room.match?.phase === 'playing' ? 'w' : 'h';
  const lk = look();
  try {
    room.setPresence({ s, lk: [lk.livery, 0, ['dinghy', 'skiff', 'catboat', 'cat'].indexOf(lk.cls), 7, lk.name] });
  } catch {}
}

// ------------------------------------------------------------------------------------------------ ghosts

function recordGhost(s, b) {
  if (!s?.race.trial || !b || b.finished) return;
  const t = s.race.t - s.race.gunT;
  if (t < 0) return;
  while (app.ghostNext <= t) {
    app.ghostPts.push({ x: b.x, y: b.y });
    app.ghostNext += 1 / GHOST_HZ;
  }
}

const GP = { x: 0, y: 0, h: 0, done: false };
function ghostBoat(s) {
  const g = app.ghost;
  const t = Math.max(0, s.race.t - s.race.gunT);
  ghostAt(g.gh, t, GP);
  const b = g.boat;
  b.drawX = GP.x;
  b.drawY = GP.y;
  b.drawH = GP.h;
  b.alpha = GP.done ? 0.2 : 0.42;
  return [b];
}

// ------------------------------------------------------------------------------------------------ results

function fmt(t) {
  if (!Number.isFinite(t)) return 'DNF';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}

/** The match is over (the host's record says so): apply the player's race once, keep the card's data. */
function matchResults() {
  const m = app.match;
  const rec = m.record;
  if (!rec?.done || !rec.res || app.results?.mid === m.mid) return;
  const rows = rec.res;
  const meRow = m.meId ? rows.find((r) => r.id === m.meId) : null;
  let applied = null;
  if (meRow) {
    const b = m.session.race.byId.get(m.meId);
    const second = rows.find((r) => r.p === 2);
    applied = applyRace(app.profile, {
      key: `m:${mshort(m.mid)}`,
      place: meRow.p,
      fleet: rows.length,
      finished: meRow.t !== null,
      time: meRow.t,
      secondTime: second?.t ?? NaN,
      b,
      rules: m.session.race.rules,
      weather: m.session.race.weather,
      courseId: m.setup.courseId,
      trial: m.setup.trial,
      ghostPts: app.ghostPts,
      oldGhost: app.ghost?.gh ?? null,
    });
    if (applied) markDirty();
  }
  app.results = { mid: m.mid, rows, applied, meRow };
}

function finishSolo() {
  const so = app.solo;
  const order = soloOrder(so);
  const meIdx = order.findIndex((b) => b.id === 'me');
  const b = me(so.session);
  const fleet = order.length;
  const applied = applyRace(app.profile, {
    key: `s:${Date.now()}`,
    place: meIdx + 1,
    fleet,
    finished: !!b?.finished,
    time: b?.finishT ?? NaN,
    secondTime: order[1]?.finishT ?? NaN,
    b,
    rules: so.session.race.rules,
    weather: so.session.race.weather,
    courseId: so.session.race.course.id,
    trial: false,
  });
  let cup = null;
  if (so.kind === 'career') {
    cup = settleCareer(app.profile, so);
    if (cup.medal === 3) awardOnce(app.profile, 'cup-winner');
  }
  if (so.kind === 'lesson') app.profile.tutorial = true;
  markDirty();
  flushSave(true);
  so.results = { order, applied, cup };
  app.uiKey = '';
}

// ------------------------------------------------------------------------------------------------ screens

function route(cur) {
  const room = app.room;
  let key;
  if (app.closed) key = `closed:${app.closed}`;
  else if (app.screen === 'title') key = 'title';
  else if (app.solo) key = app.solo.results ? 'solo-res' : app.solo.paused ? 'pause' : `solo:${app.solo.kind}`;
  else if (app.career) key = `career:${JSON.stringify(app.profile.career)}`;
  else if (cur.kind === 'match') {
    const rec = app.match.record;
    if (rec?.done && app.results) {
      const left = rec.endAt !== null && room.kind !== 'private' ? Math.ceil((rec.endAt + RESULTS_PUBLIC_MS - room.matchNow()) / 1000) : null;
      key = `res:${app.match.mid}:${left}:${room.isHost}`;
    } else key = `race:${room.spectating ? 'w' : 'r'}`;
  } else key = `harbour:${harbourKey()}`;
  // Ready/Start is for the harbour only.
  setLobbyHidden(!(key.startsWith('harbour') || key.startsWith('res')));
  setInputEnabled(key.startsWith('race') || key.startsWith('solo:'));
  if (key === app.uiKey) return;
  app.uiKey = key;
  if (key.startsWith('closed')) ui.showClosed(app.closed, rejoin);
  else if (key === 'title') ui.showTitle(sail);
  else if (key === 'pause') ui.showPause(() => setPaused(false));
  else if (key === 'solo-res') showSoloResults();
  else if (key.startsWith('solo:')) ui.showCorner([[app.solo.kind === 'lesson' ? 'Skip' : 'Leave', leaveSolo]]);
  else if (key.startsWith('career')) ui.showCareer({ profile: app.profile, onSail: startCareer, onBack: () => ((app.career = false), (app.uiKey = '')) });
  else if (key.startsWith('res')) showMatchResults();
  else if (key.startsWith('race')) ui.clearUi();
  else showHarbour();
}

function harbourKey() {
  const room = app.room;
  return JSON.stringify([settings(), room?.isHost, room?.host, room?.match?.phase, look(), levelOf(app.profile.xp), room?.notReady?.map((p) => p.id), !!app.results]);
}

function sail() {
  audio.unlock();
  audio.cue('ui');
  app.screen = 'harbour';
  app.uiKey = '';
  if (!app.profile.tutorial) startLesson();
}

function showHarbour() {
  const room = app.room;
  const st = settings();
  const host = !room || room.isHost;
  const starting = room?.match?.phase === 'starting';
  const notReady = room?.notReady?.length ? `Waiting for ${room.notReady.slice(0, 3).map((p) => p.name).join(', ')}${room.notReady.length > 3 ? '…' : ''}` : '';
  ui.showHarbour({
    settings: st,
    canEdit: host && !starting,
    hostName: room ? names(room.host) : '',
    profile: app.profile,
    look: look(),
    solo: !room,
    notReady,
    onSet: (id, v) => setSetting(id, v),
    onCourse: (i) => {
      const cs = courseSettings(i);
      setSetting('course', cs.course);
      setSetting('courseHi', cs.courseHi);
    },
    onLook: (patch) => {
      Object.assign(app.profile.look, patch);
      markDirty();
      app.lastPresence = 0;
      app.uiKey = '';
      audio.cue('ui');
    },
    onCareer: starting ? null : () => ((app.career = true), (app.uiKey = ''), audio.cue('ui')),
    onTutorial: starting ? null : startLesson,
    invite: room && room.players.size < 2 ? () => platform.showInvite() : null,
    race: room ? null : startQuick,
  });
}

function setSetting(id, v) {
  audio.cue('ui');
  if (app.room) {
    try {
      app.room.setSetting(id, v);
    } catch {}
  } else app.localSettings = cleanSettings({ ...app.localSettings, [id]: v });
  app.uiKey = '';
}

function showMatchResults() {
  const room = app.room;
  const m = app.match;
  const r = app.results;
  const rows = r.rows.map((row) => ({ place: row.p, name: row.b ? row.n : row.n, bot: row.b === 1, time: row.t === null ? 'DNF' : fmt(row.t), me: row.id === m.meId, livery: row.lv }));
  const setup = m.setup;
  const rec = m.record;
  const left = rec.endAt !== null ? (rec.endAt + RESULTS_PUBLIC_MS - room.matchNow()) / 1000 : null;
  const priv = room.kind === 'private';
  const title = r.meRow ? (r.meRow.t === null ? 'Did not finish' : r.meRow.p === 1 ? 'Line honours' : `${ordinal(r.meRow.p)} place`) : 'Results';
  ui.showResults({
    eyebrow: 'RESULTS',
    title,
    sub: `${setup.courseName} · ${setup.trial ? 'Time trial' : WEATHER_NAMES[setup.weather]}`,
    rows,
    reward: r.applied ? { ...r.applied.reward, levelUp: r.applied.levelUp, level: r.applied.level } : null,
    medal: r.applied?.medal ?? 0,
    note: r.applied?.pb ? 'A new best on this course.' : '',
    onContinue: priv && room.isHost ? () => endMatch(m, room) : null,
    countdown: priv ? null : left,
  });
}

function showSoloResults() {
  const so = app.solo;
  const r = so.results;
  const rows = r.order.map((b, i) => ({ place: i + 1, name: b.name || 'You', bot: !!b.bot, time: b.finished ? fmt(b.finishT) : 'DNF', me: b.id === 'me', livery: b.livery }));
  const mePlace = rows.findIndex((x) => x.me) + 1;
  let title = so.kind === 'lesson' ? 'Lesson done' : mePlace === 1 ? 'Line honours' : `${ordinal(mePlace)} place`;
  let note = '';
  let cont = 'Harbour';
  let again = null;
  if (r.cup) {
    const cup = CUPS[so.cup];
    const place = r.cup.table.findIndex((x) => x.id === 'me') + 1;
    if (r.cup.last) {
      title = place === 1 ? `${cup.name} won` : `${cup.name}: ${ordinal(place)}`;
      note = place <= 3 ? 'A medal for the chart room.' : 'No medal this time.';
    } else {
      note = `${cup.name} · race ${so.race + 1} of 3 · you are ${ordinal(place)} on points`;
      cont = 'Next race';
    }
  }
  if (so.kind === 'quick') again = startQuick;
  ui.showResults({
    eyebrow: so.kind === 'career' ? 'CAREER' : so.kind === 'lesson' ? 'THE LESSON' : 'RESULTS',
    title,
    sub: `${so.session.race.course.name} · ${WEATHER_NAMES[so.session.race.weather] ?? ''}`,
    rows,
    reward: r.applied ? { ...r.applied.reward, levelUp: r.applied.levelUp, level: r.applied.level } : null,
    medal: r.cup?.last ? r.cup.medal : 0,
    note,
    continueLabel: cont,
    onContinue: () => {
      const wasCareer = so.kind === 'career' && !r.cup?.last;
      leaveSolo();
      if (wasCareer) startCareer(so.cup);
    },
    onAgain: again,
  });
}

// ------------------------------------------------------------------------------------------------ solo races

function beginSolo(so) {
  try {
    app.room?.setReady(false);
  } catch {}
  app.solo = so;
  app.career = false;
  app.teacher = makeTeacher(app.profile, so.kind === 'lesson');
  app.notices = makeNotices();
  app.uiKey = '';
  audio.unlock();
  audio.cue('ui');
}

function startLesson() {
  app.screen = 'harbour';
  beginSolo(lessonSession(look()));
}

function startCareer(cup) {
  const cur = app.profile.career.cur;
  const race = cur && cur.cup === cup ? cur.race : 0;
  if (!cur || cur.cup !== cup) app.profile.career.cur = { cup, race: 0, pts: {} };
  beginSolo(careerSession(app.profile, look(), cup, race));
}

function startQuick() {
  beginSolo(quickSession(settings(), look(), (Math.random() * 1e9) >>> 0));
}

function leaveSolo() {
  app.solo = null;
  app.teacher = null;
  app.uiKey = '';
  setControls(false);
  audio.cue('ui');
}

function setPaused(p) {
  if (!app.solo) return;
  app.solo.paused = p;
  app.uiKey = '';
}

// Enter (or Space) on the title sails.
addEventListener('keydown', (e) => {
  if (app.screen === 'title' && !app.closed && (e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    sail();
  }
});

platform.on('pause', () => app.solo && setPaused(true));
platform.on('resume', () => app.solo && setPaused(false));
platform.onSettings(() => {
  app.quality = platform.quality;
  app.reduced = platform.reducedMotion;
  view.resize();
});

// ------------------------------------------------------------------------------------------------ boot

async function fontsReady(ms = 1500) {
  try {
    await Promise.race([Promise.all([document.fonts.load("500 16px 'Spectral'"), document.fonts.load("italic 500 16px 'Spectral'"), document.fonts.load("500 16px 'Plex Mono'")]), new Promise((r) => setTimeout(r, ms))]);
  } catch {}
}

const [room, saved] = await Promise.all([joining, platform.load(PROFILE_KEY).catch(() => null), fontsReady()]);
app.profile = parseProfile(saved);
app.checkpoint = await platform.load('cp').catch(() => null);
if (room) hookRoom(room);
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
window.__tack = { app, view, workMs: () => workMs };
