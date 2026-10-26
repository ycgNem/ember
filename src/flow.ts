// Run flow: starting a run, evolving, sector events, warps, death, and the Starforge.

import { blip, noiseHit, setAmbient } from './audio';
import { spawnBoss } from './boss';
import { emitRing, recordFitness, spawnElite, spawnFallingSpark, spawnSpark, spawnWave, strike, updateSparks } from './combat';
import { addShake, announce, banner, burst, hitstop, popup, punch } from './fx';
import { GENES, LEARN_AT } from './genome';
import { resetHazards } from './hazards';
import { dustFor, meta, saveMeta, up } from './meta';
import { MUTATION_BY_ID, RARITY, TIERS, emptyLevels, rollOffer, rollRarity, roman } from './mutations';
import { SECTORS } from './sectors';
import {
  G, WARP_TIME, essenceNeeded, history, maxCharge, maxHp, player, pointer, pool, scoreMult, sector, store, tier, view, wake,
  type EventKind,
} from './state';
import { pick, rand } from './util';

const EVENT_TIME = 12;
export const EVENTS: Record<EventKind, { name: string; sub: string; hue: number }> = {
  starfall: { name: 'STARFALL', sub: 'the sky is raining sparks', hue: 48 },
  bloodmoon: { name: 'BLOOD MOON', sub: 'twice the void, twice the glory', hue: 355 },
  goldrush: { name: 'GOLD RUSH', sub: 'every spark is a jackpot', hue: 45 },
  eclipse: { name: 'ECLIPSE', sub: 'the lights go out', hue: 230 },
  storm: { name: 'ION STORM', sub: 'the sky strikes the void for you', hue: 195 },
};

export function resetRun() {
  G.time = 0;
  G.sectorTime = 0;
  G.slowmo = 0;
  G.hitstop = 0;
  G.zoom = 0;
  G.score = 0;
  G.displayScore = 0;
  G.combo = 0;
  G.comboTimer = 0;
  G.streak = 0;
  G.streakTimer = 0;
  G.announce = null;
  G.fever = 0;
  G.feverTime = 0;
  G.feverIdle = 0;
  G.levels = emptyLevels();
  G.phaseMeter = 1;
  G.phaseLocked = false;
  G.wakeCooldown = 0;
  G.hurtFlash = 0;
  G.flash = 0;
  G.spawnTimer = 1.5;
  G.eliteTimer = 30;
  G.essence = 0;
  G.evolutions = 0;
  G.rerolls = up('reroll');
  G.rarityFloor = 'common';
  G.sector = 0;
  G.loop = 0;
  G.apexes = 0;
  G.kills = 0;
  G.bossSpawned = false;
  G.event = null;
  G.eventAt = rand(22, 40);
  G.eventDone = true;  // the Shallows stay calm; events start from the second sector
  G.overclock = 0;
  G.constellation = 0;
  G.devoured = 0;
  G.spent.clear();
  G.stormTimer = 0;
  G.killedBy = '';
  G.bestStreak = 0;
  G.maxCombo = 0;
  G.boss = null;
  G.particles = [];
  G.sparks = [];
  G.enemies = [];
  G.spawnQueue = [];
  G.bullets = [];
  G.rings = [];
  G.wells = [];
  G.shards = [];
  G.loops = [];
  G.bolts = [];
  G.popups = [];
  G.banners = [];
  G.shocks = [];
  resetHazards();
  player.x = player.px = pointer.x;
  player.y = player.py = pointer.y;
  player.vx = player.vy = player.speed = 0;
  player.invuln = 0;
  wake.length = 0;
  history.length = 0;
  // traits the void already remembers from earlier runs don't get announced again
  G.learned.clear();
  const avg = pool.average();
  for (const g of GENES) if (avg[g] >= LEARN_AT) G.learned.add(g);

  // Starforge: Head Start hands out free mutations
  for (let i = 0; i < up('headstart'); i++) {
    const [id] = rollOffer(G.levels, false, 1);
    if (!id) break;
    G.levels[id]++;
    G.evolutions++;
  }
  G.need = essenceNeeded(G.evolutions);
  // a head-start Ember Heart or Capacitor arrives filled, not as an empty slot
  G.hp = maxHp();
  G.charge = Math.min(maxCharge(), 1 + up('charge') + G.levels.capacitor);

  G.state = 'play';
  const s = SECTORS[0];
  banner(s.name.toUpperCase(), s.subtitle, s.hue, true);
  setAmbient(s.root);
}

// ---------- events ----------

