// Apex bosses: at the end of each sector, the void grows a champion out of
// its most successful genes. What it can do depends on what it learned from you.

import { blip } from './audio';
import { damagePlayer, dropSpark, makeEnemy } from './combat';
import { startWarp } from './flow';
import { addShake, announce, banner, burst, hitstop, popup, punch, shock } from './fx';
import { GENES, GENE_ADJ, GENE_HUE, GENE_NOUN, express, type Gene } from './genome';
import { drawGlow } from './glow';
import { G, budget, player, playerRadius, pool, sweptDist, tailLife, view, wake, type Boss, type BossMove } from './state';
import { TAU, clamp, pick, rand } from './util';

const SLAM_R = 230;
const TETHER_R = 380;
const AIM_TIME = 0.8;
const SLAM_TIME = 1.0;
/** Health fraction below which an apex enrages. */
const ENRAGE_AT = 0.35;
/** A blinking apex never reappears closer than this to the wisp. */
const BLINK_CLEARANCE = 280;

/** Genes that grant an active attack; armor, mitosis and evasion are passive traits instead. */
const ACTIVE: Partial<Record<Gene, BossMove>> = {
  speed: 'aim',
  size: 'slam',
  swarm: 'summon',
  spit: 'barrage',
  cloak: 'vanish',
  leech: 'tether',
};

function activeMoves(b: Boss): BossMove[] {
  const moves: BossMove[] = [];
  for (const g of b.genes) {
    const m = ACTIVE[g];
    if (m) moves.push(m);
  }
  return moves.length ? moves : ['barrage', 'summon'];
}

export function spawnBoss() {
  const avg = pool.average();
  const genes: Gene[] = pool.dominant(GENES.length).filter((g) => avg[g] > 0.12).slice(0, G.sector >= 3 || G.loop > 0 ? 3 : 2);
  while (genes.length < 2) {
    const g = pick(GENES);
    if (!genes.includes(g)) genes.push(g);
  }
  // it grows with your build, so a stacked wisp can't delete it before it acts
  const maxHp = Math.round((50 + 25 * G.sector) * (1 + 0.6 * G.loop) * (1 + 0.05 * G.evolutions));
  const name = `The ${GENE_ADJ[genes[1]]} ${GENE_NOUN[genes[0]]}`;
  G.boss = {
    x: view.W / 2, y: -140, vx: 0, vy: 0, r: genes.includes('size') ? 66 : 50,
    hp: maxHp, maxHp, phase: 0, hue: GENE_HUE[genes[0]],
    genes, geno: pool.champion() ?? avg, name,
    move: 'idle', moveTime: 0, cd: 2.5, volleys: 0, aimX: 0, aimY: 0,
    plates: genes.includes('armor') ? 6 : 0, plateRegen: 0,
    hitCd: 0, flash: 0, blinkCd: 0, enter: 0,
    splitAt: genes.includes('split') ? [0.66, 0.33] : [],
    dying: 0, alpha: 1, enraged: false,
  };
  banner(name.toUpperCase(), 'an apex has evolved to hunt you', GENE_HUE[genes[0]], true);
  blip(45, 2.2, 'sawtooth', 0.16, 2);
  blip(67, 2.2, 'sawtooth', 0.1, 1.5, 0.1);
  addShake(14);
}

function startMove(b: Boss, m: BossMove) {
  b.move = m;
  b.moveTime = 0;
  b.volleys = 0;
  if (m === 'aim') {
    b.aimX = player.x;
    b.aimY = player.y;
    blip(880, 0.5, 'square', 0.05, 1.5);
  } else if (m === 'slam') {
    blip(110, SLAM_TIME, 'sawtooth', 0.08, 0.5);
  } else if (m === 'summon') {
    const ph = express(b.geno, budget());
    const n = 4 + G.sector + G.loop * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      G.enemies.push(makeEnemy(b.x + Math.cos(a) * b.r * 1.6, b.y + Math.sin(a) * b.r * 1.6, b.geno, ph));
    }
    burst(b.x, b.y, b.hue, 40, 400, 8);
    shock(b.x, b.y, 200, 16);
    blip(90, 0.6, 'sawtooth', 0.1, 2);
    endMove(b, 2.6);
  } else if (m === 'vanish') {
    blip(200, 0.8, 'sine', 0.06, 0.3);
  } else if (m === 'tether') {
    blip(160, 2.4, 'triangle', 0.05, 0.7);
  }
}

