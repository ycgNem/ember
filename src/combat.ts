// Combat: voids, sparks, pulses, spit, and every way they hurt each other.

import { blip } from './audio';
import { bossOnPulse, damageBoss } from './boss';
import { die } from './flow';
import { addShake, banner, burst, hitstop, popup, punch, shock } from './fx';
import { GENES, GENE_FLAVOR, GENE_HUE, GENE_LABEL, LEARN_AT, express, type Gene, type Genome, type Threat } from './genome';
import { HORIZON_R, horizonCenter, popJelly } from './hazards';
import { addFever, registerKill } from './hype';
import { up } from './meta';
import {
  COMBO_CAP, G, budget, comboMult, comboWindow, essenceMult, feverOn, history, maxCharge, maxHp, player, playerRadius, pool,
  scoreMult, sector, stasisFactor, stasisRadius, sweptDist, tailLife, tier, view, wake, wakeCooldownTime,
  type Bullet, type Enemy, type RingKind, type Spark, type SparkKind,
} from './state';
import { TAU, pointInPolygon, rand, type Pt } from './util';

const MAX_ENEMIES = 80;
export const RING_SPEED = 1100;
const RING_DAMAGE: Record<RingKind, number> = { pulse: 7, flare: 7, echo: 3, bloom: 2, nova: 15, fever: 2 };

export type HurtKind = 'pulse' | 'touch' | 'shard' | 'scorch' | 'crush' | 'storm';
/** The void only studies what *you* do to it; an Ion Storm's lightning teaches it nothing. */
const THREAT_OF: Record<HurtKind, Threat | undefined> = { pulse: 'pulse', touch: 'touch', shard: 'shard', scorch: 'fire', crush: 'gravity', storm: undefined };

// ---------- spawning ----------

export function edgePoint(margin = 40): Pt {
  const { W, H } = view;
  const side = Math.floor(rand(0, 4));
  return {
    x: side === 0 ? -margin : side === 1 ? W + margin : rand(0, W),
    y: side === 2 ? -margin : side === 3 ? H + margin : rand(0, H),
  };
}

function sparkAt(x: number, y: number, kind: SparkKind, vy = 0): Spark {
  return { x, y, vy, phase: rand(0, TAU), born: G.clock, age: 0, kind };
}

export function spawnSpark() {
  const { W, H } = view;
  const c = horizonCenter();
  const kind: SparkKind = G.event?.kind === 'goldrush' || Math.random() < 0.03 ? 'gold' : 'spark';
  for (let tries = 0; tries < 30; tries++) {
    const x = rand(40, W - 40);
    const y = rand(110, H - 60);
    if (Math.hypot(x - player.x, y - player.y) < 160) continue;
    if (sector().hazard === 'gravity' && Math.hypot(x - c.x, y - c.y) < HORIZON_R * 3) continue;
    G.sparks.push(sparkAt(x, y, kind));
    return;
  }
}

/** Starfall: sparks raining down from above. */
export function spawnFallingSpark() {
  G.sparks.push(sparkAt(rand(40, view.W - 40), -20, Math.random() < 0.1 ? 'gold' : 'spark', rand(130, 220)));
}

export function dropSpark(x: number, y: number, kind: SparkKind = 'spark') {
  G.sparks.push(sparkAt(x + rand(-14, 14), y + rand(-14, 14), kind));
}

export function makeEnemy(x: number, y: number, geno: Genome, ph: Genome, elite = false): Enemy {
  let top: Gene = GENES[0];
  for (const g of GENES) if (geno[g] > geno[top]) top = g;
  // counter-genes show up in a growing share of the swarm as the void commits to them
  const carries = (v: number) => Math.random() < (v - 0.15) * 1.6;
  return {
    x, y, vx: 0, vy: 0, r: (9 + 20 * ph.size) * (elite ? 1.45 : 1), phase: rand(0, TAU),
    hue: geno[top] > 0.35 ? GENE_HUE[top] : 320,
    geno, ph,
    shells: Math.floor(ph.armor * 3.2) + (ph.size > 0.65 ? 1 : 0) + (elite ? 2 : 0),
    born: G.time, minDist: Infinity, hitCd: 0, fireCd: rand(1.2, 3), drained: 0, dealt: 0, leeching: false,
    warded: elite ? ph.ward > 0.2 : carries(ph.ward),
    pierce: elite ? ph.pierce > 0.2 : carries(ph.pierce),
    dodged: false,
    elite, dead: false, recorded: false,
  };
}

