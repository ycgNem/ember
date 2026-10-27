// Sector hazards: stinging jellies, tearing rifts, and the event horizon.
// (The Abyss's darkness lives in the post-processing shader.)

import { blip } from './audio';
import { damageBoss } from './boss';
import { damagePlayer, dropSpark, killEnemy } from './combat';
import { addShake, burst, shock } from './fx';
import { drawGlow, glowLayer } from './glow';
import { G, player, playerRadius, sector, sweptDist, view, type Jelly, type Rift } from './state';
import { TAU, clamp, rand, retain, type Pt } from './util';

export const HORIZON_R = 48;
const RIFT_WARN = 1.15;
const RIFT_TEAR = 0.45;

export function horizonCenter(): Pt {
  return { x: view.W / 2, y: view.H / 2 };
}

const gravityActive = () => sector().hazard === 'gravity' && G.state !== 'title';

/** In the event horizon your wisp sits slightly downhill of the cursor. */
export function gravityTarget(x: number, y: number): Pt {
  if (!gravityActive()) return { x, y };
  const c = horizonCenter();
  return { x: x + (c.x - x) * 0.09, y: y + (c.y - y) * 0.09 };
}

export function resetHazards() {
  G.jellies = [];
  G.rifts = [];
  G.riftTimer = 3;
}

export function updateHazards(dt: number) {
  const hz = sector().hazard;
  const playing = G.state === 'play';
  if (hz === 'jellies') updateJellies(dt, playing);
  else if (hz === 'rifts') updateRifts(dt, playing);
  else if (hz === 'gravity' && G.state !== 'title') updateGravity(dt, playing);
}

// ---------- Ember Reef ----------

function spawnJelly(): Jelly {
  return {
    x: rand(40, view.W - 40), y: view.H + rand(40, 200), vx: rand(-25, 25), vy: rand(-55, -25),
    r: rand(18, 30), phase: rand(0, TAU), hue: (rand(330, 400)) % 360, dead: false,
  };
}

function updateJellies(dt: number, playing: boolean) {
  while (playing && G.jellies.length < 5 + G.loop) G.jellies.push(spawnJelly());
  const pr = playerRadius();
  for (const j of G.jellies) {
    j.phase += dt;
    // they swim in pulses, like the real thing
    const thrust = Math.max(0, Math.sin(j.phase * 1.6));
    j.x += j.vx * dt;
    j.y += j.vy * dt * (0.4 + thrust * 1.6);
    if (j.y < -80) Object.assign(j, spawnJelly());
    if (j.x < -60) j.x = view.W + 60;
    if (j.x > view.W + 60) j.x = -60;
    if (playing && sweptDist(j) < j.r * 0.8 + pr) damagePlayer('a reef jelly');
  }
  retain(G.jellies, (j) => !j.dead);
}

export function popJelly(j: Jelly) {
  if (j.dead) return;
  j.dead = true;
  burst(j.x, j.y, j.hue, 30, 260, 7);
  dropSpark(j.x, j.y);
  dropSpark(j.x, j.y, 'mote');
  dropSpark(j.x, j.y, 'mote');
  blip(700, 0.15, 'sine', 0.06, 0.5);
}

// ---------- The Rift ----------

function riftEnds(r: Rift): [Pt, Pt] {
  const L = Math.hypot(view.W, view.H);
  const dx = Math.cos(r.angle) * L;
  const dy = Math.sin(r.angle) * L;
  return [{ x: r.x - dx, y: r.y - dy }, { x: r.x + dx, y: r.y + dy }];
}

