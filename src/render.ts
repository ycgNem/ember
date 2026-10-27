// World rendering into the trail canvas. The background lives in the shader, so
// this layer is transparent: glows add light, void bodies are dark silhouettes.

import { drawBoss, drawBossTelegraphs } from './boss';
import { batchGlows, coverGlows, drawGlow, glowLayer } from './glow';
import { drawHazardsBody, drawHazardsGlow, drawHazardsTop } from './hazards';
import { G, player, sector, stasisRadius, tier, view, wake, wakeLife, type Enemy } from './state';
import { TAU, clamp, type Pt } from './util';

let c: CanvasRenderingContext2D;
const glow = (x: number, y: number, r: number, h: number, light = 60, alpha = 1) => drawGlow(c, x, y, r, h, light, alpha);

function enemyVisibility(e: Enemy) {
  return 1 - e.ph.cloak * 0.9 * (0.5 + 0.5 * Math.sin(G.clock * 1.7 + e.phase));
}

function tracePoly(poly: readonly Pt[]) {
  c.beginPath();
  poly.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
  c.closePath();
}

function drawDust() {
  const h = sector().hue;
  // three depth bands: far dust is small and dim, near dust is larger and brighter.
  // (Plain fillRects: Chrome merges them, while one many-rect path measured far slower.)
  for (let band = 0; band < 3; band++) {
    const size = 1 + band * 0.9;
    c.fillStyle = `hsla(${h}, 70%, ${65 + band * 8}%, ${0.18 + band * 0.14})`;
    for (const d of G.dust) if (d.band === band) c.fillRect(d.x, d.y, size, size);
  }
}

function flare(x: number, y: number, len: number, rot: number, color: string, rays = 2) {
  c.strokeStyle = color;
  c.lineWidth = 1.2;
  c.beginPath();
  for (let k = 0; k < rays; k++) {
    const a = rot + (k * Math.PI) / rays;
    c.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  c.stroke();
}

function drawSparks() {
  for (const s of G.sparks) {
    const grow = clamp((G.clock - s.born) * 3, 0, 1);
    const bob = s.vy ? 0 : Math.sin(G.clock * 3 + s.phase);
    if (s.kind === 'mote') {
      const fade = clamp((6 - s.age) / 1.5, 0, 1);
      glow(s.x, s.y + bob * 2, 11 * grow, 350, 65, 0.9 * fade);
      glow(s.x, s.y + bob * 2, 4 * grow, 0, 90, fade);
      continue;
    }
    const y = s.y + bob * 4;
    if (s.vy) {  // falling star: a streak behind it
      c.strokeStyle = 'hsla(48, 100%, 75%, 0.5)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(s.x, y);
      c.lineTo(s.x, y - s.vy * 0.25);
      c.stroke();
    }
    const rot = G.clock * 0.8 + s.phase;
    if (s.kind === 'gold') {
      const pulse = 1 + 0.15 * Math.sin(G.clock * 8 + s.phase);
      glow(s.x, y, 40 * grow * pulse, 42, 58, 0.9);
      glow(s.x, y, 12 * grow, 50, 95, 1);
      flare(s.x, y, 30 * grow * pulse, -rot * 1.5, `hsla(50, 100%, 85%, ${0.8 * grow})`, 4);
      continue;
    }
    glow(s.x, y, (22 + bob * 3) * grow, 45, 60, 0.85);
    glow(s.x, y, 7 * grow, 52, 92, 1);
    flare(s.x, y, (14 + 4 * Math.sin(G.clock * 5 + s.phase)) * grow, rot, `hsla(48, 100%, 82%, ${0.6 * grow})`);
  }
}

function drawParticles() {
  c.lineCap = 'round';
  for (const p of G.particles) {
    const t = p.life / p.maxLife;
    if (p.kind === 'streak') {
      c.strokeStyle = `hsla(${p.hue}, 100%, 70%, ${t})`;
      c.lineWidth = p.size * 0.35 * (0.5 + t);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
      c.stroke();
    } else if (p.kind === 'shard') {
      // tumbling debris
      const a = p.rot + p.spin * (p.maxLife - p.life);
      const s = p.size * 0.9;
      c.fillStyle = `hsla(${p.hue}, 100%, 72%, ${t})`;
      c.beginPath();
      c.moveTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s);
      c.lineTo(p.x + Math.cos(a + 2.4) * s * 0.6, p.y + Math.sin(a + 2.4) * s * 0.6);
      c.lineTo(p.x + Math.cos(a + 3.9) * s * 0.6, p.y + Math.sin(a + 3.9) * s * 0.6);
      c.closePath();
      c.fill();
    } else {
      glow(p.x, p.y, p.size * (0.5 + t), p.hue, 65, t);
    }
  }
  c.lineCap = 'butt';
}