export function spawnWave() {
  const geno = pool.breed();
  let ph = express(geno, budget());
  const p = edgePoint();
  const pack = Math.random() < ph.swarm ? 2 + Math.floor(ph.swarm * rand(1, 4)) : 1;
  if (pack > 1) ph = { ...ph, size: ph.size * 0.5 };
  for (let i = 0; i < pack && G.enemies.length < MAX_ENEMIES; i++) {
    G.enemies.push(makeEnemy(p.x + rand(-40, 40), p.y + rand(-40, 40), geno, ph));
  }

  const avg = pool.average();
  for (const g of GENES) {
    if (avg[g] < LEARN_AT || G.learned.has(g)) continue;
    G.learned.add(g);
    banner(`THE VOID EVOLVED ${GENE_LABEL[g]}`, GENE_FLAVOR[g], GENE_HUE[g]);
    blip(70, 1.4, 'sawtooth', 0.09, 0.6);
    blip(104, 1.4, 'sawtooth', 0.05, 0.6, 0.06);
  }
}

/** A champion: the fittest genome the void remembers, expressed beyond the normal budget. */
export function spawnElite() {
  const geno = pool.champion() ?? pool.breed();
  const p = edgePoint();
  G.enemies.push(makeEnemy(p.x, p.y, geno, express(geno, budget() * 1.5), true));
  banner('AN ELITE STIRS', 'the void sends its champion', 45);
  blip(55, 1.2, 'sawtooth', 0.1, 1.6);
}

// ---------- damage ----------

export function recordFitness(e: Enemy) {
  if (e.recorded) return;
  e.recorded = true;
  const age = Math.min(20, G.time - e.born);
  pool.record(e.geno, age * 0.6 + Math.min(24, 600 / Math.max(25, e.minDist)) + e.dealt * 40 + e.drained * 15);
}

export function hurt(e: Enemy, kind: HurtKind, fromX: number, fromY: number) {
  if (e.dead) return;
  if (kind === 'scorch' && e.warded) return;  // fireproof
  const lethal = kind === 'crush';
  if (!lethal && e.hitCd > 0) return;
  if (!lethal && e.shells > 0) {
    e.shells--;
    e.hitCd = 0.3;
    const dx = e.x - fromX;
    const dy = e.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const kb = 380 + (kind === 'pulse' ? 220 * G.levels.corona : 0);
    e.vx += (dx / d) * kb;
    e.vy += (dy / d) * kb;
    burst(e.x, e.y, 275, 10, 220, 5);
    blip(900, 0.06, 'square', 0.04, 0.6);
    return;
  }
  killEnemy(e, 1, THREAT_OF[kind]);
}