function updateRifts(dt: number, playing: boolean) {
  if (playing) {
    G.riftTimer -= dt;
    if (G.riftTimer <= 0) {
      G.rifts.push({ x: player.x + rand(-140, 140), y: player.y + rand(-140, 140), angle: rand(0, Math.PI), t: 0, hit: new Set() });
      G.riftTimer = Math.max(2.2, 5.5 - G.sectorTime * 0.03 - G.loop * 0.6);
      blip(1400, 0.6, 'sine', 0.04, 0.5);
    }
  }
  const pr = playerRadius();
  for (const r of G.rifts) {
    const before = r.t;
    r.t += dt;
    if (before < RIFT_WARN && r.t >= RIFT_WARN) {
      addShake(7);
      shock(r.x, r.y, 260, 16, 0.5);
      blip(80, 0.5, 'sawtooth', 0.12, 0.4);
    }
    if (r.t < RIFT_WARN || r.t > RIFT_WARN + RIFT_TEAR) continue;
    const dx = Math.cos(r.angle);
    const dy = Math.sin(r.angle);
    const side = (p: Pt) => (p.x - r.x) * dy - (p.y - r.y) * dx;
    const lineDist = (p: Pt) => Math.abs(side(p));
    // crossing the tear counts even if a flick carried you over it between frames
    const crossed = side(player) * side({ x: player.px, y: player.py }) < 0;
    if (playing && (lineDist(player) < 14 + pr || crossed)) damagePlayer('a rift', null, true);  // torn space ignores Phase
    // the tear doesn't care whose side you're on
    for (const e of G.enemies) {
      if (!e.dead && !r.hit.has(e) && lineDist(e) < e.r + 12) {
        r.hit.add(e);
        killEnemy(e, 1);
      }
    }
    for (const b of G.bullets) if (!b.dead && lineDist(b) < 16) b.dead = true;
    if (G.boss && !r.hit.has(G.boss) && lineDist(G.boss) < G.boss.r) {
      r.hit.add(G.boss);
      damageBoss(10, G.boss.x, G.boss.y, true);
    }
  }
  retain(G.rifts, (r) => r.t < RIFT_WARN + RIFT_TEAR + 0.3);
}

// ---------- Event Horizon ----------

function updateGravity(dt: number, playing: boolean) {
  const c = horizonCenter();
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = c.x - e.x;
    const dy = c.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (14000 / (d + 80)) * dt;
    e.vx += (dx / d) * f;
    e.vy += (dy / d) * f;
    if (d < HORIZON_R + e.r * 0.3) killEnemy(e, 0);
  }
  retain(G.sparks, (s) => {
    const dx = c.x - s.x;
    const dy = c.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = (25 + 4000 / (d + 40)) * dt;
    s.x += (dx / d) * pull;
    s.y += (dy / d) * pull;
    return d > HORIZON_R;
  });
  for (const b of G.bullets) {
    const dx = c.x - b.x;
    const dy = c.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (7000 / (d + 80)) * dt;
    b.vx += (dx / d) * f;
    b.vy += (dy / d) * f;
    if (d < HORIZON_R) b.dead = true;
  }
  // the apex falls inward too: it's heavy enough to resist, but the horizon burns it if it strays too close
  const b = G.boss;
  if (b && b.enter >= 1 && b.dying === 0) {
    const dx = c.x - b.x;
    const dy = c.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (9000 / (d + 80)) * dt;
    b.vx += (dx / d) * f;
    b.vy += (dy / d) * f;
    if (d < HORIZON_R + b.r * 0.6) damageBoss(9 * dt, c.x, c.y, true, true);
  }
  if (playing && sweptDist(c) < HORIZON_R + playerRadius()) damagePlayer('the event horizon', null, true);
}

// ---------- drawing ----------

function drawJelly(c: CanvasRenderingContext2D, j: Jelly) {
  const pulse = 1 + Math.sin(j.phase * 1.6) * 0.1;
  c.strokeStyle = `hsla(${j.hue}, 100%, 72%, 0.45)`;
  c.lineWidth = 1.5;
  for (let k = 0; k < 5; k++) {
    const bx = j.x + (k - 2) * j.r * 0.35;
    c.beginPath();
    c.moveTo(bx, j.y);
    for (let s = 1; s <= 9; s++) {
      c.lineTo(bx + Math.sin(j.phase * 3 + s * 0.7 + k) * s * 1.3, j.y + s * j.r * 0.24);
    }
    c.stroke();
  }
  drawGlow(c, j.x, j.y - j.r * 0.2, j.r * 2.4, j.hue, 60, 0.45);
  c.beginPath();
  c.ellipse(j.x, j.y, j.r * pulse, (j.r * 0.85) / pulse, 0, Math.PI, TAU);
  c.closePath();
  const g = c.createRadialGradient(j.x, j.y - j.r * 0.5, 1, j.x, j.y, j.r * 1.1);
  g.addColorStop(0, `hsla(${j.hue}, 100%, 85%, 0.6)`);
  g.addColorStop(1, `hsla(${j.hue}, 100%, 45%, 0.12)`);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = `hsla(${j.hue}, 100%, 82%, 0.85)`;
  c.lineWidth = 1.5;
  c.stroke();
  glowLayer('front');  // the nucleus shines through the bell instead of sitting under it
  drawGlow(c, j.x, j.y - j.r * 0.35, j.r * 0.5, j.hue + 20, 85, 0.8);
  glowLayer('back');
}

