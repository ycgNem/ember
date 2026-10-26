// Ember: a wisp that evolves, hunted by a void that evolves back.

import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';

import { blip, ensureAudio, setAmbient, setMusicIntensity, toggleMute } from './audio';
import { spawnBoss, updateBoss } from './boss';
import { pulse, updateBullets, updateCompanions, updateEffects, updateEnemies } from './combat';
import { choose, closeForge, openForge, reroll, resetRun, startWarp, updatePlay, updateWarp } from './flow';
import { banner } from './fx';
import { HORIZON_R, horizonCenter, updateHazards } from './hazards';
import { deathForgeRect, drawHud, forgeLayout, hoveredCard, noteBuy, pointerIn, rerollRect, titleForgeRect } from './hud';
import { addFever, updateHype } from './hype';
import { buy, meta } from './meta';
import { TIERS } from './mutations';
import { seedDust, updateDust, updatePlayer } from './player';
import { Post, type PostParams } from './post';
import { renderWorld } from './render';
import { G, WARP_TIME, player, pointer, pool, sector, tier, view, wake, wakeLife } from './state';
import { rand } from './util';

// ---------- canvases ----------
// world (offscreen 2D, trails) -> gl (post-processing, visible) -> hud (2D, crisp, on top)

function canvasById(id: string): HTMLCanvasElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLCanvasElement)) throw new Error(`missing #${id} canvas`);
  return el;
}
const glCanvas = canvasById('gl');
const hudCanvas = canvasById('hud');
const worldCanvas = document.createElement('canvas');
const maybeHud = hudCanvas.getContext('2d');
const maybeWorld = worldCanvas.getContext('2d');
if (!maybeHud || !maybeWorld) throw new Error('2d context unavailable');
const hud = maybeHud;
const world = maybeWorld;

const post = Post.create(glCanvas);
// without WebGL2, fall back to compositing the world straight onto a flat sky
const flat = post ? null : glCanvas.getContext('2d');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // the world and post passes run at up to 1.5x; the HUD gets full density for crisp text
  const worldDpr = Math.min(dpr, 1.5);
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  const size = (c: HTMLCanvasElement, s: number) => {
    c.width = Math.floor(view.W * s);
    c.height = Math.floor(view.H * s);
  };
  size(worldCanvas, worldDpr);
  size(glCanvas, worldDpr);
  size(hudCanvas, dpr);
  world.setTransform(worldDpr, 0, 0, worldDpr, 0, 0);
  hud.setTransform(dpr, 0, 0, dpr, 0, 0);
  flat?.setTransform(worldDpr, 0, 0, worldDpr, 0, 0);
  post?.resize(glCanvas.width, glCanvas.height);
  seedDust();
}
window.addEventListener('resize', resize);
resize();
pointer.x = player.x = view.W / 2;
pointer.y = player.y = view.H / 2;

for (const f of ['700 16px Orbitron', '900 16px Orbitron', '400 16px "Chakra Petch"', '700 16px "Chakra Petch"']) {
  void document.fonts.load(f);
}

// ---------- input ----------

function start() {
  ensureAudio();
  setAmbient(sector().root);
}

function forgeClick() {
  const { tiles, back } = forgeLayout();
  if (pointerIn(back)) {
    closeForge();
    return;
  }
  for (const t of tiles) {
    if (!pointerIn(t)) continue;
    if (buy(t.u)) {
      noteBuy(t.u.id);
      [784, 988, 1318].forEach((f, i) => blip(f, 0.2, 'triangle', 0.07, 1, i * 0.05));
    } else {
      blip(150, 0.15, 'square', 0.05, 0.7);
    }
    return;
  }
}

hudCanvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.moved = true;
}, { passive: true });

hudCanvas.addEventListener('pointerdown', (e) => {
  pointer.moved = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  start();
  if (G.paused) {
    G.paused = false;
    return;
  }
  switch (G.state) {
    case 'title':
      if (pointerIn(titleForgeRect())) openForge();
      else resetRun();
      break;
    case 'forge':
      forgeClick();
      break;
    case 'dead':
      if (G.deadTimer <= 0.8) break;
      if (pointerIn(deathForgeRect())) openForge();
      else resetRun();
      break;
    case 'evolve': {
      if (G.offerTime <= 0.35) break;
      const rr = rerollRect();
      if (rr && pointerIn(rr)) reroll();
      else choose(hoveredCard());
      break;
    }
    default:
      pulse();
  }
});