/** `mult` scales the score; 0 kills silently (voids swallowed by the event horizon). */
export function killEnemy(e: Enemy, mult = 1, threat?: Threat) {
  if (e.dead) return;
  e.dead = true;
  recordFitness(e);
  if (threat) pool.noteThreat(threat);
  burst(e.x, e.y, e.hue, e.elite ? 50 : 24, e.elite ? 420 : 320, 8);
  if (mult > 0) blip(rand(160, 240), 0.18, 'square', 0.05, 0.4);
  if (G.state === 'play' && mult > 0) {  // kills from effects still running after death don't score
    G.kills++;
    const gain = Math.round(25 * comboMult() * mult * (e.elite ? 8 : 1) * scoreMult());
    G.score += gain;
    popup(e.x, e.y, `+${gain}`, e.hue, e.elite ? 22 : 15);
    for (let i = 0; i < G.levels.predator * (e.elite ? 3 : 1); i++) dropSpark(e.x, e.y, 'mote');
    if (e.elite) {
      for (let i = 0; i < 4; i++) dropSpark(e.x + rand(-30, 30), e.y + rand(-30, 30));
      dropSpark(e.x, e.y, 'gold');
      shock(e.x, e.y, 240, 20);
      addShake(10);
      hitstop(0.06);
      punch(0.04, e.x, e.y);
    } else {
      shock(e.x, e.y, 80, 6, 0.3);
    }
    registerKill(e.x, e.y, e.elite);
    // FEVER: every kill detonates, so packs go up in chain reactions
    if (feverOn() && G.rings.length < 30) emitRing(e.x, e.y, 95, 'fever', (G.clock * 300) % 360);
  }
  if (e.ph.split > 0.45 && e.r > 10) {
    const ph = { ...e.ph, split: e.ph.split * 0.5, armor: 0 };
    const sp = Math.hypot(e.vx, e.vy) || 1;
    for (const s of [-1, 1]) {
      const c = makeEnemy(e.x, e.y, e.geno, ph);
      c.r = e.r * 0.68;
      c.shells = 0;
      c.hitCd = 0.25;
      c.vx = (-e.vy / sp) * 260 * s;
      c.vy = (e.vx / sp) * 260 * s;
      G.spawnQueue.push(c);
    }
  }
}

/** How the death screen names whatever hit you. */
export function voidName(e: Enemy): string {
  return e.elite ? 'an elite void' : e.pierce ? 'a piercing void' : 'a void';
}

/**
 * Returns whether the hit landed. Invulnerability always protects; Phase protects
 * unless the source pierces it. `cause` names the attacker for the death screen.
 */
export function damagePlayer(cause: string, credit: Enemy | null = null, pierce = false): boolean {
  if (G.state !== 'play' || player.invuln > 0 || (G.phasing && !pierce)) return false;
  if (credit) credit.dealt += 1;
  G.hp -= 1;
  G.killedBy = cause;
  player.invuln = 1.5;
  G.hurtFlash = 1;
  G.streak = 0;
  // a hit breaks the spark combo too: getting tagged has to cost something
  if (G.combo > 1) popup(player.x, player.y + 34, 'COMBO BROKEN', 0, 13);
  G.combo = 0;
  G.comboTimer = 0;
  addShake(16);
  shock(player.x, player.y, 180, 22, 0.45);
  burst(player.x, player.y, 0, 30, 320, 6);
  blip(180, 0.4, 'sawtooth', 0.15, 0.3);
  if (G.phasing) popup(player.x, player.y - 30, 'PIERCED', 238, 16);
  // flinch: shove nearby voids away so there's room to recover
  for (const e of G.enemies) {
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 170) {
      e.vx += (dx / d) * 700;
      e.vy += (dy / d) * 700;
    }
  }
  if (G.levels.flashpoint) {
    emitRing(player.x, player.y, [0, 300, 420][G.levels.flashpoint], 'flare', 15);
    if (G.levels.flashpoint >= 2) player.invuln += 0.6;
  }
  if (G.hp > 0) return true;

  if (G.levels.rebirth > 0) {
    G.levels.rebirth = 0;
    G.spent.add('rebirth');
    G.hp = maxHp();
    player.invuln = 2;
    emitRing(player.x, player.y, Math.hypot(view.W, view.H), 'nova', 38);
    banner('REBORN', 'the second sun is spent', 38, true);
    burst(player.x, player.y, 38, 120, 700, 12);
    addShake(26);
    G.flash = 0.6;
    hitstop(0.15);
    blip(110, 1.2, 'sawtooth', 0.15, 3);
    return true;
  }
  die();
  return true;
}

// ---------- the player's tools ----------

export function emitRing(x: number, y: number, maxR: number, kind: RingKind, hue: number) {
  G.rings.push({ x, y, r: 0, maxR, kind, hue, hit: new Set() });
}

