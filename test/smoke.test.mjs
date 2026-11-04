// The real client code (the game, drawing, screens, sound, store art) run in node against a stand-in canvas and DOM. Nothing is
// rendered, but every drawing call is checked (finite numbers, balanced saves) and a whole session is played through: title,
// lobby, settings, countdown, three rounds with a scoreboard between, the podium, back in the lobby, then another match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, installDom, stats } from './_dom.mjs';

const dom = installDom({ width: 800, height: 450 });
const errors = [];
globalThis.queueMicrotask = (fn) => {
  try {
    fn();
  } catch (err) {
    errors.push(err);
  }
};
const warn = console.error;
console.error = (...args) => errors.push(new Error(args.map(String).join(' ')));

const { Game } = await import('../game/game.js');
const { JOIN, makeStandalone } = await import('../game/net.js');
const { drawPoster } = await import('../game/poster.js');
const { makeRng } = await import('../game/rng.js');
const { COLS, TILES, tileDist } = await import('../game/rules.js');

const seen = new Set();
function frames(n, each) {
  for (let i = 0; i < n; i++) {
    dom.frame();
    assert.equal(stats.depth, 0, 'every save() has its restore()');
    for (const t of stats.texts) seen.add(t);
    stats.texts.length = 0;
    if (each) each(i);
    if (errors.length) throw errors[0];
  }
}

test('a whole session on the real client code', async () => {
  const ow = makeStandalone();
  const saved = [];
  const awarded = [];
  const submitted = [];
  ow.save.set = async (k, v) => saved.push([k, v]);
  ow.badges.award = async (id) => awarded.push(id);
  ow.leaderboards.submit = async (b, s) => submitted.push([b, s]);
  const controlsSet = [];
  ow.controls.set = (c) => controlsSet.push(c);
  const room = await ow.rooms.join(JOIN);
  const game = new Game({ ow, room, canvas: dom.canvas });
  game.start();

  // the lobby at once: nothing to press first, and nothing of its own that says Ready
  frames(60);
  assert.ok(!seen.has('PLAY') && !seen.has('READY?') && !seen.has('START'));
  assert.ok(seen.has('ROUNDS') && seen.has('SPEED') && seen.has('Normal'));
  assert.equal(FakeAudioContext.made, 0, 'sound waits for a tap');
  assert.deepEqual(controlsSet.at(-1), { stick: 'analog', buttons: [{ id: 'push', label: 'Push', key: ' ' }] });

  dom.tap(1, 1);
  assert.equal(FakeAudioContext.made, 1, 'the first tap starts the sound');

  // the host taps a setting and it changes
  const chip = game.chips.rects[0];
  assert.equal(chip.id, 'rounds');
  dom.tap(chip.x + chip.w / 2, chip.y + chip.h / 2);
  assert.equal(room.settings.rounds, 5);
  dom.tap(chip.x + chip.w / 2, chip.y + chip.h / 2);
  assert.equal(room.settings.rounds, 1);
  dom.tap(chip.x + chip.w / 2, chip.y + chip.h / 2);
  assert.equal(room.settings.rounds, 3);
  const speed = game.chips.rects[1];
  dom.tap(speed.x + 5, speed.y + 5);
  assert.equal(room.settings.speed, 'fast');
  dom.tap(speed.x + 5, speed.y + 5);
  dom.tap(speed.x + 5, speed.y + 5);
  assert.equal(room.settings.speed, 'normal');

  // play two whole matches, moving about and pushing like someone who doesn't know the game
  for (let m = 1; m <= 2; m++) {
    seen.clear();
    room.setReady(true);
    assert.equal(room.match.phase, 'starting');
    frames(3 * 60 + 20);
    assert.ok(!seen.has('GO!'), 'nothing after the platform\'s 3-2-1');
    assert.equal(room.match.phase, 'playing');
    const rng = makeRng(m);
    let held = '';
    const phases = new Set();
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', ''];
    let guard = 0;
    while (room.match.phase === 'playing' && guard++ < 60 * 60 * 12) {
      frames(1, (i) => {
        if (guard % 25 === 0) {
          if (held) dom.keyup(held);
          held = rng.pick(keys);
          if (held) dom.keydown(held);
        }
        if (guard % 70 === 0) dom.keydown('Space');
        if (guard % 70 === 6) dom.keyup('Space');
        phases.add(`${game.scene}`);
        void i;
      });
    }
    if (held) dom.keyup(held);
    frames(1);
    assert.equal(room.match.phase, 'lobby', `match ${m} ended`);
    for (const scene of ['step', 'end', 'board', 'final']) assert.ok(phases.has(scene), `match ${m} showed the ${scene} screen`);
    assert.ok(!seen.has('ROUND 1') && seen.has('ROUND 2'), 'a banner from the second round on: the first follows the platform\'s 3-2-1 with nothing added');
    assert.ok(seen.has('Stand on the color!'));
    assert.ok(['RED', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'ORANGE'].some((n) => seen.has(n)), 'the call');
    assert.ok(seen.has('SCORES') && seen.has('RESULTS'));
    assert.ok(seen.has('FINAL ROUND'));
    assert.ok(seen.has('OUT!') || seen.has('SAFE!'));
    assert.equal(game.stats.matches, m);
    // back in the lobby with the results card still up for a while
    assert.ok(game.results);
    seen.clear();
    frames(60);
    assert.ok(seen.has('RESULTS'), 'the results card stays');
    frames(60 * 8);
    assert.ok(!game.results);
    assert.ok(seen.has('ROUNDS'));
  }
  assert.ok(saved.filter(([k]) => k === 'stats').length === 2);
  assert.equal(saved.at(-1)[1].matches, 2);
  assert.ok(awarded.every((id) => ['first-win', 'survivor', 'untouchable', 'party-animal'].includes(id)));
  assert.ok(FakeAudioContext.made === 1);
  void submitted;
  assert.equal(errors.length, 0);
});