function drawRings() {
  for (const r of G.rings) {
    const a = clamp(1 - Math.pow(r.r / r.maxR, 3), 0, 1);
    const w = r.kind === 'bloom' || r.kind === 'fever' ? 0.55 : 1;
    c.strokeStyle = `hsla(${r.hue}, 100%, 70%, ${a * w})`;
    c.lineWidth = (6 * a + 1) * w;
    c.beginPath();
    c.arc(r.x, r.y, r.r, 0, TAU);
    c.stroke();
    c.strokeStyle = `hsla(${r.hue + 40}, 100%, 85%, ${a * 0.6 * w})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(r.x, r.y, r.r * 0.85, 0, TAU);
    c.stroke();
  }
}

// A void's membrane gradient lives in its own rotated frame, so one gradient per size and hue serves every frame.
const membranes = new Map<number, CanvasGradient>();

function membrane(r: number, hue: number): CanvasGradient {
  const rr = Math.max(1, Math.round(r));
  const key = rr * 360 + hue;
  let g = membranes.get(key);
  if (!g) {
    if (membranes.size > 400) membranes.clear();
    g = c.createRadialGradient(0, 0, rr * 0.15, 0, 0, rr * 1.3);
    g.addColorStop(0, '#000');
    g.addColorStop(0.6, '#0b0314');
    g.addColorStop(1, `hsl(${hue}, 85%, 24%)`);
    membranes.set(key, g);
  }
  return g;
}

function drawEnemy(e: Enemy) {
  const ph = e.ph;
  const vis = enemyVisibility(e);
  const sp = Math.hypot(e.vx, e.vy);
  const ang = Math.atan2(e.vy, e.vx);
  c.globalAlpha = vis;

  // fast voids drag a comet tail
  if (ph.speed > 0.25 && sp > 80) {
    const len = e.r * (1.5 + 3 * ph.speed) * clamp(sp / 300, 0, 1);
    const tx = e.x - Math.cos(ang) * (e.r + len);
    const ty = e.y - Math.sin(ang) * (e.r + len);
    const nx = -Math.sin(ang) * e.r * 0.8;
    const ny = Math.cos(ang) * e.r * 0.8;
    const g = c.createLinearGradient(e.x, e.y, tx, ty);
    g.addColorStop(0, `hsla(${e.hue}, 100%, 55%, 0.55)`);
    g.addColorStop(1, `hsla(${e.hue}, 100%, 55%, 0)`);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(e.x + nx, e.y + ny);
    c.lineTo(tx, ty);
    c.lineTo(e.x - nx, e.y - ny);
    c.closePath();
    c.fill();
  }

  c.save();
  c.translate(e.x, e.y);
  c.rotate(ang);
  const stretch = 1 + ph.speed * clamp(sp / 300, 0, 1) * 0.5;
  c.scale(stretch, 1 / Math.sqrt(stretch));

  // membrane
  c.beginPath();
  const spikes = 9 + Math.floor(ph.speed * 6);
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + e.phase * 0.3;
    const rr = i % 2 === 0 ? e.r * (1.15 + 0.15 * Math.sin(e.phase + i)) : e.r * 0.8;
    if (i === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = membrane(e.r, e.hue);
  c.fill();
  c.strokeStyle = `hsl(${e.hue}, 100%, 66%)`;
  c.lineWidth = e.elite ? 2.2 : 1.4;
  c.stroke();

  // swarmers grow cilia
  if (ph.swarm > 0.3) {
    c.strokeStyle = `hsla(${e.hue}, 100%, 70%, 0.6)`;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + e.phase * 0.2;
      const wig = Math.sin(e.phase * 4 + i) * 0.3;
      c.moveTo(Math.cos(a) * e.r * 1.1, Math.sin(a) * e.r * 1.1);
      c.lineTo(Math.cos(a + wig) * e.r * 1.65, Math.sin(a + wig) * e.r * 1.65);
    }
    c.stroke();
  }
  c.restore();

  // heartbeat nucleus
  c.globalCompositeOperation = 'lighter';
  const beat = 1 + 0.2 * Math.max(0, Math.sin(G.clock * 6 + e.phase));
  glow(e.x, e.y, e.r * 0.75 * beat, e.hue, 60, 0.75);
  c.globalCompositeOperation = 'source-over';

  // segmented armor shells, all in one path
  if (e.shells > 0) {
    c.strokeStyle = 'hsla(275, 100%, 72%, 0.8)';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < e.shells; i++) {
      const rot = e.phase * (i % 2 ? -0.5 : 0.5);
      const rr = e.r * 1.35 + i * 5;
      for (let k = 0; k < 3; k++) {
        const a0 = rot + (k * TAU) / 3;
        c.moveTo(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr);
        c.arc(e.x, e.y, rr, a0, a0 + TAU / 3 - 0.5);
      }
    }
    c.stroke();
  }

  // mitosis: twin nuclei
  if (ph.split > 0.45) {
    c.fillStyle = 'hsl(300, 100%, 72%)';
    for (const s of [-1, 1]) {
      const a = e.phase * 0.8;
      c.beginPath();
      c.arc(e.x + Math.cos(a) * e.r * 0.5 * s, e.y + Math.sin(a) * e.r * 0.5 * s, e.r * 0.13, 0, TAU);
      c.fill();
    }
  }

  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = Math.hypot(dx, dy) || 1;

  // spitters: a mouth that glows as it charges
  if (ph.spit > 0.3) {
    const charge = clamp(1 - e.fireCd / 0.6, 0, 1);
    c.fillStyle = `hsla(95, 100%, ${45 + charge * 30}%, ${0.4 + 0.6 * charge})`;
    c.beginPath();
    c.arc(e.x + (dx / d) * e.r * 0.6, e.y + (dy / d) * e.r * 0.6, e.r * 0.18 * (1 + charge * 0.6), 0, TAU);
    c.fill();
  }

  // evasion: an eye that tracks you
  if (ph.evasion > 0.3) {
    const er = e.r * 0.32;
    c.fillStyle = `hsl(${e.hue}, 100%, 88%)`;
    c.beginPath();
    c.arc(e.x, e.y, er, 0, TAU);
    c.fill();
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(e.x + (dx / d) * er * 0.45, e.y + (dy / d) * er * 0.45, er * 0.5, 0, TAU);
    c.fill();
    coverGlows(c, e.x, e.y, er);
  }

  // warded: a fireproof hex shield shimmering around it
  if (e.warded) {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `hsla(52, 100%, 65%, ${0.45 + 0.25 * Math.sin(G.clock * 7 + e.phase)})`;
    c.lineWidth = 1.6;
    c.beginPath();
    const rr = e.r * 1.6 + 3;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU + e.phase * 0.25;
      if (i === 0) c.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
      else c.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    }
    c.stroke();
    c.globalCompositeOperation = 'source-over';
  }

  // pierce: a lance aimed straight at you
  if (e.pierce) {
    const nx = -dy / d;
    const ny = dx / d;
    const tip = e.r * 2.1;
    c.fillStyle = 'hsl(238, 100%, 72%)';
    c.beginPath();
    c.moveTo(e.x + (dx / d) * tip, e.y + (dy / d) * tip);
    c.lineTo(e.x + nx * e.r * 0.35 + (dx / d) * e.r * 0.6, e.y + ny * e.r * 0.35 + (dy / d) * e.r * 0.6);
    c.lineTo(e.x - nx * e.r * 0.35 + (dx / d) * e.r * 0.6, e.y - ny * e.r * 0.35 + (dy / d) * e.r * 0.6);
    c.closePath();
    c.fill();
  }

  // elites wear a crown
  if (e.elite) {
    c.strokeStyle = 'hsl(45, 100%, 65%)';
    c.lineWidth = 2;
    c.beginPath();
    const n = 7;
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * TAU - G.clock * 0.6;
      const rr = e.r * (i % 2 === 0 ? 1.85 : 1.55);
      if (i === 0) c.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
      else c.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    }
    c.closePath();
    c.stroke();
  }
  c.globalAlpha = 1;
}

function drawLeeches() {
  for (const e of G.enemies) {
    if (!e.leeching) continue;
    for (const [w, a] of [[5, 0.2], [1.6, 0.75]] as const) {
      c.strokeStyle = `hsla(160, 100%, 62%, ${a})`;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(e.x, e.y);
      const mx = (e.x + player.x) / 2 + Math.sin(G.clock * 9 + e.phase) * 24;
      const my = (e.y + player.y) / 2 + Math.cos(G.clock * 7 + e.phase) * 24;
      c.quadraticCurveTo(mx, my, player.x, player.y);
      c.stroke();
    }
  }
}

function drawWake() {
  const life = wakeLife();
  const burning = (G.levels.lasso > 0 || G.levels.tail > 0) && G.state === 'play';
  // after a loop burns, the wake runs cold blue until it rekindles
  const cooling = G.levels.lasso > 0 && G.wakeCooldown > 0;
  const fever = G.feverTime > 0;
  const baseHue = cooling ? 205 : burning ? 25 : G.hue;
  const scale = tier() >= 3 ? 1.4 : 1;
  const dim = cooling ? 0.45 : 1;
  wake.forEach((p, i) => {
    const a = clamp(1 - (G.clock - p.t) / life, 0, 1);
    const h = fever ? (G.clock * 400 + i * 14) % 360 : baseHue + (1 - a) * 30;
    glow(p.x, p.y, (5 + 13 * a) * scale, h, 60, a * 0.45 * dim);
  });
  if (G.levels.lasso > 0 && G.state === 'play' && wake.length > 1) {
    c.strokeStyle = cooling ? 'hsla(205, 80%, 70%, 0.25)' : 'hsla(35, 100%, 65%, 0.5)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(wake[0].x, wake[0].y);
    for (const p of wake) c.lineTo(p.x, p.y);
    c.lineTo(player.x, player.y);
    c.stroke();
  }
}

function drawPlayer() {
  const t = tier();
  const hue = G.hue;
  let a = player.invuln > 0 && Math.sin(G.clock * 40) > 0 ? 0.4 : 1;
  if (G.phasing) a *= 0.55;
  const flick = 1 + Math.sin(G.clock * 20) * 0.06;
  const core = 12 + t * 1.5;
  const { x, y } = player;

  glow(x, y, (40 + t * 5) * flick, hue, 60, 0.8 * a);

  // inner swirl, every form
  c.strokeStyle = `hsla(${hue + 20}, 100%, 82%, ${0.5 * a})`;
  c.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const a0 = G.clock * 3 + (k * TAU) / 3;
    c.beginPath();
    c.arc(x, y, core + 3, a0, a0 + 1.2);
    c.stroke();
  }
  if (t >= 1) {  // petals
    const n = 2 + t;
    const rr = core + 8 + t * 2.5;
    for (let i = 0; i < n; i++) {
      const ang = G.clock * (1.4 + t * 0.15) + (i * TAU) / n;
      glow(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 7 + t, hue + 30, 70, 0.8 * a);
    }
  }
  if (t >= 4) {  // star rays
    const n = 4 + (t - 4) * 2;
    c.strokeStyle = `hsla(${hue}, 100%, 80%, ${0.6 * a})`;
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const ang = -G.clock * 0.8 + (i * TAU) / n;
      const len = core + 24 + Math.sin(G.clock * 6 + i) * 8;
      c.moveTo(x + Math.cos(ang) * core, y + Math.sin(ang) * core);
      c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    }
    c.stroke();
  }
  if (t >= 5) {  // nova halo
    c.strokeStyle = `hsla(${hue + 40}, 100%, 75%, ${0.45 * a})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, core + 34 + Math.sin(G.clock * 3) * 4, 0, TAU);
    c.stroke();
  }
  if (G.levels.rebirth > 0) {  // the spare sun, waiting
    const ang = G.clock * 0.7;
    glow(x + Math.cos(ang) * (core + 24), y + Math.sin(ang) * (core + 24), 10, 38, 70, a);
  }
  if (G.phasing) {
    c.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y, core + 6, 0, TAU);
    c.stroke();
  }
  if (t >= 6) {  // singularity: a black core inside an accretion glow
    glow(x, y, core * 1.7, hue + 40, 85, a);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(x, y, core * 0.7, 0, TAU);
    c.fill();
    coverGlows(c, x, y, core * 0.7);
    c.globalCompositeOperation = 'lighter';
  } else {
    glow(x, y, core, hue, 92, a);
  }
}