export function pulse() {
  if (G.state !== 'play' || G.charge < 1) return;
  G.charge -= 1;
  const maxR = 260 * (1 + 0.3 * G.levels.corona);
  emitRing(player.x, player.y, maxR, 'pulse', G.hue);
  if (G.levels.binary >= 2 && G.mirror) emitRing(G.mirror.x, G.mirror.y, 200, 'echo', G.hue + 180);
  if (G.levels.mirrors) for (const g of G.echoes) emitRing(g.x, g.y, 180, 'echo', 262);
  if (G.levels.singularity > 0) {
    const life = (1.6 + G.levels.singularity * 0.9) * (G.levels.devourer ? 1.5 : 1);
    G.wells.push({ x: player.x, y: player.y, life, maxLife: life });
  }
  // voids that evolved evasion may see it coming and bolt
  for (const e of G.enemies) {
    if (e.dead || Math.random() > e.ph.evasion * 0.75) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > maxR + 40) continue;
    e.vx = (dx / d) * 750;
    e.vy = (dy / d) * 750;
    burst(e.x, e.y, e.hue, 5, 120, 4);
  }
  bossOnPulse(player.x, player.y, maxR);
  addShake(8);
  punch(0.018, player.x, player.y);
  blip(140, 0.5, 'sawtooth', 0.12, 0.25);
  blip(70, 0.6, 'sine', 0.25, 0.5);
}

export function collect(s: Spark) {
  if (s.kind === 'mote') {
    G.essence += 0.2 * essenceMult();
    G.score += 5 * scoreMult();
    G.charge = Math.min(maxCharge(), G.charge + 0.05);
    burst(s.x, s.y, 350, 6, 140, 4);
    blip(1200, 0.05, 'sine', 0.05, 1.3);
    return;
  }
  const gold = s.kind === 'gold';
  G.combo += 1;
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.comboTimer = comboWindow();
  if (G.combo === COMBO_CAP) popup(player.x, player.y - 60, `MAX COMBO x${COMBO_CAP}`, 50, 18);
  if (G.levels.kindle && G.combo % 10 === 0) G.charge = Math.min(maxCharge(), G.charge + 0.5);
  const gain = (gold ? 60 : 10) * comboMult() * scoreMult();
  G.score += gain;
  G.essence += (gold ? 3 : 1) * essenceMult();
  // sparks charge twice as fast during an apex fight, so you can keep the pressure on
  G.charge = Math.min(maxCharge(), G.charge + (0.25 + 0.1 * G.levels.capacitor) * (G.boss ? 2 : 1) * (gold ? 2 : 1));
  addFever(gold ? 0.08 : 0.012);
  if (gold) {
    burst(s.x, s.y, 48, 50, 420, 8);
    shock(s.x, s.y, 150, 14, 0.4);
    popup(s.x, s.y - 10, `JACKPOT +${gain}`, 48, 20);
    punch(0.02, s.x, s.y);
    [1318, 1568, 2093, 2637].forEach((f, i) => blip(f, 0.12, 'square', 0.04, 1, i * 0.045));
  } else {
    burst(s.x, s.y, 45, 18, 260, 7);
    popup(s.x, s.y, `+${gain}`, 45);
  }
  blip(440 * Math.pow(2, Math.min(G.combo, 24) / 12), 0.14, 'sine', 0.1, 1.5);
  if (G.levels.bloom) emitRing(s.x, s.y, 50 + 40 * G.levels.bloom, 'bloom', 48);
  const n = G.levels.prism ? 1 + G.levels.prism * 2 : 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.3, 0.3);
    G.shards.push({ x: s.x, y: s.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 1.8 });
  }
}

function jagged(a: Pt, b: Pt): Pt[] {
  const pts: Pt[] = [{ x: a.x, y: a.y }];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const off = rand(-14, 14);
    pts.push({ x: a.x + dx * t - (dy / d) * off, y: a.y + dy * t + (dx / d) * off });
  }
  pts.push({ x: b.x, y: b.y });
  return pts;
}

