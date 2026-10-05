// Boot. Join the room first (before anything heavy is built), then hand the page to the game. With `?poster=<name>` the page draws
// store art instead and never touches the platform.
import { Game } from './game.js';
import { JOIN, makeStandalone } from './net.js';
import { drawPoster } from './poster.js';

const canvas = document.getElementById('c');
const poster = new URLSearchParams(location.search).get('poster');

async function boot() {
  try {
    document.fonts?.load('32px "Lilita One"').catch(() => {});
  } catch {
    // the fallback font draws instead
  }
  if (poster) {
    await drawPoster(canvas, poster);
    return;
  }
  let ow = window.onceworlds;
  try {
    if (ow && typeof ow.ready === 'function') await ow.ready();
  } catch {
    // carry on
  }
  if (!ow || ow.mode === 'standalone') ow = makeStandalone(); // opened on its own: a solo stand-in for the room
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // optional
  }
  let room;
  try {
    room = await ow.rooms.join(JOIN);
  } catch (err) {
    console.error(err);
    ow = makeStandalone();
    room = await ow.rooms.join(JOIN);
  }
  new Game({ ow, room, canvas }).start();
}

boot();