function accretion(c: CanvasRenderingContext2D, front: boolean) {
  const o = horizonCenter();
  for (let i = 0; i < 80; i++) {
    const ring = i % 8;
    const a = G.clock * (1.5 - ring * 0.12) + i * 2.399;
    if (Math.sin(a) > 0 !== front) continue;
    const rad = HORIZON_R * 1.3 + ring * 10;
    drawGlow(c, o.x + Math.cos(a) * rad, o.y + Math.sin(a) * rad * 0.36, 5 + (7 - ring) * 0.6, 22 + ring * 5, 70, 0.85);
  }
}

function drawRiftLine(c: CanvasRenderingContext2D, r: Rift) {
  const [a, b] = riftEnds(r);
  if (r.t < RIFT_WARN) {
    const t = r.t / RIFT_WARN;
    c.setLineDash([14, 10]);
    c.lineDashOffset = -G.clock * 120;
    c.strokeStyle = `hsla(290, 100%, 75%, ${(0.2 + 0.6 * t) * (0.7 + 0.3 * Math.sin(G.clock * 50))})`;
    c.lineWidth = 1 + 2 * t;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.setLineDash([]);
    return;
  }
  const fade = clamp(1 - (r.t - RIFT_WARN - RIFT_TEAR) / 0.3, 0, 1);
  const nx = -Math.sin(r.angle);
  const ny = Math.cos(r.angle);
  for (const [w, color] of [[28, `hsla(285, 100%, 60%, ${0.22 * fade})`], [12, `hsla(295, 100%, 72%, ${0.6 * fade})`], [3.5, `rgba(255, 245, 255, ${fade})`]] as const) {
    c.strokeStyle = color;
    c.lineWidth = w;
    c.beginPath();
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const off = i === 0 || i === 28 ? 0 : rand(-5, 5);
      const x = a.x + (b.x - a.x) * t + nx * off;
      const y = a.y + (b.y - a.y) * t + ny * off;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
}

/** Additive pass, behind bodies. */
export function drawHazardsGlow(c: CanvasRenderingContext2D) {
  const hz = sector().hazard;
  if (hz === 'jellies') for (const j of G.jellies) drawJelly(c, j);
  if (hz === 'gravity' && G.state !== 'title') {
    const o = horizonCenter();
    drawGlow(c, o.x, o.y, HORIZON_R * 5.5, 32, 55, 0.55);
    accretion(c, false);
  }
  if (hz === 'rifts') for (const r of G.rifts) if (r.t < RIFT_WARN) drawRiftLine(c, r);
}

/** Opaque pass. */
export function drawHazardsBody(c: CanvasRenderingContext2D) {
  if (!gravityActive()) return;
  const o = horizonCenter();
  c.fillStyle = '#000';
  c.beginPath();
  c.arc(o.x, o.y, HORIZON_R, 0, TAU);
  c.fill();
}

/** Additive pass, in front of everything. */
export function drawHazardsTop(c: CanvasRenderingContext2D) {
  const hz = sector().hazard;
  if (hz === 'rifts') for (const r of G.rifts) if (r.t >= RIFT_WARN) drawRiftLine(c, r);
  if (gravityActive()) {
    const o = horizonCenter();
    c.strokeStyle = 'hsla(40, 100%, 78%, 0.9)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(o.x, o.y, HORIZON_R + 1.5, 0, TAU);
    c.stroke();
    accretion(c, true);
  }
}