/** Arc: lightning jumps from a struck void to its neighbours. */
function arcFrom(src: Enemy) {
  const hit = new Set<Enemy>([src]);
  let from: Pt = { x: src.x, y: src.y };
  for (let k = 0; k < G.levels.arc * 2; k++) {
    let next: Enemy | null = null;
    let bd = 170;
    for (const e of G.enemies) {
      if (e.dead || hit.has(e)) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y);
      if (d < bd) { bd = d; next = e; }
    }
    if (!next) break;
    hit.add(next);
    G.bolts.push({ pts: jagged(from, next), life: 0.2 });
    hurt(next, 'shard', from.x, from.y);  // knocked back along the bolt
    from = { x: next.x, y: next.y };
  }
  if (hit.size > 1) blip(1800, 0.08, 'sawtooth', 0.04, 0.3);
}

/** Ion Storm: lightning from the sky strikes a random void. */
export function strike() {
  const live = G.enemies.filter((e) => !e.dead);
  const e = live[Math.floor(Math.random() * live.length)];
  if (!e) return;
  G.bolts.push({ pts: jagged({ x: e.x + rand(-80, 80), y: -20 }, e), life: 0.25 });
  hurt(e, 'storm', e.x, e.y - 40);
  shock(e.x, e.y, 70, 8, 0.25);
  blip(rand(1600, 2200), 0.1, 'sawtooth', 0.035, 0.3);
}

/** Reflection: spit your pulse swallows comes back out as one of your homing shards. */
function reflectBullet(b: Bullet) {
  const a = rand(0, TAU);
  G.shards.push({ x: b.x, y: b.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 1.8 });
}

/**
 * Burning Wake: a closed loop incinerates every void inside it and scoops up sparks.
 * Warded voids survive one loop (their ward shatters), and the wake needs a moment
 * to rekindle afterwards.
 */
export function incinerate(poly: Pt[]) {
  let cx = 0;
  let cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length;
  cy /= poly.length;

  let kills = 0;
  let resisted = 0;
  for (const e of G.enemies) {
    if (e.dead || !pointInPolygon(e, poly)) continue;
    if (e.warded) {
      e.warded = false;
      e.hitCd = 0.3;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      e.vx += (dx / d) * 520;
      e.vy += (dy / d) * 520;
      burst(e.x, e.y, 52, 22, 300, 6);
      pool.noteThreat('fire', 0.5);
      resisted++;
    } else {
      killEnemy(e, 2, 'fire');
      kills++;
    }
  }
  for (const b of G.bullets) if (!b.dead && pointInPolygon(b, poly)) b.dead = true;
  for (const j of G.jellies) if (!j.dead && pointInPolygon(j, poly)) popJelly(j);
  if (G.boss && pointInPolygon(G.boss, poly)) damageBoss(G.boss.genes.includes('ward') ? 5 : 18, G.boss.x, G.boss.y, true);
  G.sparks = G.sparks.filter((s) => {
    if (!pointInPolygon(s, poly)) return true;
    collect(s);
    return false;
  });
  G.loops.push({ poly, life: 0.6, resisted: resisted > 0 && kills === 0 });
  G.wakeCooldown = wakeCooldownTime();

  if (G.levels.flare) emitRing(cx, cy, 220, 'flare', 30);
  shock(cx, cy, 160, 14, 0.4);
  blip(180, 0.35, 'sawtooth', 0.08, 2.5);
  if (kills > 0) {
    addShake(6 + kills * 2);
    blip(90, 0.5, 'square', 0.08, 0.5);
  }
  if (resisted > 0) {
    popup(cx, cy + 22, resisted > 1 ? `${resisted} RESISTED` : 'RESISTED', 52, 16);
    blip(1500, 0.2, 'square', 0.04, 0.5);
  }
  if (kills >= 3) popup(cx, cy, `${kills}× INCINERATION`, 30, 22);
}

// ---------- per-frame updates ----------

function echoAt(t: number): Pt | null {
  if (!history.length) return null;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].t <= t) return history[i];
  return history[0];
}

