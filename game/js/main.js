// Tack. Store art renders on its own (no SDK, no network); otherwise the room is joined first, as the page loads, and
// then the game is built.
import { platform } from './platform.js';
import { JOIN } from './net.js';

const poster = new URLSearchParams(location.search).get('poster');
if (poster) {
  const { runPoster } = await import('./poster.js');
  await runPoster(poster);
} else {
  const joining = platform.available ? platform.join(JOIN) : Promise.resolve(null);
  const { start } = await import('./app.js');
  await start(joining);
}