function startEvent() {
  // the Abyss is already dark, so it never eclipses
  const kinds = (Object.keys(EVENTS) as EventKind[]).filter((k) => !(k === 'eclipse' && sector().hazard === 'dark'));
  const kind = pick(kinds);
  const def = EVENTS[kind];
  G.event = { kind, time: EVENT_TIME, maxTime: EVENT_TIME };
  announce(def.name, def.hue, 6);
  banner(def.name, def.sub, def.hue);
  addShake(8);
  noiseHit(0.25, 1.2, 600, 'lowpass');
  blip(kind === 'bloodmoon' ? 60 : 300, 1.5, 'sawtooth', 0.1, kind === 'bloodmoon' ? 0.7 : 2);
}

function updateEvent(dt: number) {
  if (!G.event) {
    if (!G.eventDone && !G.boss && G.sectorTime > G.eventAt) {
      G.eventDone = true;
      if (Math.random() < 0.75) startEvent();
    }
    return;
  }
  G.event.time -= dt;
  if (G.event.kind === 'starfall' && Math.random() < dt * 6) spawnFallingSpark();
  if (G.event.kind === 'storm') {
    G.stormTimer -= dt;
    if (G.stormTimer <= 0) {
      G.stormTimer = rand(0.3, 0.6);
      strike();
    }
  }
  if (G.event.time <= 0) G.event = null;
}

// ---------- play ----------

export function updatePlay(dt: number) {
  G.time += dt;
  G.sectorTime += dt;

  G.comboTimer -= dt;
  if (G.comboTimer <= 0 && G.combo > 0) {
    G.combo = 0;
    blip(220, 0.25, 'triangle', 0.06, 0.5);
  }

  updateEvent(dt);

  const wantSparks = Math.min(12, 4 + Math.floor(G.sectorTime / 25) + (G.feverTime > 0 ? 3 : 0)) + up('abundance');
  let live = 0;
  for (const s of G.sparks) if (s.kind !== 'mote' && !s.vy) live++;
  for (; live < wantSparks; live++) spawnSpark();

  G.spawnTimer -= dt;
  if (G.spawnTimer <= 0) {
    spawnWave();
    const base = Math.max(0.32, 1.35 - G.sectorTime * 0.012 - G.sector * 0.1);
    const blood = G.event?.kind === 'bloodmoon' ? 0.5 : 1;
    G.spawnTimer = (base * blood * (G.boss ? 1.7 : 1)) / (1 + G.loop * 0.3);
  }

  G.eliteTimer -= dt;
  if (G.eliteTimer <= 0) {
    spawnElite();
    G.eliteTimer = Math.max(14, 32 - G.sector * 3 - G.loop * 4);
  }

  if (!G.bossSpawned && G.sectorTime >= sector().duration) {
    G.bossSpawned = true;
    G.event = null;
    spawnBoss();
  }

  updateSparks(dt);
  if (G.essence >= G.need) startEvolve();
}

// ---------- evolving ----------

function rollCards() {
  G.offer = rollOffer(G.levels, G.evolutions === 0, 3 + up('foresight'), G.spent);
  G.rarities = G.offer.map((id) => (MUTATION_BY_ID[id].requires ? 'legendary' : rollRarity(up('luck'), G.rarityFloor)));
  G.offerTime = 0;
  if (G.rarities.includes('legendary')) {
    [1046, 1318, 1568, 2093, 2637].forEach((f, i) => blip(f, 0.4, 'sine', 0.05, 1, 0.35 + i * 0.06));
  }
}

export function startEvolve() {
  rollCards();
  G.essence -= G.need;
  if (!G.offer.length) {  // everything maxed: cash the essence in for points
    G.score += 500 * scoreMult();
    return;
  }
  G.state = 'evolve';
  [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.25, 'triangle', 0.07, 1, i * 0.07));
}

/** Rerolls keep the same rarity floor (an apex's epic guarantee survives a reroll). */
export function reroll() {
  if (G.state !== 'evolve' || G.rerolls <= 0 || G.offerTime < 0.35) return;
  G.rerolls--;
  rollCards();
  blip(700, 0.15, 'square', 0.05, 1.8);
  noiseHit(0.15, 0.2, 4000);
}