export function updateCompanions(dt: number) {
  G.echoes = [];
  G.orbiters = [];
  G.mirror = null;
  if (G.state !== 'play' && G.state !== 'evolve' && G.state !== 'warp') return;
  for (let k = 1; k <= G.levels.echo; k++) {
    const p = echoAt(G.clock - 0.45 * k);
    if (p) G.echoes.push(p);
  }
  const n = G.levels.orbitals;
  const rr = 46 + tier() * 2;
  for (let i = 0; i < n; i++) {
    const a = G.clock * 3.2 + (i * TAU) / n;
    G.orbiters.push({ x: player.x + Math.cos(a) * rr, y: player.y + Math.sin(a) * rr });
  }
  if (G.levels.binary) G.mirror = { x: view.W - player.x, y: view.H - player.y };
  if (G.state !== 'play') return;

  if (G.levels.overclock) {
    G.overclock += dt;
    if (G.overclock >= [0, 9, 6][G.levels.overclock]) {
      G.overclock = 0;
      if (G.charge < maxCharge()) {
        G.charge = Math.min(maxCharge(), G.charge + 1);
        popup(player.x, player.y - 34, '+charge', 140, 12);
      }
    }
  }
  if (G.levels.constellation && G.orbiters.length) {
    G.constellation -= dt;
    if (G.constellation <= 0) {
      G.constellation = 1.2;
      for (const o of G.orbiters) G.shards.push({ x: o.x, y: o.y, vx: rand(-120, 120), vy: rand(-120, 120), life: 1.6 });
    }
  }
}

export function updateSparks(dt: number) {
  const magR = (G.levels.magnet ? 60 + 90 * G.levels.magnet : 0) + 70 * up('lodestone');
  const collectR = 24 + tier();
  const eaters: Pt[] = [player, ...G.echoes];
  if (G.mirror) eaters.push(G.mirror);
  G.sparks = G.sparks.filter((s) => {
    s.age += dt;
    if (s.kind === 'mote' && s.age > 6) return false;
    if (s.vy) {
      s.y += s.vy * dt;
      if (s.y > view.H + 40) return false;
    }
    const dx = player.x - s.x;
    const dy = player.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < magR) {
      const pull = (320 * (1 - d / magR) + 80) * dt;
      s.x += (dx / d) * pull;
      s.y += (dy / d) * pull;
    }
    for (const e of eaters) {
      if (Math.hypot(e.x - s.x, e.y - s.y) < collectR + (s.kind === 'gold' ? 6 : 0)) {
        collect(s);
        return false;
      }
    }
    return true;
  });
}

function fireBullet(e: Enemy) {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = 180 + 120 * e.ph.spit;
  G.bullets.push({ x: e.x, y: e.y, vx: (dx / d) * sp, vy: (dy / d) * sp, life: 5, r: 5 + e.ph.spit * 3, hue: GENE_HUE.spit, owner: e, dead: false });
  blip(300, 0.1, 'square', 0.03, 0.5);
}

