// Radial glow sprites, cached per hue/lightness so drawing hundreds per frame stays cheap.

const cache = new Map<string, HTMLCanvasElement>();

function sprite(hue: number, light: number): HTMLCanvasElement {
  const h = ((Math.round(hue / 6) * 6) % 360 + 360) % 360;
  const key = `${h}-${light}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `hsla(${h},100%,${light}%,1)`);
  grad.addColorStop(0.25, `hsla(${h},100%,${light}%,0.45)`);
  grad.addColorStop(1, `hsla(${h},100%,${light}%,0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cache.set(key, c);
  return c;
}

/** Draws a glow; `alpha` multiplies whatever globalAlpha is already set. */
export function drawGlow(g: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, light = 60, alpha = 1) {
  if (r <= 0 || alpha <= 0) return;
  const prev = g.globalAlpha;
  g.globalAlpha = prev * alpha;
  g.drawImage(sprite(hue, light), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = prev;
}
