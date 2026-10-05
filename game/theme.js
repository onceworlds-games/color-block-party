// Shared look: one chunky font, one dark ink for every outline, and the small drawing helpers everything uses.

export const FONT = '"Lilita One", "Arial Black", Impact, system-ui, sans-serif';
export const INK = '#1b0f33';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
/** 0 to 1 with an overshoot: a pop. */
export const easeBack = (t) => {
  const x = clamp(t, 0, 1);
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Mixes a #rrggbb colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const r = Math.round(((n >> 16) & 255) * (1 - k) + target * k);
  const g = Math.round(((n >> 8) & 255) * (1 - k) + target * k);
  const b = Math.round((n & 255) * (1 - k) + target * k);
  return `rgb(${r},${g},${b})`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** White text with a thick dark outline (the outline is drawn first, round-jointed). */
export function outlined(ctx, text, x, y, size, opts = {}) {
  const { fill = '#fff', stroke = INK, align = 'center', baseline = 'middle', width = 0.2, shadow = 0, alpha = 1 } = opts;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha, 0, 1);
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (shadow) {
    ctx.fillStyle = stroke;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size * width;
    ctx.strokeText(text, x, y + shadow);
    ctx.fillText(text, x, y + shadow);
  }
  ctx.lineWidth = size * width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A name that fits on a tag. */
export const tag = (name) => {
  const text = String(name ?? '').trim() || 'Player';
  return text.length > 11 ? `${text.slice(0, 10)}…` : text;
};

/** The white symbol of a tile colour, as shapes (never emoji). `r` is its size from the centre to the tip. */
export function symbolPath(ctx, kind, cx, cy, r) {
  ctx.beginPath();
  switch (kind) {
    case 'heart': {
      const t = r * 0.95;
      ctx.moveTo(cx, cy + t * 0.95);
      ctx.bezierCurveTo(cx - t * 1.35, cy + t * 0.1, cx - t * 1.05, cy - t * 1.0, cx, cy - t * 0.35);
      ctx.bezierCurveTo(cx + t * 1.05, cy - t * 1.0, cx + t * 1.35, cy + t * 0.1, cx, cy + t * 0.95);
      break;
    }
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 1.1 : r * 0.48;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad + r * 0.05;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'clover': {
      const lr = r * 0.46;
      ctx.arc(cx, cy - r * 0.5, lr, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 0.5 + lr, cy + r * 0.12);
      ctx.arc(cx - r * 0.5, cy + r * 0.12, lr, 0, Math.PI * 2);
      ctx.moveTo(cx + r * 0.5 + lr, cy + r * 0.12);
      ctx.arc(cx + r * 0.5, cy + r * 0.12, lr, 0, Math.PI * 2);
      ctx.moveTo(cx - r * 0.12, cy + r * 0.2);
      ctx.lineTo(cx + r * 0.12, cy + r * 0.2);
      ctx.lineTo(cx + r * 0.22, cy + r * 1.05);
      ctx.lineTo(cx - r * 0.22, cy + r * 1.05);
      ctx.closePath();
      break;
    }
    case 'circle':
      ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - r * 1.1);
      ctx.lineTo(cx + r * 0.85, cy);
      ctx.lineTo(cx, cy + r * 1.1);
      ctx.lineTo(cx - r * 0.85, cy);
      ctx.closePath();
      break;
    default: // triangle
      ctx.moveTo(cx, cy - r * 1.0);
      ctx.lineTo(cx + r * 1.05, cy + r * 0.8);
      ctx.lineTo(cx - r * 1.05, cy + r * 0.8);
      ctx.closePath();
  }
}

export function fillSymbol(ctx, kind, cx, cy, r, fill = '#fff', shadow = 0.1) {
  if (shadow) {
    symbolPath(ctx, kind, cx, cy + r * shadow, r);
    ctx.fillStyle = 'rgba(27,15,51,0.35)';
    ctx.fill('nonzero');
  }
  symbolPath(ctx, kind, cx, cy, r);
  ctx.fillStyle = fill;
  ctx.fill('nonzero');
}

/** A five-point star, for sparkles and stars over a knocked head. */
export function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
