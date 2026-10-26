// Feedback effects: particles, floating text, banners, the announcer, screen shake,
// hitstop, zoom punches, and ripples.

import { G } from './state';
import { TAU, rand } from './util';

export const ANNOUNCE_LIFE = 1.5;

export function burst(x: number, y: number, hue: number, count: number, speed: number, size = 6) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const s = rand(speed * 0.2, speed);
    const life = rand(0.4, 1.1);
    const roll = Math.random();
    G.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life,
      size: rand(size * 0.5, size), hue: hue + rand(-20, 20),
      kind: roll < 0.55 ? 'glow' : roll < 0.85 ? 'streak' : 'shard',
      rot: rand(0, TAU), spin: rand(-12, 12),
    });
  }
}

export function popup(x: number, y: number, text: string, hue: number, size = 15) {
  G.popups.push({ x, y, text, life: 1, hue, size });
}

export function banner(text: string, sub: string, hue: number, big = false) {
  const life = big ? 3.4 : 2.6;
  G.banners.push({ text, sub, life, maxLife: life, hue, big });
}

export function announce(text: string, hue: number, tier: number) {
  G.announce = { text, life: ANNOUNCE_LIFE, hue, tier };
}

/** A refraction ripple for the post-processing pass; `strength` is in pixels of displacement. */
export function shock(x: number, y: number, maxR: number, strength = 20, life = 0.6) {
  G.shocks.push({ x, y, r: 0, speed: maxR / life, strength, life, maxLife: life });
}

export function addShake(n: number) {
  G.shake = Math.max(G.shake, n);
}

/** Freeze the world for a beat so a big hit lands. */
export function hitstop(t: number) {
  G.hitstop = Math.max(G.hitstop, t);
}

/** A quick zoom toward a point that springs back. */
export function punch(z: number, x: number, y: number) {
  if (z < G.zoom) return;
  G.zoom = z;
  G.zoomX = x;
  G.zoomY = y;
}