window.addEventListener('keydown', (e) => {
  start();
  const s = G.state;
  if (e.code === 'Space') {
    e.preventDefault();
    if (G.paused) G.paused = false;
    else if (s === 'play') pulse();
    else if (s === 'title' || (s === 'dead' && G.deadTimer > 0.8)) resetRun();
  } else if (e.code === 'KeyF') {
    if (s === 'forge') closeForge();
    else openForge();
  } else if (e.code === 'Escape' && s === 'forge') {
    closeForge();
  } else if ((e.code === 'KeyP' || e.code === 'Escape') && s !== 'title' && s !== 'dead' && s !== 'forge') {
    G.paused = !G.paused;
  } else if (e.code === 'KeyM') {
    banner(toggleMute() ? 'MUTED' : 'SOUND ON', '', 200);
  } else if (s === 'evolve' && G.offerTime > 0.35 && /^Digit[1-4]$/.test(e.code)) {
    choose(Number(e.code.slice(5)) - 1);
  } else if (e.code === 'KeyR') {
    if (s === 'evolve') reroll();
    else if (s === 'title' || s === 'dead') {
      pool.reset();
      banner('THE VOID FORGETS', 'its memory of you is gone', 320);
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (G.state === 'play' || G.state === 'evolve' || G.state === 'warp')) G.paused = true;
});

// ---------- update ----------

function musicLevel(): number {
  if (G.paused || G.state === 'dead') return 0;
  if (G.state === 'title' || G.state === 'forge' || G.state === 'evolve') return 1;
  if (G.state === 'warp') return 2;
  if (G.feverTime > 0) return 3;
  return G.boss || G.combo >= 5 || G.streak >= 3 || G.sector >= 2 || G.loop > 0 ? 2 : 1;
}

function update(rawDt: number) {
  setMusicIntensity(musicLevel());
  if (rawDt <= 0 || G.paused) return;
  G.clock += rawDt;
  if (G.slowmo > 0) G.slowmo -= rawDt;
  let dt = G.slowmo > 0 ? rawDt * 0.3 : rawDt;
  if (G.hitstop > 0) {
    G.hitstop -= rawDt;
    dt *= 0.06;
  }
  // ambient motion slows to a crawl while you pick a mutation
  const ambient = G.state === 'evolve' || G.state === 'forge' ? rawDt * 0.2 : dt;

  updatePlayer(dt);
  updateCompanions(dt);
  updateDust(ambient);
  while (wake.length && G.clock - wake[0].t > wakeLife()) wake.shift();

  if (G.feverTime > 0) {
    G.hue = (G.clock * 240) % 360;
  } else {
    const targetHue = TIERS[tier()].hue + Math.min(G.combo, 20) * 3;
    G.hue += (targetHue - G.hue) * Math.min(1, rawDt * 3);
  }

  if (G.state === 'play') updatePlay(dt);
  if (G.state === 'warp') updateWarp(dt);
  if (G.state === 'evolve') {
    G.offerTime += rawDt;
  } else if (G.state !== 'forge') {
    updateBoss(dt);
    updateHazards(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateEffects(dt);
  }
  updateHype(dt);

  const pdrag = Math.pow(0.08, ambient);
  for (const p of G.particles) {
    p.vx *= pdrag;
    p.vy *= pdrag;
    p.x += p.vx * ambient;
    p.y += p.vy * ambient;
    p.life -= ambient;
  }
  G.particles = G.particles.filter((p) => p.life > 0);
  if (G.particles.length > 1800) G.particles.splice(0, G.particles.length - 1800);

  for (const p of G.popups) {
    p.y -= 40 * rawDt;
    p.life -= rawDt;
  }
  G.popups = G.popups.filter((p) => p.life > 0);

  if (G.banners.length && G.state !== 'evolve') {
    G.banners[0].life -= rawDt;
    if (G.banners[0].life <= 0) G.banners.shift();
  }

  G.displayScore += (G.score - G.displayScore) * Math.min(1, rawDt * 7);
  if (Math.abs(G.score - G.displayScore) < 1) G.displayScore = G.score;
  if (G.state === 'dead') G.deadTimer += rawDt;
  G.shake *= Math.pow(0.02, rawDt);
  G.zoom *= Math.pow(0.0015, rawDt);
  G.hurtFlash = Math.max(0, G.hurtFlash - rawDt * 1.4);
  G.flash = Math.max(0, G.flash - rawDt * 2);
}

// ---------- render ----------

let darkness = 0;
let blood = 0;
let feverGlow = 0;

function postParams(shakeX: number, shakeY: number, dt: number): PostParams {
  const s = sector();
  const inSector = G.state !== 'title' && !(G.state === 'forge' && G.forgeFrom === 'title');
  const ease = (v: number, target: number, rate: number) => v + (target - v) * Math.min(1, dt * rate);
  darkness = ease(darkness, s.hazard === 'dark' && inSector && G.state !== 'warp' ? 1 : 0, 1.5);
  blood = ease(blood, G.event?.kind === 'bloodmoon' ? 1 : 0, 1.2);
  feverGlow = ease(feverGlow, G.feverTime > 0 ? 1 : 0, 4);
  const warp = G.state === 'warp' ? Math.sin((Math.PI * G.warpTime) / WARP_TIME) : 0;

  const shocks: PostParams['shocks'] = [];
  for (const r of G.rings) {
    if (r.kind !== 'bloom' && r.kind !== 'fever' && r.r < r.maxR) shocks.push({ x: r.x, y: r.y, r: r.r, strength: 16 * (1 - r.r / r.maxR) });
  }
  for (const k of G.shocks) shocks.push({ x: k.x, y: k.y, r: k.r, strength: k.strength * (k.life / k.maxLife) });
  // the strongest ripples win the shader's limited slots
  shocks.sort((a, b) => b.strength - a.strength);

  const lenses: PostParams['lenses'] = [];
  if (s.hazard === 'gravity' && inSector) {
    const c = horizonCenter();
    lenses.push({ x: c.x, y: c.y, mass: HORIZON_R * 1.4 });
  }
  for (const w of G.wells) lenses.push({ x: w.x, y: w.y, mass: 44 * Math.min(1, w.life / 0.3) });
  if (G.boss?.genes.includes('size')) lenses.push({ x: G.boss.x, y: G.boss.y, mass: 26 });

  const lights: PostParams['lights'] = [];
  if (darkness > 0.001) {
    lights.push({ x: player.x, y: player.y, r: 240 + tier() * 14 });
    for (const r of G.rings) if (lights.length < 4) lights.push({ x: r.x, y: r.y, r: r.r * 1.15 });
    if (G.boss) lights.push({ x: G.boss.x, y: G.boss.y, r: G.boss.r * 2 });
    for (const sp of G.sparks) if (sp.kind !== 'mote' && lights.length < 13) lights.push({ x: sp.x, y: sp.y, r: sp.kind === 'gold' ? 130 : 80 });
    for (const b of G.bullets) if (lights.length < 16) lights.push({ x: b.x, y: b.y, r: 45 });
  }

  return {
    time: G.clock,
    width: view.W,
    height: view.H,
    palette: s.palette,
    player: { x: player.x, y: player.y },
    shake: { x: shakeX, y: shakeY },
    shocks,
    lenses,
    dark: darkness,
    lights,
    warp,
    aberration: 0.006 + G.shake * 0.0012 + G.hurtFlash * 0.03 + warp * 0.03 + G.zoom * 0.15 + feverGlow * 0.006,
    hurt: G.hurtFlash,
    flash: G.flash,
    zoom: G.zoom,
    zoomAt: { x: G.zoomX, y: G.zoomY },
    blood,
    fever: feverGlow,
  };
}

function render(dt: number) {
  renderWorld(world);
  const sx = G.shake > 0.3 ? rand(-G.shake, G.shake) : 0;
  const sy = G.shake > 0.3 ? rand(-G.shake, G.shake) : 0;
  if (post) {
    post.render(worldCanvas, postParams(sx, sy, dt));
  } else if (flat) {
    const [r, g, b] = sector().palette[0];
    flat.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
    flat.fillRect(0, 0, view.W, view.H);
    flat.drawImage(worldCanvas, sx, sy, view.W, view.H);
  }
  hud.clearRect(0, 0, view.W, view.H);
  drawHud(hud, sx, sy);
}

// dev-only console handle for testing later content: ember.warp(), ember.boss(), ember.fever(), ember.G
if (import.meta.env.DEV) {
  Object.assign(window, { ember: { G, pool, meta, warp: startWarp, boss: spawnBoss, fever: () => addFever(1) } });
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