function endMove(b: Boss, cd: number) {
  b.move = 'idle';
  b.moveTime = 0;
  b.cd = cd * Math.max(0.55, 1 - G.loop * 0.15) * (b.enraged ? 0.6 : 1);
}

function enrage(b: Boss) {
  b.enraged = true;
  announce('ENRAGED', 0, 6);  // the announcer, not a banner: it can't wait behind the apex's own entrance
  shock(b.x, b.y, 320, 26);
  burst(b.x, b.y, 0, 50, 420, 8);
  addShake(12);
  blip(55, 1.2, 'sawtooth', 0.14, 0.5);
  blip(82, 1.2, 'square', 0.06, 0.6, 0.08);
}

function fireVolley(b: Boss) {
  const n = 12 + G.sector * 2 + G.loop * 4;
  const off = b.volleys * 0.27 + b.phase;
  for (let i = 0; i < n; i++) {
    const a = off + (i * TAU) / n;
    G.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, life: 6, r: 7, hue: b.hue, owner: null, dead: false });
  }
  blip(240, 0.15, 'square', 0.06, 0.5);
}

export function updateBoss(dt: number) {
  const b = G.boss;
  if (!b) return;
  b.phase += dt;
  b.flash -= dt;

  if (b.dying > 0) {
    b.dying += dt;
    if (Math.random() < 0.6) burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), b.hue, 6, 300, 8);
    addShake(6);
    if (b.dying > 1.5) finishBoss(b);
    return;
  }
  if (b.enter < 1) {
    b.enter = Math.min(1, b.enter + dt * 0.45);
    b.x += (view.W / 2 - b.x) * Math.min(1, dt * 2);
    b.y += (view.H * 0.3 - b.y) * Math.min(1, dt * 2);
    return;
  }
  if (G.state !== 'play') return;

  b.hitCd -= dt;
  b.blinkCd -= dt;
  if (b.genes.includes('armor') && b.plates < 6) {
    b.plateRegen += dt;
    if (b.plateRegen > 4.5) {
      b.plates++;
      b.plateRegen = 0;
    }
  }

  const dx = player.x - b.x;
  const dy = player.y - b.y;
  const d = Math.hypot(dx, dy) || 1;
  let speed = (70 + 18 * G.sector + 30 * G.loop) * (b.enraged ? 1.3 : 1);
  b.moveTime += dt;
  b.alpha += ((b.move === 'vanish' ? 0.06 : 1) - b.alpha) * Math.min(1, dt * 5);

  switch (b.move) {
    case 'idle':
      b.cd -= dt;
      if (b.cd <= 0) startMove(b, pick(activeMoves(b)));
      break;
    case 'aim':
      speed = 0;
      if (b.moveTime > AIM_TIME) {
        const ax = b.aimX - b.x;
        const ay = b.aimY - b.y;
        const ad = Math.hypot(ax, ay) || 1;
        b.vx = (ax / ad) * 1350;
        b.vy = (ay / ad) * 1350;
        b.move = 'dash';
        b.moveTime = 0;
        blip(120, 0.4, 'sawtooth', 0.12, 0.4);
      }
      break;
    case 'dash':
      if (b.moveTime > 0.45) endMove(b, 1.8);
      break;
    case 'slam':
      speed = 0;
      if (b.moveTime > SLAM_TIME) {
        if (d < SLAM_R) damagePlayer(`${b.name}'s slam`, null, true);  // too big to phase through
        shock(b.x, b.y, SLAM_R + 80, 30);
        burst(b.x, b.y, b.hue, 70, 500, 9);
        addShake(14);
        blip(60, 0.6, 'square', 0.15, 0.5);
        endMove(b, 2.2);
      }
      break;
    case 'barrage':
      speed *= 0.4;
      if (b.volleys < 3 && b.moveTime >= b.volleys * 0.4) {
        fireVolley(b);
        b.volleys++;
      }
      if (b.volleys >= 3 && b.moveTime > 1.3) endMove(b, 2.4);
      break;
    case 'vanish':
      speed *= 2.2;
      if (b.moveTime > 2.6) {
        shock(b.x, b.y, 220, 18);
        blip(300, 0.3, 'sine', 0.08, 2);
        endMove(b, 2);
      }
      break;
    case 'tether':
      speed *= 0.6;
      if (d < TETHER_R) {
        G.essence = Math.max(0, G.essence - 1.1 * dt);
        G.charge = Math.max(0, G.charge - 0.3 * dt);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.025 * dt);
      }
      if (b.moveTime > 2.4) endMove(b, 2.2);
      break;
    case 'summon':
      break;
  }

  if (b.move !== 'dash') {
    const k = Math.min(1, 2 * dt);
    b.vx += ((dx / d) * speed - b.vx) * k;
    b.vy += ((dy / d) * speed - b.vy) * k;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const m = b.r * 0.6;
  if (b.x < m || b.x > view.W - m) { b.x = clamp(b.x, m, view.W - m); b.vx *= -0.5; }
  if (b.y < m || b.y > view.H - m) { b.y = clamp(b.y, m, view.H - m); b.vy *= -0.5; }

  if (sweptDist(b) < b.r * 0.85 + playerRadius()) damagePlayer(b.move === 'dash' ? `${b.name}'s charge` : b.name, null, b.genes.includes('pierce'));

  // your companions chip away at it
  if (b.hitCd <= 0) {
    const touching = [...G.orbiters, ...G.echoes, ...(G.mirror ? [G.mirror] : [])].some((p) => Math.hypot(p.x - b.x, p.y - b.y) < b.r + 10);
    const scorch = tailLife();
    const scorched = scorch > 0 && wake.some((p) => G.clock - p.t < scorch && Math.hypot(p.x - b.x, p.y - b.y) < b.r);
    if (touching || scorched) {
      damageBoss(1, b.x, b.y);
      b.hitCd = 0.2;
    }
  }
  for (const w of G.wells) {
    if (Math.hypot(w.x - b.x, w.y - b.y) < 140) damageBoss(6 * dt, w.x, w.y, true, true);
  }
}

