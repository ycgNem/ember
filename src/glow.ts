// Radial glows. The world's glows are batched and drawn on the GPU by Post in three additive
// layers (behind the bodies, on the bodies, in front of everything): a few instanced draws instead
// of up to a thousand canvas drawImage calls a frame, which was the single biggest cost of a big fight.
// Everything else (the HUD, or the world without WebGL2) draws cached sprites on the canvas.

const cache: (HTMLCanvasElement | undefined)[] = [];

// indexed by hue bucket and lightness: a string key per draw was measurable at a thousand glows a frame
function sprite(hue: number, light: number): HTMLCanvasElement {
  const h = ((Math.round(hue / 6) * 6) % 360 + 360) % 360;
  const key = (h / 6) * 101 + light;
  let c = cache[key];
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
  cache[key] = c;
  return c;
}

/** Floats per batched glow: x, y, radius, r, g, b, alpha (a negative alpha marks a cover, see coverGlows). */
export const GLOW_STRIDE = 7;
export const GLOW_MAX = 4096;

export interface GlowBatch { data: Float32Array; count: number }
const batch = (): GlowBatch => ({ data: new Float32Array(GLOW_MAX * GLOW_STRIDE), count: 0 });

/**
 * `back` and `front` fade like the world canvas, so they leave its trails. `body` is for glows
 * sitting on a solid body and holds this frame only: on the canvas, each frame's body covered
 * whatever the last frame's glow left behind.
 */
export const glows = { back: batch(), body: batch(), front: batch() };
export type GlowLayers = typeof glows;

let batchCtx: CanvasRenderingContext2D | null = null;
let layer: GlowBatch | null = null;

/** Start a frame: glows drawn on `ctx` go to the GPU batches from here on (null keeps them on the canvas). */
export function batchGlows(ctx: CanvasRenderingContext2D | null) {
  batchCtx = ctx;
  glows.back.count = glows.body.count = glows.front.count = 0;
  layer = ctx ? glows.back : null;
}

/** Which GPU layer the world's next glows join. */
export function glowLayer(which: keyof GlowLayers) {
  layer = batchCtx ? glows[which] : null;
}

/** hsl(h, 100%, l%) as 0..1 rgb, matching the canvas colours. */
function hslRgb(h: number, l: number, out: Float32Array, at: number) {
  const L = l / 100;
  const a = Math.min(L, 1 - L);
  const hh = (((h % 360) + 360) % 360) / 30;
  const channel = (n: number) => {
    const k = (n + hh) % 12;
    return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  out[at] = channel(0);
  out[at + 1] = channel(8);
  out[at + 2] = channel(4);
}

/**
 * Call after drawing a solid disc on `g`: the batched glows drawn before it are hidden under it,
 * the way the disc hid them on the canvas. Glows batched later still shine on top.
 */
export function coverGlows(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  if (!layer || g !== batchCtx || layer.count >= GLOW_MAX || g.globalAlpha <= 0) return;
  const d = layer.data;
  const i = layer.count++ * GLOW_STRIDE;
  d[i] = x;
  d[i + 1] = y;
  d[i + 2] = r;
  d[i + 6] = -g.globalAlpha;
}

/** Draws a glow; `alpha` multiplies whatever globalAlpha is already set. */
export function drawGlow(g: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, light = 60, alpha = 1) {
  if (r <= 0 || alpha <= 0) return;
  if (layer && g === batchCtx && layer.count < GLOW_MAX) {
    const d = layer.data;
    const i = layer.count++ * GLOW_STRIDE;
    d[i] = x;
    d[i + 1] = y;
    d[i + 2] = r;
    hslRgb(hue, light, d, i + 3);
    d[i + 6] = alpha * g.globalAlpha;
    return;
  }
  if (alpha === 1) {
    g.drawImage(sprite(hue, light), x - r, y - r, r * 2, r * 2);
    return;
  }
  const prev = g.globalAlpha;
  g.globalAlpha = prev * alpha;
  g.drawImage(sprite(hue, light), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = prev;
}
