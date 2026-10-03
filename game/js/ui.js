// The screens drawn in the page (the chart is the canvas underneath): title, harbour, results, career, pause and the
// room-closed card. Built from elements and textContent only (names come from other players).

import { LIVERIES } from './render/view.js';
import { PATTERNS, BOAT_NAMES, FLAGS, WAKES, HORNS, cosmeticOpen, levelOf, levelProgress, liveryOpen, patternOpen, classOpen, nameOpen, PARS } from './progress.js';
import { SETTINGS, courseIndex, WEATHER_NAMES } from './sim/setup.js';
import { COURSES } from './sim/course.js';
import { CLASSES } from './sim/polar.js';
import { CUPS, cupOpen } from './career.js';

const root = () => document.getElementById('ui');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function button(label, onClick, cls = '') {
  const b = el('button', `btn ${cls}`.trim(), label);
  b.type = 'button';
  let last = 0;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - last < 250) return; // a double tap is one press
    last = now;
    onClick?.(e);
  });
  return b;
}

/** Clears the UI layer. */
export function clearUi() {
  root().replaceChildren();
}

// ------------------------------------------------------------------------------------------------ title

export function showTitle(onSail) {
  const wrap = el('div', 'screen title');
  const mark = el('h1', 'wordmark', 'TACK');
  const go = button('Sail', onSail, 'primary big');
  go.setAttribute('aria-label', 'Sail');
  wrap.append(mark, go);
  root().replaceChildren(wrap);
}

// ------------------------------------------------------------------------------------------------ harbour

const COURSE_NAMES = ['Auto', ...COURSES.map((c) => c.name)];

/**
 * The harbour: the course and conditions over the chart, the host's settings, your boat, and solo sailing.
 * h: { settings, host, hostName, canEdit, profile, look, record, onSet(id, v), onLook(patch), onCareer, onTutorial, notReady }
 */