/** `gpuGlows`: hand the glows to Post's GPU layers instead of drawing them on this canvas. */
export function renderWorld(ctx: CanvasRenderingContext2D, gpuGlows: boolean) {
  c = ctx;
  const { W, H } = view;
  batchGlows(gpuGlows ? c : null);  // glows from here to the bodies pass sit behind them

  // fade the previous frame's alpha instead of clearing, so everything leaves trails
  // (erasing alpha avoids the gray ghosts that painting a translucent dark rect leaves)
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = 'rgba(0, 0, 0, 0.3)';
  c.fillRect(0, 0, W, H);

  c.globalCompositeOperation = 'lighter';
  drawDust();
  drawHazardsGlow(c);
  for (const w of G.wells) glow(w.x, w.y, 150 * clamp(w.life / 0.3, 0, 1), 280, 45, 0.45);
  for (const l of G.loops) {
    const a = clamp(l.life / 0.6, 0, 1);
    tracePoly(l.poly);
    c.fillStyle = `hsla(${l.resisted ? 52 : 25}, 100%, 55%, ${a * (l.resisted ? 0.15 : 0.35)})`;
    c.fill();
    c.strokeStyle = `hsla(40, 100%, 70%, ${a})`;
    c.lineWidth = 3;
    c.stroke();
  }
  drawRings();
  drawSparks();
  drawParticles();
  for (const s of G.shards) glow(s.x, s.y, 12, 300, 72, 0.9);
  for (const b of G.bullets) glow(b.x, b.y, b.r * 3.4, b.hue, 55, 0.8);
  for (const e of G.enemies) {
    glow(e.x, e.y, e.r * (e.elite ? 3.4 : 2.6), e.elite ? 45 : e.pierce ? 238 : e.hue, 55, 0.55 * enemyVisibility(e));
  }
  drawLeeches();
  if (G.levels.stasis && G.state === 'play') {
    c.strokeStyle = 'hsla(205, 100%, 72%, 0.22)';
    c.lineWidth = 1.5;
    c.setLineDash([6, 10]);
    c.lineDashOffset = -G.clock * 20;
    c.beginPath();
    c.arc(player.x, player.y, stasisRadius(), 0, TAU);
    c.stroke();
    c.setLineDash([]);
  }
  drawBossTelegraphs(c);

  c.globalCompositeOperation = 'source-over';
  drawHazardsBody(c);
  for (const w of G.wells) {
    const f = clamp(w.life / 0.3, 0, 1) * clamp((w.maxLife - w.life) / 0.2, 0, 1);
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(w.x, w.y, 18 * f, 0, TAU);
    c.fill();
    c.strokeStyle = `hsla(285, 100%, 75%, ${f})`;
    c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a0 = G.clock * 4 + (i * TAU) / 3;
      c.beginPath();
      c.arc(w.x, w.y, (24 + i * 9) * f, a0, a0 + 1.6);
      c.stroke();
    }
  }
  glowLayer('body');  // a void's nucleus shines on top of its own dark body
  for (const e of G.enemies) drawEnemy(e);
  for (const b of G.bullets) {
    c.fillStyle = '#0a0410';
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, TAU);
    c.fill();
    c.strokeStyle = `hsl(${b.hue}, 100%, 70%)`;
    c.lineWidth = 1.5;
    c.stroke();
  }
  glowLayer('back');  // the apex's halo sits behind its body
  drawBoss(c);
  glowLayer('front');

  c.globalCompositeOperation = 'lighter';
  drawHazardsTop(c);
  for (const b of G.bolts) {
    for (const [w, a] of [[6, 0.25], [1.8, 1]] as const) {
      c.strokeStyle = `hsla(195, 100%, 80%, ${a * clamp(b.life / 0.2, 0, 1)})`;
      c.lineWidth = w;
      c.beginPath();
      b.pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
      c.stroke();
    }
  }
  drawWake();
  for (const g of G.echoes) {
    glow(g.x, g.y, 28, 262, 65, 0.6);
    glow(g.x, g.y, 9, 270, 90, 0.9);
  }
  for (const o of G.orbiters) {
    glow(o.x, o.y, 16, 185, 65, 0.9);
    glow(o.x, o.y, 5, 185, 92, 1);
  }
  if (G.mirror) {
    const m = G.mirror;
    glow(m.x, m.y, 32, G.hue + 180, 60, 0.7);
    glow(m.x, m.y, 9, G.hue + 180, 92, 1);
    c.strokeStyle = `hsla(${G.hue + 180}, 100%, 80%, 0.6)`;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(m.x, m.y, 16, 0, TAU);
    c.stroke();
  }
  if (G.state !== 'dead') drawPlayer();
  c.globalCompositeOperation = 'source-over';
}