export function updateEnemies(dt: number) {
  const chase = Math.min(90, G.time * 0.7) + G.loop * 25;
  const pr = playerRadius();
  const pull = 2200 + 900 * Math.max(0, G.levels.singularity - 1);
  const stasisR = stasisRadius();
  const stasisK = stasisFactor();
  const scorch = tailLife();
  const playing = G.state === 'play';

  for (const e of G.enemies) {
    if (e.dead) continue;
    const ph = e.ph;
    e.phase += dt * 3;
    e.hitCd -= dt;

    let dx = player.x - e.x;
    let dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.minDist = Math.min(e.minDist, d);
    dx /= d;
    dy /= d;
    if (!playing && G.state !== 'evolve') { dx = -dx; dy = -dy; }  // scatter after you die

    const sp = (55 + 150 * ph.speed) * (1 - 0.3 * ph.size) + chase;
    const zig = Math.sin(G.clock * 5 + e.phase) * ph.evasion;
    const k = Math.min(1, (1.2 + ph.speed) * dt);
    e.vx += ((dx - dy * zig) * sp - e.vx) * k;
    e.vy += ((dy + dx * zig) * sp - e.vy) * k;

    for (const w of G.wells) {
      const wx = w.x - e.x;
      const wy = w.y - e.y;
      const wd = Math.hypot(wx, wy) || 1;
      if (wd < 280) {
        // heavier voids resist the pull: the void's answer to black holes
        const f = (1 - wd / 280) * pull * dt * (1 - 0.65 * ph.size);
        e.vx += (wx / wd) * f;
        e.vy += (wy / wd) * f;
      }
      if (wd < 18 + e.r * 0.4) {
        hurt(e, 'crush', w.x, w.y);
        if (e.dead && G.levels.devourer && ++G.devoured % 10 === 0 && G.hp < maxHp()) {
          G.hp++;
          popup(player.x, player.y - 40, '+ember', 8, 16);
        }
      }
    }
    if (e.dead) continue;

    if (ph.spit > 0.3 && playing) {
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        if (d < 650) fireBullet(e);
        e.fireCd = 3.4 - 2.2 * ph.spit + rand(0, 0.8);
      }
    }

    e.leeching = playing && ph.leech > 0.3 && d < 140;
    if (e.leeching) {
      const amt = ph.leech * dt;
      G.essence = Math.max(0, G.essence - amt * 0.7);
      G.charge = Math.max(0, G.charge - amt * 0.12);
      e.drained += amt;
    }

    const slow = d < stasisR ? stasisK : 1;
    e.x += e.vx * dt * slow;
    e.y += e.vy * dt * slow;

    if (!playing) continue;
    if (sweptDist(e) < e.r + pr) {
      if (G.phasing && !e.pierce) {
        // slipped through it: the void takes note
        if (!e.dodged) {
          e.dodged = true;
          pool.noteThreat('phase');
        }
      } else {
        damagePlayer(voidName(e), e, e.pierce);
        continue;
      }
    }
    for (const o of G.orbiters) if (Math.hypot(o.x - e.x, o.y - e.y) < e.r + 7) hurt(e, 'touch', player.x, player.y);
    for (const g of G.echoes) if (Math.hypot(g.x - e.x, g.y - e.y) < e.r + 11) hurt(e, 'touch', g.x, g.y);
    if (G.mirror && Math.hypot(G.mirror.x - e.x, G.mirror.y - e.y) < e.r + 14) hurt(e, 'touch', G.mirror.x, G.mirror.y);
    if (scorch && !e.warded) {
      for (let i = wake.length - 1; i >= 0; i--) {
        const p = wake[i];
        if (G.clock - p.t > scorch) break;
        if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + 6) {
          hurt(e, 'scorch', p.x, p.y);
          break;
        }
      }
    }
  }

  // keep voids from stacking into one blob
  const list = G.enemies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      b.x += (dx / d) * push;
      b.y += (dy / d) * push;
    }
  }
}

export function updateBullets(dt: number) {
  const { W, H } = view;
  const pr = playerRadius();
  const stasisR = stasisRadius();
  const stasisK = stasisFactor();
  for (const b of G.bullets) {
    if (b.dead) continue;
    const d = Math.hypot(player.x - b.x, player.y - b.y);
    const slow = d < stasisR ? stasisK : 1;
    b.x += b.vx * dt * slow;
    b.y += b.vy * dt * slow;
    b.life -= dt;
    if (b.life <= 0 || b.x < -80 || b.x > W + 80 || b.y < -80 || b.y > H + 80) {
      b.dead = true;
      continue;
    }
    if (G.state === 'play' && sweptDist(b) < b.r + pr) {
      if (damagePlayer(b.owner ? 'void spit' : "an apex's barrage", b.owner)) {
        b.dead = true;
        burst(b.x, b.y, b.hue, 8, 160, 4);
        continue;
      }
    }
    const blockers: Pt[] = G.mirror ? [...G.orbiters, G.mirror] : G.orbiters;
    for (const o of blockers) {
      if (Math.hypot(o.x - b.x, o.y - b.y) < b.r + 9) {
        b.dead = true;
        burst(b.x, b.y, b.hue, 5, 120, 4);
        if (G.levels.reflect >= 2) reflectBullet(b);
        break;
      }
    }
  }
  G.bullets = G.bullets.filter((b) => !b.dead);
}