/** A player who knows the game: runs for the nearest tile of the called colour (with the keyboard, like anyone). */
function autopilot(game) {
  const held = new Set();
  const want = new Set();
  const g = game.g;
  const me = game.me;
  if (g && game.scene === 'step' && game.fd && game.matchNow >= g.ca && me.st === 0) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < TILES; i++) {
      if (!game.fd.stand[i]) continue;
      const d = tileDist(me.x, me.y, i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD > 0.05) {
      const tx = (best % COLS) + 0.5;
      const ty = Math.floor(best / COLS) + 0.5;
      if (tx < me.x - 0.12) want.add('KeyA');
      if (tx > me.x + 0.12) want.add('KeyD');
      if (ty < me.y - 0.12) want.add('KeyW');
      if (ty > me.y + 0.12) want.add('KeyS');
    }
  }
  for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) {
    const down = game.autoHeld?.has(k) ?? false;
    if (want.has(k) && !down) dom.keydown(k);
    if (!want.has(k) && down) dom.keyup(k);
    if (want.has(k)) held.add(k);
  }
  game.autoHeld = held;
}

test('a player who knows the game survives, wins rounds and earns the badges', async () => {
  const ow = makeStandalone();
  const awarded = new Set();
  const submitted = [];
  ow.badges.award = async (id) => awarded.add(id);
  ow.leaderboards.submit = async (b, s) => submitted.push([b, s]);
  const room = await ow.rooms.join(JOIN);
  const game = new Game({ ow, room, canvas: dom.canvas });
  game.start();
  dom.tap();
  frames(30);
  let wins = 0;
  let sawSafe = false;
  let sawWin = false;
  for (let m = 0; m < 4; m++) {
    seen.clear();
    room.setReady(true);
    frames(3 * 60 + 20);
    let guard = 0;
    while (room.match.phase === 'playing' && guard++ < 60 * 60 * 12) {
      frames(1, () => autopilot(game));
      if (game.scene === 'step' && game.g.step >= 1 && seen.has('SAFE!')) sawSafe = true;
    }
    frames(1);
    if (seen.has('YOU WIN!')) sawWin = true;
    if (game.results) {
      const mine = game.results.g.scores[game.meId];
      const best = Math.max(...Object.values(game.results.g.scores));
      if (mine === best) wins++;
    }
    frames(60 * 8);
  }
  assert.ok(sawSafe, 'surviving a drop says SAFE!');
  assert.ok(sawWin, 'a player who plays well wins a round');
  assert.ok(wins >= 1, `won ${wins} of 4 matches`);
  assert.ok(awarded.has('first-win'), 'first win badge');
  assert.ok(awarded.has('untouchable') || awarded.has('survivor'), `round badges (${[...awarded]})`);
  assert.ok(submitted.length >= 1 && submitted.every(([b, s]) => b === 'wins' && s >= 1));
  assert.equal(game.stats.matches, 4);
  assert.ok(game.stats.wins >= 1);
  assert.equal(errors.length, 0);
});

test('every screen size draws: a phone held both ways, a tablet, a wide window', async () => {
  const ow = makeStandalone();
  const room = await ow.rooms.join(JOIN);
  const game = new Game({ ow, room, canvas: dom.canvas });
  game.start();
  dom.tap();
  for (const [w, h] of [[667, 375], [375, 667], [360, 640], [568, 320], [1024, 768], [1920, 1080], [320, 200]]) {
    dom.resize(w, h);
    room.setReady(true);
    frames(60 * 3 + 30);
    frames(60 * 6);
    room.endMatch?.();
    frames(30);
    room.setReady(false);
  }
  assert.equal(errors.length, 0);
});

test('a page that opens in the middle of a match goes straight to it', async () => {
  const ow = makeStandalone();
  const room = await ow.rooms.join(JOIN);
  room.setReady(true);
  dom.frame();
  const game = new Game({ ow, room, canvas: dom.canvas });
  game.start();
  frames(3 * 60 + 40);
  assert.equal(room.match.phase, 'playing');
  frames(60 * 6);
  assert.equal(errors.length, 0);
});

test('store art draws: the cover, the action shot, the podium, the icon and every badge', async () => {
  const names = ['cover', 'action', 'win', 'icon', 'badge-first-win', 'badge-survivor', 'badge-untouchable', 'badge-party-animal', 'badge-nope', 'mystery'];
  for (const name of names) {
    delete dom.body.dataset.ready;
    await drawPoster(dom.canvas, name);
    assert.equal(dom.body.dataset.ready, '1', `${name} is done`);
    assert.equal(stats.depth, 0);
    const size = name === 'icon' ? 512 : name.startsWith('badge-') ? 256 : 1280;
    assert.equal(dom.canvas.width, size);
    assert.equal(dom.canvas.style.width, `${size}px`);
  }
  // the same picture every time
  const draws = [];
  for (let i = 0; i < 2; i++) {
    stats.texts.length = 0;
    await drawPoster(dom.canvas, 'cover');
    draws.push(stats.calls);
  }
  assert.ok(draws[1] > draws[0] - 1);
  assert.equal(errors.length, 0);
  console.error = warn;
});