export function choose(i: number) {
  const id = G.offer[i];
  if (!id) return;
  const m = MUTATION_BY_ID[id];
  const rarity = G.rarities[i] ?? 'common';
  G.rarityFloor = 'common';
  const before = tier();
  let overflow = 0;
  let gained = 0;
  for (let k = 0; k < RARITY[rarity].levels; k++) {
    if (G.levels[id] < m.max) {
      G.levels[id]++;
      gained++;
    } else {
      overflow++;
    }
  }
  G.evolutions++;
  G.need = essenceNeeded(G.evolutions);
  // every level gained pays out, so an epic Ember Heart heals twice
  if (id === 'capacitor') G.charge += gained;
  if (id === 'heart') G.hp = Math.min(maxHp(), G.hp + gained);
  G.hp = Math.min(maxHp(), G.hp + overflow);  // levels past the max become healing
  if (rarity === 'rare') G.charge = maxCharge();
  G.charge = Math.min(maxCharge(), G.charge);
  G.state = 'play';
  player.invuln = Math.max(player.invuln, 1);  // a moment to get your bearings after the pause

  if (rarity === 'legendary') {
    G.hp = maxHp();
    emitRing(player.x, player.y, Math.hypot(view.W, view.H), 'nova', 45);
    const bonus = 1500 * (G.sector + 1) * scoreMult();
    G.score += bonus;
    popup(player.x, player.y - 50, `+${bonus}`, 45, 26);
    announce('LEGENDARY', 45, 10);
    hitstop(0.15);
    punch(0.08, player.x, player.y);
    G.flash = 0.5;
    addShake(18);
  } else if (rarity === 'epic') {
    announce('EPIC', 285, 6);
    punch(0.04, player.x, player.y);
  }

  const after = tier();
  if (after > before) {
    const t = TIERS[after];
    banner(t.name.toUpperCase(), 'you evolved', t.hue, true);
    burst(player.x, player.y, t.hue, 90, 520, 10);
    addShake(10);
    [262, 330, 392, 523].forEach((f, k) => blip(f, 0.9, 'triangle', 0.08, 1.01, k * 0.09));
  } else {
    banner(`${m.name} ${roman(G.levels[id])}`, m.requires ? 'synergy unlocked' : '', m.hue);
    burst(player.x, player.y, m.hue, 40, 360, 8);
    blip(660, 0.3, 'triangle', 0.08, 1.5);
  }
}

// ---------- warping between sectors ----------

export function startWarp() {
  G.state = 'warp';
  G.warpTime = 0;
  G.event = null;
  for (const e of G.enemies) {
    if (e.dead) continue;
    recordFitness(e);
    e.dead = true;
    burst(e.x, e.y, e.hue, 10, 200, 6);
  }
  for (const j of G.jellies) burst(j.x, j.y, j.hue, 10, 200, 6);
  G.bullets = [];
  resetHazards();
  G.hp = Math.min(maxHp(), G.hp + 1);
  pool.save();
  blip(110, 3, 'sawtooth', 0.08, 8);
  blip(220, 3, 'sine', 0.05, 6, 0.2);
}

export function updateWarp(dt: number) {
  const before = G.warpTime;
  G.warpTime += dt;
  updateSparks(dt);  // the apex's sparks can still be scooped up on the way out
  const mid = WARP_TIME * 0.45;
  if (before < mid && G.warpTime >= mid) {
    G.sector++;
    if (G.sector >= SECTORS.length) {
      G.sector = 0;
      G.loop++;
    }
    G.sectorTime = 0;
    G.bossSpawned = false;
    G.eventAt = rand(22, 40);
    G.eventDone = false;
    resetHazards();
    const s = sector();
    banner(s.name.toUpperCase(), G.loop ? `ascension ${roman(G.loop)}  ·  ${s.subtitle}` : s.subtitle, s.hue, true);
    setAmbient(s.root);
    G.flash = 0.35;
    const depth = G.loop * SECTORS.length + G.sector + 1;
    if (depth > G.deepest) {
      G.deepest = depth;
      store('ember-deepest', depth);
    }
  }
  if (G.warpTime >= WARP_TIME) {
    G.state = 'play';
    G.spawnTimer = 2;
    G.eliteTimer = Math.max(G.eliteTimer, 12);
  }
}

// ---------- death and the Starforge ----------

export function die() {
  G.state = 'dead';
  G.deadTimer = 0;
  G.phasing = false;
  G.feverTime = 0;
  G.banners = [];  // nothing stale hanging over the death screen
  addShake(22);
  burst(player.x, player.y, G.hue, 90, 520, 10);
  burst(player.x, player.y, 0, 30, 300, 6);
  blip(320, 1.1, 'sawtooth', 0.18, 0.08);
  for (const e of G.enemies) if (!e.dead) recordFitness(e);
  pool.save();
  if (G.score > G.best) {
    G.best = G.score;
    store('ember-best', G.best);
  }
  G.runDust = dustFor(G.score, G.apexes, G.loop * SECTORS.length + G.sector, G.kills);
  meta.dust += G.runDust;
  saveMeta();
}

/** Seconds the death screen holds before a click relights, so a panicked pulse can't skip the recap. */
export const DEATH_HOLD = 1.5;

export function openForge() {
  if (G.state !== 'title' && !(G.state === 'dead' && G.deadTimer > DEATH_HOLD)) return;
  G.forgeFrom = G.state;
  G.state = 'forge';
  blip(330, 0.3, 'triangle', 0.06, 1.5);
}

export function closeForge() {
  if (G.state !== 'forge') return;
  G.state = G.forgeFrom;
  blip(330, 0.2, 'triangle', 0.05, 0.7);
}