export function updateEffects(dt: number) {
  for (const r of G.rings) {
    r.r += RING_SPEED * dt;
    if (r.r > r.maxR) continue;
    for (const e of G.enemies) {
      if (e.dead || r.hit.has(e)) continue;
      if (Math.hypot(e.x - r.x, e.y - r.y) < r.r + e.r) {
        r.hit.add(e);
        // Absolute Zero: anything frozen in your stasis field shatters, shells and all
        const frozen = G.levels.zero > 0 && (r.kind === 'pulse' || r.kind === 'flare') && Math.hypot(e.x - player.x, e.y - player.y) < stasisRadius();
        if (r.kind === 'nova' || frozen) {
          if (frozen) burst(e.x, e.y, 200, 16, 260, 6);
          killEnemy(e, 1, 'pulse');
        } else {
          hurt(e, 'pulse', r.x, r.y);
          if ((r.kind === 'pulse' || r.kind === 'flare') && G.levels.arc) arcFrom(e);
        }
      }
    }
    if (r.kind !== 'bloom' && r.kind !== 'fever') {
      for (const b of G.bullets) {
        if (!b.dead && Math.hypot(b.x - r.x, b.y - r.y) < r.r) {
          b.dead = true;
          burst(b.x, b.y, b.hue, 4, 120, 4);
          if (G.levels.reflect && G.shards.length < 120) reflectBullet(b);
        }
      }
    }
    for (const j of G.jellies) {
      if (!j.dead && !r.hit.has(j) && Math.hypot(j.x - r.x, j.y - r.y) < r.r + j.r) {
        r.hit.add(j);
        popJelly(j);
      }
    }
    const boss = G.boss;
    if (boss && !r.hit.has(boss) && Math.hypot(boss.x - r.x, boss.y - r.y) < r.r + boss.r) {
      r.hit.add(boss);
      const frozen = G.levels.zero > 0 && Math.hypot(boss.x - player.x, boss.y - player.y) < stasisRadius() + boss.r;
      damageBoss(RING_DAMAGE[r.kind], r.x, r.y, r.kind === 'nova' || frozen);
    }
  }
  G.rings = G.rings.filter((r) => r.r < r.maxR * 1.12);

  for (const w of G.wells) w.life -= dt;
  G.wells = G.wells.filter((w) => w.life > 0);

  for (const s of G.shards) {
    s.life -= dt;
    let tx = 0;
    let ty = 0;
    let tr = 0;
    let bd = Infinity;
    let target: Enemy | null = null;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d < bd) { bd = d; target = e; tx = e.x; ty = e.y; tr = e.r; }
    }
    const boss = G.boss;
    if (boss && boss.enter >= 1 && boss.dying === 0) {
      const d = Math.hypot(boss.x - s.x, boss.y - s.y);
      if (d < bd) { bd = d; target = null; tx = boss.x; ty = boss.y; tr = boss.r; }
    }
    if (bd < Infinity) {
      const k = Math.min(1, 6 * dt);
      s.vx += (((tx - s.x) / bd) * 560 - s.vx) * k;
      s.vy += (((ty - s.y) / bd) * 560 - s.vy) * k;
      if (bd < tr + 5) {
        if (target) hurt(target, 'shard', s.x, s.y);
        else damageBoss(1, s.x, s.y);
        s.life = 0;
      }
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  G.shards = G.shards.filter((s) => s.life > 0);

  for (const l of G.loops) l.life -= dt;
  G.loops = G.loops.filter((l) => l.life > 0);
  for (const b of G.bolts) b.life -= dt;
  G.bolts = G.bolts.filter((b) => b.life > 0);
  for (const s of G.shocks) {
    s.r += s.speed * dt;
    s.life -= dt;
  }
  G.shocks = G.shocks.filter((s) => s.life > 0);

  if (G.spawnQueue.length) {
    G.enemies.push(...G.spawnQueue);
    G.spawnQueue = [];
  }
  G.enemies = G.enemies.filter((e) => !e.dead);
  if (G.state === 'dead') {
    const { W, H } = view;
    G.enemies = G.enemies.filter((e) => e.x > -200 && e.x < W + 200 && e.y > -200 && e.y < H + 200);
  }
}