export function damageBoss(amount: number, x: number, y: number, pierce = false, quiet = false) {
  const b = G.boss;
  // a ring or rift still running after you die mustn't slay the apex and warp you out of the death screen
  if (!b || b.dying > 0 || b.enter < 1 || G.state !== 'play') return;
  if (b.plates > 0 && !pierce) {
    b.plates--;
    b.plateRegen = 0;
    amount *= 0.25;
    burst(x, y, 275, 14, 260, 6);
    blip(1100, 0.08, 'square', 0.05, 0.5);
  }
  b.hp -= amount;
  if (!quiet) {
    b.flash = 0.1;
    popup(b.x + rand(-b.r * 0.5, b.r * 0.5), b.y - b.r, String(Math.max(1, Math.round(amount))), b.hue, 13);
  }
  while (b.splitAt.length && b.hp / b.maxHp < b.splitAt[0]) {
    b.splitAt.shift();
    const ph = express(b.geno, budget() * 1.3);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + b.phase;
      G.enemies.push(makeEnemy(b.x + Math.cos(a) * b.r * 1.5, b.y + Math.sin(a) * b.r * 1.5, b.geno, ph, true));
    }
    banner('IT DIVIDES', 'three champions tear free', b.hue);
    shock(b.x, b.y, 260, 24);
  }
  if (!b.enraged && b.hp > 0 && b.hp / b.maxHp < ENRAGE_AT) enrage(b);
  if (b.hp <= 0) {
    b.hp = 0;
    b.dying = 0.001;
    G.slowmo = 1;
    G.flash = 0.5;
    shock(b.x, b.y, 500, 40, 0.9);
    blip(40, 2.5, 'sawtooth', 0.2, 0.5);
  }
}

/** Watching apexes may blink away from a pulse they see coming. */
export function bossOnPulse(x: number, y: number, maxR: number) {
  const b = G.boss;
  if (!b || b.dying > 0 || b.enter < 1 || !b.genes.includes('evasion') || b.blinkCd > 0) return;
  if (Math.hypot(b.x - x, b.y - y) > maxR + b.r || Math.random() > 0.55) return;
  burst(b.x, b.y, b.hue, 30, 300, 7);
  // reappear across the field, never on top of you: near the centre the mirrored spot is right beside you
  let bx = b.x;
  let by = b.y;
  let best = -1;
  for (let i = 0; i < 12; i++) {
    const tx = clamp(i === 0 ? view.W - player.x : rand(0, view.W), b.r, view.W - b.r);
    const ty = clamp(i === 0 ? view.H - player.y : rand(0, view.H), b.r, view.H - b.r);
    const gap = Math.hypot(tx - player.x, ty - player.y) - b.r;
    if (gap >= BLINK_CLEARANCE) { bx = tx; by = ty; break; }
    if (gap > best) { best = gap; bx = tx; by = ty; }
  }
  b.x = bx;
  b.y = by;
  b.vx = b.vy = 0;
  b.blinkCd = 2.5;
  shock(b.x, b.y, 160, 16);
  blip(1500, 0.15, 'sine', 0.06, 0.4);
}

