// Keyboard and the platform's on-screen stick, combined into one move vector and a push button.
// WASD and the arrows move, Space pushes; the touch stick is `ow.controls.stick` and its button is `ow.controls.pressed('push')`
// (which also presses Space, so the two agree).

export function createInput(getControls) {
  const keys = new Set();
  const out = { x: 0, y: 0, push: false, any: false };

  const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });

  return {
    /** The current input: x and y from -1 to 1 (y points down), whether push is held. Not a copy: don't keep it. */
    read() {
      let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let y = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      let push = keys.has('Space');
      const controls = getControls();
      if (controls) {
        const sx = Number(controls.stick?.x) || 0;
        const sy = Number(controls.stick?.y) || 0;
        const m = Math.hypot(sx, sy);
        if (m > 0.1) {
          const k = Math.min(1, (m - 0.1) / 0.8) / m; // a small dead zone, then full speed at 90%
          x += sx * k;
          y += sy * k;
        }
        if (controls.pressed?.('push')) push = true;
      }
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      out.x = x;
      out.y = y;
      out.push = push;
      out.any = len > 0.05 || push;
      return out;
    },
  };
}
