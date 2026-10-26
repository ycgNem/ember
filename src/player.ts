// The wisp's movement and trail, and the dust it pushes through.

import { blip } from './audio';
import { incinerate } from './combat';
import { gravityTarget, horizonCenter } from './hazards';
import { G, WARP_TIME, history, phaseDuration, phaseSpeed, player, pointer, sector, tier, view, wake } from './state';
import { polygonArea, rand, segmentIntersect, type Pt } from './util';

export function updatePlayer(dt: number) {
  const { W, H } = view;
  // until the player touches the mouse, the title wisp orbits the logo
  if (G.state === 'title' && !pointer.moved) {
    pointer.x = W / 2 + Math.cos(G.clock * 0.9) * Math.min(260, W * 0.35);
    pointer.y = H / 2 + Math.sin(G.clock * 1.8) * Math.min(110, H * 0.2);
  }
  if (G.state !== 'play' && G.state !== 'title' && G.state !== 'warp') {
    G.phasing = false;
    return;
  }

  // near-instant exponential follow: ~30ms to close most of the gap, no spring overshoot
  const target = gravityTarget(pointer.x, pointer.y);
  const follow = 1 - Math.exp(-dt * 34);
  const nx = player.x + (target.x - player.x) * follow;
  const ny = player.y + (target.y - player.y) * follow;
  player.vx = (nx - player.x) / dt;
  player.vy = (ny - player.y) / dt;
  player.x = nx;
  player.y = ny;
  player.speed += (Math.hypot(player.vx, player.vy) - player.speed) * Math.min(1, dt * 25);
  player.invuln -= dt;
  updatePhase(dt);
  G.wakeCooldown = Math.max(0, G.wakeCooldown - dt);

  if (G.state !== 'title') {
    history.push({ x: player.x, y: player.y, t: G.clock });
    while (history.length && G.clock - history[0].t > 1.2) history.shift();
  }

  const last = wake[wake.length - 1];
  if (!last || Math.hypot(player.x - last.x, player.y - last.y) > 7) {
    const p = { x: player.x, y: player.y, t: G.clock };
    if (G.state === 'play' && G.levels.lasso > 0 && G.wakeCooldown <= 0 && wake.length > 4) {
      const a = wake[wake.length - 1];
      for (let i = 0; i < wake.length - 3; i++) {
        const hit = segmentIntersect(a, p, wake[i], wake[i + 1]);
        if (!hit) continue;
        const poly: Pt[] = [hit, ...wake.slice(i + 1)];
        if (polygonArea(poly) > 1400) {
          incinerate(poly);
          wake.length = 0;
          wake.push({ ...hit, t: G.clock });
        }
        break;
      }
    }
    wake.push(p);
  }

  if (G.state !== 'title' && (tier() >= 2 || G.feverTime > 0) && Math.random() < 0.8) {
    const life = rand(0.3, 0.5);
    G.particles.push({
      x: player.x + rand(-4, 4), y: player.y + rand(-4, 4),
      vx: -player.vx * 0.12 + rand(-30, 30), vy: -player.vy * 0.12 + rand(-70, 10),
      life, maxLife: life, size: rand(4, 7), hue: G.hue + rand(-15, 25), kind: 'glow', rot: 0, spin: 0,
    });
  }
}

/**
 * Phase is a burst, not a lifestyle: moving fast drains a meter, and running it dry
 * locks Phase out until it has mostly recharged.
 */
function updatePhase(dt: number) {
  const wantsPhase = G.state === 'play' && G.levels.phase > 0 && !G.phaseLocked && player.speed > phaseSpeed() && G.phaseMeter > 0;
  G.phasing = wantsPhase;
  if (wantsPhase) {
    G.phaseMeter -= dt / phaseDuration();
    if (G.phaseMeter <= 0) {
      G.phaseMeter = 0;
      G.phaseLocked = true;
      G.phasing = false;
      blip(260, 0.25, 'square', 0.05, 0.5);
    }
  } else {
    G.phaseMeter = Math.min(1, G.phaseMeter + dt / 1.6);
    if (G.phaseLocked && G.phaseMeter >= 0.6) G.phaseLocked = false;
  }
}

function flowAngle(x: number, y: number, t: number) {
  return (Math.sin(x * 0.0031 + t * 0.21) + Math.cos(y * 0.0043 - t * 0.17) + Math.sin((x + y) * 0.0017 + t * 0.09)) * Math.PI;
}

export function seedDust() {
  const { W, H } = view;
  G.dust = [];
  const n = Math.floor((W * H) / 1700);
  for (let i = 0; i < n; i++) G.dust.push({ x: rand(0, W), y: rand(0, H), vx: 0, vy: 0, z: Math.random() * Math.random() });
}

export function updateDust(dt: number) {
  const { W, H } = view;
  const drag = Math.pow(0.15, dt);
  const pushing = G.state === 'play' || G.state === 'title' || G.state === 'warp';
  const gravity = sector().hazard === 'gravity' && G.state !== 'title';
  const warp = G.state === 'warp' ? Math.sin((Math.PI * G.warpTime) / WARP_TIME) : 0;
  const c = horizonCenter();
  for (const d of G.dust) {
    const depth = 0.5 + d.z;
    const a = flowAngle(d.x, d.y, G.clock);
    d.vx += Math.cos(a) * 30 * dt * depth;
    d.vy += Math.sin(a) * 30 * dt * depth;
    if (pushing) {
      const dx = d.x - player.x;
      const dy = d.y - player.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 140 * 140 && dist2 > 1) {
        const dist = Math.sqrt(dist2);
        const f = ((1 - dist / 140) * 900 * dt) / dist;
        d.vx += dx * f;
        d.vy += dy * f;
      }
    }
    if (gravity || warp > 0) {
      const dx = d.x - c.x;
      const dy = d.y - c.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (gravity) {
        // spiral inward: a little radial pull, a lot of swirl
        const f = (9000 / (dist + 60)) * dt * depth;
        d.vx += (-dx / dist) * f * 0.35 + (-dy / dist) * f;
        d.vy += (-dy / dist) * f * 0.35 + (dx / dist) * f;
      }
      if (warp > 0) {
        d.vx += (dx / dist) * 2400 * warp * dt * depth;
        d.vy += (dy / dist) * 2400 * warp * dt * depth;
      }
    }
    d.vx *= drag;
    d.vy *= drag;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.x < 0) d.x += W; else if (d.x > W) d.x -= W;
    if (d.y < 0) d.y += H; else if (d.y > H) d.y -= H;
  }
}