function finishBoss(b: Boss) {
  burst(b.x, b.y, b.hue, 160, 800, 14);
  shock(b.x, b.y, 700, 50, 1);
  addShake(28);
  G.flash = 0.8;
  const gain = 1000 * (G.sector + 1) * (1 + G.loop);
  G.score += gain;
  popup(b.x, b.y, `+${gain}`, b.hue, 30);
  for (let i = 0; i < 6; i++) dropSpark(b.x + rand(-80, 80), b.y + rand(-80, 80));
  for (let i = 0; i < 2; i++) dropSpark(b.x + rand(-60, 60), b.y + rand(-60, 60), 'gold');
  announce('APEX SLAIN', b.hue, 9);
  hitstop(0.2);
  punch(0.1, b.x, b.y);
  // the spoils: an evolution waiting on the other side of the warp, epic or better
  G.essence = Math.max(G.essence, G.need);
  G.rarityFloor = 'epic';
  G.apexes++;
  G.boss = null;
  startWarp();
}

// ---------- drawing ----------

export function drawBossTelegraphs(c: CanvasRenderingContext2D) {
  const b = G.boss;
  if (!b || b.dying > 0) return;
  if (b.move === 'aim') {
    const t = clamp(b.moveTime / AIM_TIME, 0, 1);
    const dx = b.aimX - b.x;
    const dy = b.aimY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const L = Math.hypot(view.W, view.H);
    const ex = b.x + (dx / d) * L;
    const ey = b.y + (dy / d) * L;
    c.strokeStyle = `hsla(0, 100%, 55%, ${0.12 + 0.18 * t})`;
    c.lineWidth = b.r * 1.6 * t;
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(ex, ey);
    c.stroke();
    c.strokeStyle = `hsla(0, 100%, 70%, ${(0.4 + 0.5 * t) * (0.6 + 0.4 * Math.sin(G.clock * 40))})`;
    c.lineWidth = 2;
    c.stroke();
  } else if (b.move === 'slam') {
    const t = clamp(b.moveTime / SLAM_TIME, 0, 1);
    c.fillStyle = `hsla(0, 100%, 50%, ${0.06 + 0.12 * t})`;
    c.beginPath();
    c.arc(b.x, b.y, SLAM_R, 0, TAU);
    c.fill();
    c.strokeStyle = `hsla(10, 100%, 60%, ${0.4 + 0.5 * t})`;
    c.lineWidth = 2;
    c.stroke();
    c.lineWidth = 5;
    c.beginPath();
    c.arc(b.x, b.y, SLAM_R, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    c.stroke();
  } else if (b.move === 'tether') {
    const d = Math.hypot(player.x - b.x, player.y - b.y);
    if (d < TETHER_R) {
      for (const [w, a] of [[8, 0.25], [2.5, 0.85]] as const) {
        c.strokeStyle = `hsla(160, 100%, 62%, ${a})`;
        c.lineWidth = w;
        c.beginPath();
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const x = b.x + (player.x - b.x) * t;
          const y = b.y + (player.y - b.y) * t;
          const wob = Math.sin(t * 14 - G.clock * 18) * 7 * Math.sin(t * Math.PI);
          const nx = -(player.y - b.y) / (d || 1);
          const ny = (player.x - b.x) / (d || 1);
          if (i === 0) c.moveTo(x + nx * wob, y + ny * wob);
          else c.lineTo(x + nx * wob, y + ny * wob);
        }
        c.stroke();
      }
    }
  }
}

function hexagon(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * TAU) / 6;
    if (i === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
}