export function showHarbour(h) {
  const wrap = el('div', 'screen harbour');
  const ci = courseIndex(h.settings);
  const head = el('header', 'harbour-head');
  const def = ci ? COURSES[ci - 1] : null;
  head.append(el('div', 'eyebrow', 'THE HARBOUR'), el('h2', 'course-name', def ? def.name : 'Course at the gun'));
  const sub = [];
  if (def) sub.push(def.kind);
  if (def?.lapped && h.settings.fleet !== 'trial') sub.push(`${h.settings.laps} ${h.settings.laps === 1 ? 'lap' : 'laps'}`);
  sub.push(h.settings.fleet === 'trial' ? 'Classic 12 kn' : h.settings.weather === 'auto' ? 'Weather at the gun' : WEATHER_NAMES[h.settings.weather]);
  head.append(el('div', 'course-sub', sub.join(' · ')));
  const panel = el('section', 'panel');
  // The race settings: the host changes them; everyone sees them.
  const race = el('div', 'block');
  race.append(el('div', 'block-title', h.canEdit ? 'RACE' : `RACE · ${h.hostName ? `set by ${h.hostName}` : 'set by the host'}`));
  const rows = [
    ['Course', COURSE_NAMES[ci], () => step(COURSE_NAMES.length, ci, -1, (v) => h.onCourse(v)), () => step(COURSE_NAMES.length, ci, 1, (v) => h.onCourse(v))],
    ['Laps', String(h.settings.laps), ...cycle('laps', h)],
    ['Weather', labelOf('weather', h.settings.weather), ...cycle('weather', h)],
    ['Fleet', labelOf('fleet', h.settings.fleet), ...cycle('fleet', h)],
    ['Rules', h.settings.rules.startsWith('racing') ? 'Racing' : 'Casual', () => h.onSet('rules', flipRules(h.settings.rules, 'rules')), () => h.onSet('rules', flipRules(h.settings.rules, 'rules'))],
    ['Classes', h.settings.rules.endsWith('mixed') ? 'Mixed' : 'One design', () => h.onSet('rules', flipRules(h.settings.rules, 'class')), () => h.onSet('rules', flipRules(h.settings.rules, 'class'))],
  ];
  for (const [label, value, prev, next] of rows) race.append(stepper(label, value, h.canEdit, prev, next));
  if (h.race) {
    const go = el('div', 'row');
    go.append(button('Race', h.race, 'primary big'));
    race.append(go);
  }
  panel.append(race);
  // Your boat.
  const boat = el('div', 'block');
  const lvl = levelOf(h.profile.xp);
  const cap = el('div', 'block-title', `YOUR BOAT · CAPTAIN ${lvl}`);
  const bar = el('div', 'xpbar');
  const fill = el('i');
  fill.style.width = `${Math.round(levelProgress(h.profile.xp) * 100)}%`;
  bar.append(fill);
  boat.append(cap, bar);
  const sw = el('div', 'swatches');
  LIVERIES.forEach((lv, i) => {
    const open = liveryOpen(h.profile, i);
    const b = button('', () => open && h.onLook({ livery: i }), `swatch${h.look.livery === i ? ' on' : ''}${open ? '' : ' locked'}`);
    b.style.setProperty('--c', lv.color);
    b.setAttribute('aria-label', open ? lv.name : `${lv.name}, opens at Captain ${[1, 1, 1, 1, 2, 3, 4, 5, 6, 7][i]}`);
    b.title = b.getAttribute('aria-label');
    sw.append(b);
  });
  boat.append(sw);
  const pats = PATTERNS.filter((p) => patternOpen(h.profile, p.id));
  const pi = Math.max(0, pats.findIndex((p) => p.id === h.look.pattern));
  boat.append(stepper('Sail', pats[pi]?.name ?? 'Plain', pats.length > 1, () => h.onLook({ pattern: pats[(pi - 1 + pats.length) % pats.length].id }), () => h.onLook({ pattern: pats[(pi + 1) % pats.length].id })));
  if (h.settings.rules.endsWith('mixed') || h.solo) {
    const classes = ['dinghy', 'skiff', 'catboat', 'cat'].filter((c) => classOpen(h.profile, c));
    const k = Math.max(0, classes.indexOf(h.look.cls));
    boat.append(stepper('Class', CLASSES[classes[k]]?.name ?? 'Dinghy', classes.length > 1, () => h.onLook({ cls: classes[(k - 1 + classes.length) % classes.length] }), () => h.onLook({ cls: classes[(k + 1) % classes.length] })));
  }
  // Burgee, wake and horn: whatever the level has opened (one stepper each, shown once there is a choice).
  for (const [label, list, key] of [['Flag', FLAGS, 'flag'], ['Wake', WAKES, 'wake'], ['Horn', HORNS, 'horn']]) {
    const open = list.filter((x) => cosmeticOpen(h.profile, list, x.id));
    if (open.length < 2) continue;
    const k = Math.max(0, open.findIndex((x) => x.id === h.look[key]));
    boat.append(stepper(label, open[k].name, true, () => h.onLook({ [key]: open[(k - 1 + open.length) % open.length].id }), () => h.onLook({ [key]: open[(k + 1) % open.length].id })));
  }
  const names = BOAT_NAMES.map((n, i) => i).filter((i) => nameOpen(h.profile, i));
  const ni = Math.max(0, names.indexOf(h.look.name));
  boat.append(stepper('Name', BOAT_NAMES[names[ni]] ?? BOAT_NAMES[0], names.length > 1, () => h.onLook({ name: names[(ni - 1 + names.length) % names.length] }), () => h.onLook({ name: names[(ni + 1) % names.length] })));
  panel.append(boat);
  // Sailing on your own.
  const solo = el('div', 'block');
  solo.append(el('div', 'block-title', 'ON YOUR OWN'));
  const row = el('div', 'row');
  row.append(button('Career', h.onCareer), button('Lesson', h.onTutorial));
  if (h.invite) row.append(button('Invite', h.invite));
  if (!h.onCareer) for (const b of row.querySelectorAll('button')) if (b.textContent !== 'Invite') b.disabled = true;
  solo.append(row);
  panel.append(solo);
  if (h.notReady) panel.append(el('div', 'waiting', h.notReady));
  wrap.append(head, panel);
  root().replaceChildren(wrap);
}

function step(n, i, d, fn) {
  fn((i + d + n) % n);
}

function cycle(id, h) {
  const st = SETTINGS.find((s) => s.id === id);
  const vals = st.options.map((o) => o.value);
  const i = Math.max(0, vals.indexOf(h.settings[id]));
  return [() => h.onSet(id, vals[(i - 1 + vals.length) % vals.length]), () => h.onSet(id, vals[(i + 1) % vals.length])];
}

function labelOf(id, v) {
  return SETTINGS.find((s) => s.id === id)?.options.find((o) => o.value === v)?.label ?? String(v);
}

function flipRules(cur, which) {
  const racing = cur.startsWith('racing');
  const mixed = cur.endsWith('mixed');
  const r = which === 'rules' ? !racing : racing;
  const m = which === 'class' ? !mixed : mixed;
  return `${r ? 'racing' : 'casual'}${m ? '-mixed' : ''}`;
}

function stepper(label, value, editable, prev, next) {
  const row = el('div', 'stepper');
  row.append(el('span', 'label', label.toUpperCase()));
  if (editable) {
    const a = button('‹', prev, 'arrow');
    a.setAttribute('aria-label', `${label}: previous`);
    const b = button('›', next, 'arrow');
    b.setAttribute('aria-label', `${label}: next`);
    row.append(a, el('span', 'value', value), b);
  } else row.append(el('span', 'value ro', value));
  return row;
}

// ------------------------------------------------------------------------------------------------ results

