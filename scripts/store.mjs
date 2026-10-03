// Captures the store art from the game's own poster mode: four 1280x720 thumbnails, the 512x512 icon and a 256x256
// icon per badge, into store/. Uses headless Chrome (see cdp.mjs).
//   node scripts/store.mjs            (everything)
//   node scripts/store.mjs thumb1     (one)
import { serve, launch, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'onceworlds.json'), 'utf8'));
const badges = (manifest.badges ?? []).map((b) => b.id);
const jobs = [
  { kind: 'thumb1', w: 1280, h: 720, out: 'store/thumb-1.png' },
  { kind: 'thumb2', w: 1280, h: 720, out: 'store/thumb-2.png' },
  { kind: 'thumb3', w: 1280, h: 720, out: 'store/thumb-3.png' },
  { kind: 'thumb4', w: 1280, h: 720, out: 'store/thumb-4.png' },
  { kind: 'icon', w: 512, h: 512, out: 'store/icon.png' },
  ...badges.map((id) => ({ kind: `badge-${id}`, w: 256, h: 256, out: `store/badges/${id}.png` })),
];
const only = process.argv.slice(2);
const { server, port } = await serve(path.join(root, 'game'), 0);
let browser = null;
try {
  for (const job of jobs.filter((j) => !only.length || only.includes(j.kind))) {
    browser?.close();
    browser = await launch({ width: job.w, height: job.h });
    const errors = [];
    browser.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?poster=${job.kind}` });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      await sleep(100);
      ready = (await browser.evaluate('window.__posterReady === true')) === true;
    }
    await sleep(300);
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: job.w, height: job.h, scale: 1 } });
    mkdirSync(path.dirname(path.join(root, job.out)), { recursive: true });
    writeFileSync(path.join(root, job.out), Buffer.from(shot.result.data, 'base64'));
    console.log(`${ready ? '✓' : '✗ (not ready)'} ${job.out}${errors.length ? `  errors: ${errors.join(' | ').slice(0, 300)}` : ''}`);
  }
} finally {
  browser?.close();
  server.close();
}