export function drawBoss(c: CanvasRenderingContext2D) {
  const b = G.boss;
  if (!b) return;
  const grow = b.dying > 0 ? 1 + b.dying * 0.15 : 1;
  const r = b.r * grow * (0.6 + 0.4 * b.enter);
  const { x, y } = b;
  c.save();
  c.globalAlpha = b.alpha;

  c.globalCompositeOperation = 'lighter';
  drawGlow(c, x, y, r * 3.2, b.hue, 50, 0.6);
  if (b.enraged) drawGlow(c, x, y, r * 2.8, 0, 50, 0.7 + 0.3 * Math.sin(G.clock * 14));
  if (b.move === 'barrage' || b.move === 'tether') drawGlow(c, x, y, r * 1.6, b.hue, 70, 0.5 + 0.3 * Math.sin(G.clock * 20));
  c.globalCompositeOperation = 'source-over';

  // outer crown of spines
  c.beginPath();
  const n = 28;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU + b.phase * 0.15;
    const rr = i % 2 === 0 ? r * (1.25 + 0.18 * Math.sin(b.phase * 3 + i * 1.7)) : r * 0.92;
    if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  const grad = c.createRadialGradient(x, y, r * 0.2, x, y, r * 1.3);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.7, '#0a0212');
  grad.addColorStop(1, `hsl(${b.hue}, 80%, 22%)`);
  c.fillStyle = grad;
  c.fill();
  c.strokeStyle = b.flash > 0 ? '#fff' : b.enraged ? `hsl(${(b.hue + Math.sin(G.clock * 14) * 20 + 360) % 360}, 100%, 62%)` : `hsl(${b.hue}, 100%, 62%)`;
  c.lineWidth = b.flash > 0 ? 4 : 2;
  c.stroke();

  // rotating inner teeth
  c.strokeStyle = `hsla(${b.hue}, 100%, 70%, 0.7)`;
  c.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    const a0 = -b.phase * 0.8 + (k * TAU) / 6;
    c.beginPath();
    c.arc(x, y, r * 0.72, a0, a0 + 0.6);
    c.stroke();
  }

  // mitosis: orbiting nuclei
  if (b.genes.includes('split')) {
    c.fillStyle = 'hsl(300, 100%, 72%)';
    for (let k = 0; k < 3; k++) {
      const a = b.phase * 1.3 + (k * TAU) / 3;
      c.beginPath();
      c.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.07, 0, TAU);
      c.fill();
    }
  }

  // armor plates
  for (let i = 0; i < b.plates; i++) {
    const a = b.phase * 0.9 + (i * TAU) / 6;
    hexagon(c, x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55, 13, a);
    c.fillStyle = '#140822';
    c.fill();
    c.strokeStyle = 'hsl(275, 100%, 72%)';
    c.lineWidth = 2;
    c.stroke();
  }

  // fireproof apexes wear a shimmering ward
  if (b.genes.includes('ward')) {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `hsla(52, 100%, 65%, ${0.35 + 0.25 * Math.sin(G.clock * 6)})`;
    c.lineWidth = 3;
    hexagon(c, x, y, r * 1.95, b.phase * 0.4);
    c.stroke();
    c.globalCompositeOperation = 'source-over';
  }

  // the eye: every apex watches you
  const blink = b.phase % 4.3 < 0.12 ? 0.1 : 1;
  const dx = player.x - x;
  const dy = player.y - y;
  const d = Math.hypot(dx, dy) || 1;
  c.globalAlpha = Math.max(b.alpha, 0.5);
  c.fillStyle = `hsl(${b.hue}, 100%, 88%)`;
  c.beginPath();
  c.ellipse(x, y, r * 0.42, r * 0.3 * blink, 0, 0, TAU);
  c.fill();
  if (blink > 0.5) {
    const ix = x + (dx / d) * r * 0.12;
    const iy = y + (dy / d) * r * 0.08;
    c.fillStyle = b.enraged ? 'hsl(0, 100%, 50%)' : `hsl(${b.hue}, 100%, 45%)`;
    c.beginPath();
    c.arc(ix, iy, r * 0.2, 0, TAU);
    c.fill();
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(ix, iy, r * 0.05, r * 0.17, 0, 0, TAU);
    c.fill();
  }

  // death throes: light cracking out of it
  if (b.dying > 0) {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `hsla(${b.hue}, 100%, 85%, ${clamp(b.dying, 0, 1)})`;
    c.lineWidth = 3;
    c.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4 + b.phase * 0.2;
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * r * (1 + b.dying), y + Math.sin(a) * r * (1 + b.dying));
    }
    c.stroke();
  }
  c.restore();
}