/**
 * The results card. r: { title, sub, rows: [{ place, name, bot, time, me, livery }], reward: { parts, xp, level, levelUp },
 * medal, badges: [names], onContinue (host of a private server) | null, countdown: seconds | null }
 */
export function showResults(r) {
  const wrap = el('div', 'screen results');
  // The heading over the chart (where the race is plotted), the table beside it like a chart's legend.
  const head = el('header', 'harbour-head');
  head.append(el('div', 'eyebrow', r.eyebrow ?? 'RESULTS'), el('h2', 'course-name', r.title), el('div', 'course-sub', r.sub ?? ''));
  const card = el('section', 'panel legend');
  const table = el('ol', 'table');
  for (const row of r.rows) {
    const li = el('li', row.me ? 'me' : '');
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', LIVERIES[row.livery ?? 0]?.color ?? '#999');
    li.append(el('span', 'place', String(row.place)), dot, el('span', 'name', row.name + (row.bot ? '  (bot)' : '')), el('span', 'time', row.time));
    table.append(li);
  }
  card.append(table);
  if (r.reward) {
    const rw = el('div', 'reward');
    for (const [label, v] of r.reward.parts) rw.append(el('span', 'part', `${label} +${v}`));
    rw.append(el('span', 'total', `+${r.reward.xp} XP`));
    card.append(rw);
    if (r.reward.levelUp) card.append(el('div', 'levelup', `Captain ${r.reward.level}`));
  }
  if (r.medal) card.append(el('div', `medal m${r.medal}`, ['', 'Bronze', 'Silver', 'Gold'][r.medal]));
  if (r.note) card.append(el('div', 'note', r.note));
  const foot = el('div', 'row');
  if (r.onContinue) foot.append(button(r.continueLabel ?? 'Harbour', r.onContinue, 'primary'));
  if (r.onAgain) foot.append(button('Again', r.onAgain));
  if (r.countdown !== null && r.countdown !== undefined) foot.append(el('span', 'countdown', `Harbour in ${Math.max(0, Math.ceil(r.countdown))}s`));
  if (foot.childNodes.length) card.append(foot);
  wrap.append(head, card);
  root().replaceChildren(wrap);
}

// ------------------------------------------------------------------------------------------------ career

/** The career chart: eight cups, three races each. c: { profile, onSail(cup), onBack } */
export function showCareer(c) {
  const wrap = el('div', 'screen career');
  const card = el('div', 'card wide');
  card.append(el('div', 'eyebrow', 'CAREER'), el('h2', 'card-title', 'Eight cups'));
  const list = el('ol', 'cups');
  CUPS.forEach((cup, i) => {
    const open = cupOpen(c.profile.career.cups, i);
    const medal = c.profile.career.cups[i] ?? 0;
    const cur = c.profile.career.cur?.cup === i ? c.profile.career.cur : null;
    const li = el('li', open ? '' : 'locked');
    const txt = el('div', 'cup-text');
    txt.append(el('div', 'cup-name', `${i + 1}. ${cup.name}`), el('div', 'cup-note', open ? cup.note : `Medal in the ${CUPS[i - 1].name}`));
    li.append(txt);
    if (medal) li.append(el('span', `medal small m${medal}`, ['', 'Bronze', 'Silver', 'Gold'][medal]));
    if (open) li.append(button(cur ? `Race ${cur.race + 1}` : 'Sail', () => c.onSail(i), cur ? 'primary' : ''));
    list.append(li);
  });
  card.append(list, el('div', 'row'));
  card.lastChild.append(button('Harbour', c.onBack));
  wrap.append(card);
  root().replaceChildren(wrap);
}

// ------------------------------------------------------------------------------------------------ small cards

export function showPause(onResume) {
  const wrap = el('div', 'screen veil');
  const card = el('div', 'card small');
  card.append(el('h2', 'card-title', 'Paused'), el('div', 'row'));
  card.lastChild.append(button('Resume', onResume, 'primary'));
  wrap.append(card);
  root().replaceChildren(wrap);
}

export function showClosed(reason, onAgain) {
  const msg = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : 'Connection lost';
  const label = reason === 'kicked' ? 'Play' : reason === 'replaced' ? 'Play here' : 'Rejoin';
  const wrap = el('div', 'screen veil');
  const card = el('div', 'card small');
  card.append(el('h2', 'card-title', msg), el('div', 'row'));
  card.lastChild.append(button(label, onAgain, 'primary'));
  wrap.append(card);
  root().replaceChildren(wrap);
}

/** A small strip for an in-race action (Skip for the lesson, Retire for a solo race). */
export function showCorner(items) {
  const wrap = el('div', 'corner');
  for (const [label, fn] of items) wrap.append(button(label, fn, 'ghost'));
  root().replaceChildren(wrap);
}

export function parTime(courseId) {
  const p = PARS[courseId];
  return p ? `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` : '';
}
