// Serves the game folder on http://127.0.0.1:5173 for playing it outside Onceworlds (no SDK: a solo room).
import { serve } from './cdp.mjs';

const port = Number(process.env.PORT ?? 5173);
const { port: used } = await serve(new URL('../game', import.meta.url).pathname, port);
console.log(`Tack: http://127.0.0.1:${used}/`);
