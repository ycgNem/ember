// The HUD, drawn crisp on its own canvas above the post-processed world.

import { DEATH_HOLD, EVENTS } from './flow';
import { ANNOUNCE_LIFE } from './fx';
import { GENES, GENE_HUE, GENE_LABEL, THREAT_LABEL } from './genome';
import { drawGlow } from './glow';
import { FEVER_TIER, feverDuration } from './hype';
import { UPGRADES, meta, nextCost, type UpgradeDef } from './meta';
import { MUTATIONS, MUTATION_BY_ID, RARITY, TIERS, roman } from './mutations';
import { SECTORS } from './sectors';
import { COMBO_CAP, G, comboWindow, isDark, maxCharge, maxHp, player, pointer, pool, sector, tier, view } from './state';
import { TAU, clamp } from './util';

const DISPLAY = 'Orbitron, system-ui, sans-serif';
const UI = '"Chakra Petch", system-ui, sans-serif';

interface Rect { x: number; y: number; w: number; h: number }

let h: CanvasRenderingContext2D;
let bought: { id: string; t: number } = { id: '', t: -9 };

/** Lets the forge flash a tile when something is bought. */
export function noteBuy(id: string) {
  bought = { id, t: G.clock };
}

const inside = (r: Rect) => pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;

function text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 600, font = UI, spacing = 0) {
  h.font = `${weight} ${size}px ${font}`;
  h.textAlign = align;
  h.letterSpacing = `${spacing}px`;
  h.fillStyle = color;
  h.fillText(str, x, y);
}

function wrap(str: string, maxW: number, size: number): string[] {
  h.font = `400 ${size}px ${UI}`;
  h.letterSpacing = '0px';
  const lines: string[] = [];
  let line = '';
  for (const word of str.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (line && h.measureText(test).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function bar(x: number, y: number, w: number, ht: number, fill: number, color: string | CanvasGradient) {
  h.fillStyle = 'rgba(255,255,255,0.1)';
  h.beginPath();
  h.roundRect(x, y, w, ht, ht / 2);
  h.fill();
  if (fill <= 0) return;
  h.fillStyle = color;
  h.shadowColor = typeof color === 'string' ? color : 'rgba(255,255,255,0.6)';
  h.shadowBlur = 8;
  h.beginPath();
  h.roundRect(x, y, Math.max(ht, w * clamp(fill, 0, 1)), ht, ht / 2);
  h.fill();
  h.shadowBlur = 0;
}

/** A soft dark plate behind HUD text that sits over the playfield. */
function backing(x: number, y: number, w: number, ht: number) {
  h.fillStyle = 'rgba(3, 3, 10, 0.42)';
  h.beginPath();
  h.roundRect(x, y, w, ht, 8);
  h.fill();
}

function gem(x: number, y: number, s: number, color: string) {
  h.fillStyle = color;
  h.beginPath();
  h.moveTo(x, y - s);
  h.lineTo(x + s * 0.7, y);
  h.lineTo(x, y + s);
  h.lineTo(x - s * 0.7, y);
  h.closePath();
  h.fill();
}

function ember(x: number, y: number, s: number, filled: boolean) {
  h.beginPath();
  h.moveTo(x, y - s);
  h.bezierCurveTo(x + s * 0.95, y - s * 0.1, x + s * 0.7, y + s * 0.85, x, y + s * 0.85);
  h.bezierCurveTo(x - s * 0.7, y + s * 0.85, x - s * 0.95, y - s * 0.1, x, y - s);
  if (filled) {
    h.fillStyle = 'hsl(18, 100%, 62%)';
    h.shadowColor = 'hsl(18, 100%, 55%)';
    h.shadowBlur = 10;
    h.fill();
    h.shadowBlur = 0;
    h.fillStyle = 'hsl(45, 100%, 80%)';
    h.beginPath();
    h.arc(x, y + s * 0.3, s * 0.28, 0, TAU);
    h.fill();
  } else {
    h.strokeStyle = 'rgba(255,255,255,0.25)';
    h.lineWidth = 1.5;
    h.stroke();
  }
}

function button(r: Rect, label: string, hue: number, enabled = true) {
  const hov = enabled && inside(r);
  h.fillStyle = hov ? `hsla(${hue}, 80%, 30%, 0.75)` : 'rgba(14, 12, 28, 0.8)';
  h.strokeStyle = enabled ? `hsla(${hue}, 100%, 68%, ${hov ? 1 : 0.6})` : 'rgba(255,255,255,0.15)';
  h.lineWidth = 1.5;
  h.beginPath();
  h.roundRect(r.x, r.y, r.w, r.h, 10);
  h.fill();
  h.stroke();
  text(label, r.x + r.w / 2, r.y + r.h / 2 + 5, 12, enabled ? '#fff' : 'rgba(255,255,255,0.35)', 'center', 700, DISPLAY, 3);
}

// ---------- layout (shared with input) ----------

export function cardRects(): Rect[] {
  const { W, H } = view;
  const n = G.offer.length;
  if (W < 640) {
    const w = W - 32;
    const ht = 100;
    const gap = 10;
    const y0 = H / 2 - (n * (ht + gap) - gap) / 2 + 20;
    return G.offer.map((_, i) => ({ x: 16, y: y0 + i * (ht + gap), w, h: ht }));
  }
  const gap = 22;
  const w = Math.min(230, (W - 80 - gap * (n - 1)) / n);
  const ht = 310;
  const x0 = W / 2 - (n * (w + gap) - gap) / 2;
  return G.offer.map((_, i) => ({ x: x0 + i * (w + gap), y: H / 2 - ht / 2 + 20, w, h: ht }));
}

export function hoveredCard(): number {
  return cardRects().findIndex(inside);
}

export function rerollRect(): Rect | null {
  if (G.rerolls <= 0 || !G.offer.length) return null;
  const cards = cardRects();
  const last = cards[cards.length - 1];
  return { x: view.W / 2 - 90, y: last.y + last.h + 18, w: 180, h: 38 };
}

export function titleForgeRect(): Rect {
  return { x: view.W / 2 - 120, y: view.H / 2 + 150, w: 240, h: 42 };
}

export function deathForgeRect(): Rect {
  return { x: view.W / 2 - 120, y: view.H / 2 + 128, w: 240, h: 42 };
}

/** Short screens (landscape phones) get a compact forge: smaller title, wider grid, slimmer tiles. */
const forgeShort = () => view.H < 560;

export function forgeLayout(): { tiles: (Rect & { u: UpgradeDef })[]; back: Rect; top: number } {
  const { W, H } = view;
  const short = forgeShort();
  const cols = W < 640 ? 2 : W < 1180 && !short ? 3 : 4;
  const gap = W < 760 || short ? 10 : 14;
  const tw = Math.min(260, (W - 40 - (cols - 1) * gap) / cols);
  const rows = Math.ceil(UPGRADES.length / cols);
  const titleRoom = short ? 64 : 120;
  const backRoom = short ? 46 : 80;
  const th = clamp((H - titleRoom - backRoom - (rows - 1) * gap) / rows, 56, W < 760 ? 100 : 118);
  const gridH = rows * th + (rows - 1) * gap;
  const top = short ? titleRoom : Math.max(titleRoom, H / 2 - gridH / 2 + 20);
  const left = W / 2 - (cols * tw + (cols - 1) * gap) / 2;
  const tiles = UPGRADES.map((u, i) => ({ u, x: left + (i % cols) * (tw + gap), y: top + Math.floor(i / cols) * (th + gap), w: tw, h: th }));
  const back = short ? { x: W / 2 - 70, y: top + gridH + 8, w: 140, h: 30 } : { x: W / 2 - 80, y: top + gridH + 22, w: 160, h: 40 };
  return { tiles, back, top };
}

export { inside as pointerIn };

// ---------- evolve cards ----------

function holo(r: Rect, ry: number) {
  // a light band sweeping across legendary cards
  h.save();
  h.beginPath();
  h.roundRect(r.x, ry, r.w, r.h, 14);
  h.clip();
  const sweep = ((G.clock * 0.6) % 1.6) - 0.3;
  const sx = r.x + sweep * (r.w + r.h);
  const g = h.createLinearGradient(sx - 60, ry, sx + 60, ry + r.h * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,240,200,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  h.fillStyle = g;
  h.fillRect(r.x, ry, r.w, r.h);
  for (let k = 0; k < 6; k++) {
    const t = (G.clock * 0.5 + k * 0.37) % 1;
    const px = r.x + ((k * 97) % 100) / 100 * r.w;
    const py = ry + r.h * (1 - t);
    const s = 3 * Math.sin(t * Math.PI);
    h.fillStyle = `rgba(255, 236, 170, ${0.8 * Math.sin(t * Math.PI)})`;
    h.fillRect(px - s / 2, py - 0.5, s, 1);
    h.fillRect(px - 0.5, py - s / 2, 1, s);
  }
  h.restore();
}

function drawEvolve() {
  const { W, H } = view;
  h.fillStyle = 'rgba(3, 3, 9, 0.68)';
  h.fillRect(0, 0, W, H);
  const narrow = W < 640;
  const rects = cardRects();
  const top = rects[0].y - (narrow ? 44 : 64);
  h.shadowColor = `hsl(${G.hue}, 100%, 60%)`;
  h.shadowBlur = 26;
  text('EVOLVE', W / 2, top, narrow ? 30 : 42, `hsl(${G.hue}, 100%, 88%)`, 'center', 900, DISPLAY, 10);
  h.shadowBlur = 0;
  const how = pointer.touch ? 'tap a card' : `click or press 1-${G.offer.length}`;
  text(`choose a mutation  ·  ${how}`, W / 2, top + 26, 13, 'rgba(255,255,255,0.55)', 'center', 400);

  const hov = G.offerTime > 0.35 ? hoveredCard() : -1;
  rects.forEach((r, i) => {
    const m = MUTATION_BY_ID[G.offer[i]];
    const rarity = G.rarities[i] ?? 'common';
    const rd = RARITY[rarity];
    const have = G.levels[m.id];
    const lvl = Math.min(m.max, have + rd.levels);
    // describe the first level being gained, so a brand-new mutation explains its basics
    const descLvl = have + 1;
    const syn = !!m.requires;
    const legend = rarity === 'legendary';
    const appear = clamp(G.offerTime * 5 - i * 0.6, 0, 1);
    const ry = r.y + (1 - appear) * 24 + (hov === i ? -8 : 0);
    const edgeHue = legend ? 45 + Math.sin(G.clock * 3) * 12 : rd.hue;
    h.globalAlpha = appear;

    const bg = h.createLinearGradient(r.x, ry, r.x, ry + r.h);
    const tint = rarity === 'common' ? 'rgba(18, 16, 32, 0.94)' : `hsla(${rd.hue}, 70%, ${legend ? 16 : 13}%, 0.95)`;
    bg.addColorStop(0, tint);
    bg.addColorStop(1, 'rgba(6, 5, 14, 0.96)');
    h.fillStyle = bg;
    h.strokeStyle = rarity === 'common' ? `rgba(200, 210, 235, ${hov === i ? 0.9 : 0.4})` : `hsla(${edgeHue}, 100%, 66%, ${hov === i ? 1 : 0.8})`;
    h.lineWidth = rarity === 'common' ? 1.5 : 2.2;
    if (rarity !== 'common') {
      h.shadowColor = `hsl(${edgeHue}, 100%, 55%)`;
      h.shadowBlur = legend ? 26 : 14;
    }
    h.beginPath();
    h.roundRect(r.x, ry, r.w, r.h, 14);
    h.fill();
    h.stroke();
    h.shadowBlur = 0;
    if (legend) holo(r, ry);

    const ox = narrow ? r.x + 46 : r.x + r.w / 2;
    const oy = narrow ? ry + r.h / 2 : ry + 70;
    h.globalCompositeOperation = 'lighter';
    drawGlow(h, ox, oy, (narrow ? 34 : 54) * (legend ? 1.2 : 1), m.hue, 60);
    drawGlow(h, ox, oy, narrow ? 10 : 15, m.hue, 92);
    h.globalCompositeOperation = 'source-over';

    const tag = syn ? 'SYNERGY' : rd.label;
    const tagColor = rarity === 'common' ? 'rgba(210, 220, 240, 0.7)' : `hsl(${edgeHue}, 100%, 72%)`;
    const lvlText = have === 0 ? (lvl > 1 ? `NEW · LEVEL ${roman(lvl)}` : 'NEW') : `LEVEL ${roman(lvl)}`;
    const bonus = syn ? RARITY.legendary.bonus : rd.bonus;
    if (narrow) {
      text(m.name.toUpperCase(), r.x + 88, ry + 26, 14, '#fff', 'left', 700, DISPLAY, 1);
      text(`${tag} · ${lvlText}`, r.x + r.w - 14, ry + 26, 10, tagColor, 'right', 700, UI, 1);
      wrap(m.desc(descLvl), r.w - 104, 13).slice(0, 2).forEach((line, k) => text(line, r.x + 88, ry + 46 + k * 16, 13, 'rgba(255,255,255,0.75)', 'left', 400));
      if (bonus) text(bonus, r.x + 88, ry + r.h - 12, 11, tagColor, 'left', 600);
    } else {
      text(tag, ox, ry + 22, 10, tagColor, 'center', 700, DISPLAY, 4);
      text(m.name.toUpperCase(), ox, ry + 148, 15, '#fff', 'center', 700, DISPLAY, 1);
      text(lvlText, ox, ry + 169, 11, `hsl(${m.hue}, 100%, 74%)`, 'center', 700, UI, 3);
      wrap(m.desc(descLvl), r.w - 32, 14).forEach((line, k) => text(line, ox, ry + 198 + k * 19, 14, 'rgba(255,255,255,0.75)', 'center', 400));
      if (bonus) wrap(bonus, r.w - 28, 12).forEach((line, k) => text(line, ox, ry + r.h - 44 + k * 15, 12, tagColor, 'center', 600));
      text(`${i + 1}`, ox, ry + r.h - 10, 11, 'rgba(255,255,255,0.3)', 'center', 700, DISPLAY);
    }
  });
  h.globalAlpha = 1;
  const rr = rerollRect();
  if (rr) button(rr, `REROLL  ·  ${G.rerolls}  (R)`, 190, G.offerTime > 0.35);
}

// ---------- screens ----------

function drawTitle() {
  const { W, H } = view;
  const pulseA = 0.55 + Math.sin(G.clock * 2.5) * 0.25;
  h.shadowColor = `hsl(${G.hue}, 100%, 60%)`;
  h.shadowBlur = 36;
  text('EMBER', W / 2 + 6, H / 2 - 40, Math.min(118, W / 6.5), `hsl(${G.hue}, 100%, 90%)`, 'center', 900, DISPLAY, Math.min(14, W / 70));
  h.shadowBlur = 0;
  text('evolve.  the void evolves too.', W / 2, H / 2 + 14, Math.min(19, W / 22), 'rgba(255,255,255,0.75)', 'center', 400, UI, 2);
  text('CLICK TO BEGIN', W / 2, H / 2 + 62, 15, `rgba(255,255,255,${pulseA})`, 'center', 700, DISPLAY, 4);
  const controls = pointer.touch
    ? 'drag to drift  ·  tap a second finger to pulse'
    : 'move to drift  ·  click / space to pulse  ·  P pause  ·  M mute  ·  C calm visuals';
  text(controls, W / 2, H / 2 + 90, Math.min(13, W / 34), 'rgba(255,255,255,0.4)', 'center', 400);
  if (G.best > 0 || G.deepest > 0) {
    const deep = G.deepest > 0 ? SECTORS[(G.deepest - 1) % SECTORS.length].name : '';
    const asc = G.deepest > SECTORS.length ? ` (ascension ${roman(Math.floor((G.deepest - 1) / SECTORS.length))})` : '';
    text(`best ${G.best.toLocaleString()}${deep ? `  ·  deepest: ${deep}${asc}` : ''}`, W / 2, H / 2 + 120, 13, 'rgba(255,255,255,0.5)', 'center', 500);
  }
  const fr = titleForgeRect();
  button(fr, 'STARFORGE  (F)', 48);
  gem(fr.x + fr.w + 18, fr.y + fr.h / 2, 7, 'hsl(48, 100%, 70%)');
  text(meta.dust.toLocaleString(), fr.x + fr.w + 30, fr.y + fr.h / 2 + 5, 14, 'hsl(48, 100%, 78%)', 'left', 700, DISPLAY);
  if (pool.generation > 0) {
    const favors = pool.dominant(2).map((g) => GENE_LABEL[g]).join(' + ');
    text(`the void remembers you  ·  generation ${pool.generation}  ·  favors ${favors}`, W / 2, H - 58, Math.min(13, W / 36), 'hsla(320, 100%, 75%, 0.8)', 'center', 500);
    if (!pointer.touch) text('press R twice to make it forget', W / 2, H - 36, 11, 'rgba(255,255,255,0.35)', 'center', 400);
  }
}

/** The largest size (down to `min`) at which `str` fits in `maxW`. */
function fitSize(str: string, maxW: number, size: number, min: number, weight: number, font: string, spacing: number): number {
  for (let s = size; s > min; s -= 0.5) {
    h.font = `${weight} ${s}px ${font}`;
    h.letterSpacing = `${spacing}px`;
    if (h.measureText(str).width <= maxW) return s;
  }
  return min;
}

function drawForge() {
  const { W, H } = view;
  h.fillStyle = 'rgba(3, 3, 9, 0.88)';
  h.fillRect(0, 0, W, H);
  const { tiles, back, top } = forgeLayout();
  const short = forgeShort();
  h.shadowColor = 'hsl(45, 100%, 55%)';
  h.shadowBlur = 24;
  text('STARFORGE', W / 2, top - (short ? 34 : 58), Math.min(short ? 26 : 40, W / 14), 'hsl(45, 100%, 85%)', 'center', 900, DISPLAY, short ? 6 : 10);
  h.shadowBlur = 0;
  gem(W / 2 - 52, top - (short ? 16 : 28), 8, 'hsl(48, 100%, 70%)');
  text(`${meta.dust.toLocaleString()} stardust`, W / 2 - 38, top - (short ? 10 : 22), short ? 14 : 16, 'hsl(48, 100%, 80%)', 'left', 700, UI);

  for (const t of tiles) {
    const lvl = meta.levels[t.u.id];
    const cost = nextCost(t.u);
    const can = cost !== null && meta.dust >= cost;
    const hov = inside(t);
    const flash = bought.id === t.u.id ? clamp(1 - (G.clock - bought.t) * 2, 0, 1) : 0;
    h.fillStyle = flash > 0 ? `hsla(${t.u.hue}, 90%, ${14 + flash * 30}%, 0.95)` : hov && can ? `hsla(${t.u.hue}, 60%, 16%, 0.95)` : 'rgba(14, 12, 28, 0.92)';
    h.strokeStyle = cost === null ? 'hsla(45, 100%, 65%, 0.7)' : can ? `hsla(${t.u.hue}, 100%, 65%, ${hov ? 1 : 0.65})` : 'rgba(255,255,255,0.14)';
    h.lineWidth = hov && can ? 2 : 1.4;
    h.beginPath();
    h.roundRect(t.x, t.y, t.w, t.h, 12);
    h.fill();
    h.stroke();

    const compact = t.w < 200 || t.h < 96;
    const lit = can || cost === null ? 1 : 0.4;
    if (t.w < 200) {
      // phone-width tiles trade the glow icon for a slim accent, so long names keep their room
      h.fillStyle = `hsla(${t.u.hue}, 100%, 65%, ${0.8 * lit})`;
      h.fillRect(t.x + 6, t.y + 16, 3, 20);
    } else {
      h.globalCompositeOperation = 'lighter';
      drawGlow(h, t.x + 24, t.y + 26, compact ? 17 : 22, t.u.hue, 60, lit);
      h.globalCompositeOperation = 'source-over';
    }
    // names shrink to fit beside the level pips instead of running off the tile
    const pipsW = t.u.costs.length * 12 + 6;
    const nameX = t.x + (t.w < 200 ? 16 : compact ? 42 : 48);
    const name = t.u.name.toUpperCase();
    const nameSize = fitSize(name, t.x + t.w - 14 - pipsW - nameX, 12, 7.5, 700, DISPLAY, 1);
    text(name, nameX, t.y + 30, nameSize, '#fff', 'left', 700, DISPLAY, 1);
    for (let k = 0; k < t.u.costs.length; k++) {
      h.fillStyle = k < lvl ? `hsl(${t.u.hue}, 100%, 65%)` : 'rgba(255,255,255,0.15)';
      h.fillRect(t.x + t.w - 14 - (t.u.costs.length - k) * 12, t.y + 24, 9, 4);
    }

    // the price sits in the bottom-right corner; the description wraps around it
    const priceLabel = cost === null ? 'MAXED' : String(cost);
    h.font = `700 ${cost === null ? 11 : 13}px ${DISPLAY}`;
    h.letterSpacing = cost === null ? '2px' : '0px';
    const priceW = h.measureText(priceLabel).width + (cost === null ? 0 : 16);
    const descSize = compact ? 11 : 12;
    const lineH = compact ? 14 : 16;
    const descTop = t.y + (compact ? 50 : 56);
    const priceY = t.y + t.h - (compact ? 10 : 13);
    const maxLines = Math.max(1, Math.floor((priceY - descTop) / lineH) + 1);
    const desc = t.u.desc(cost === null ? lvl : lvl + 1);
    const lines = wrap(desc, t.w - 28, descSize);
    const shown = lines.slice(0, maxLines);
    const last = shown.length - 1;
    // the last line shares the price's row only if it clears it
    if (descTop + last * lineH > priceY - lineH + 2) {
      const room = t.w - 28 - priceW - 10;
      const tail = lines.slice(last).join(' ');
      const cut = wrap(tail, room, descSize);
      shown[last] = cut.length > 1 ? `${cut[0].replace(/[.,]$/, '')}…` : cut[0];
    }
    shown.forEach((line, k) => text(line, t.x + 14, descTop + k * lineH, descSize, 'rgba(255,255,255,0.72)', 'left', 400));
    if (cost === null) {
      text('MAXED', t.x + t.w - 14, priceY, 11, 'hsl(45, 100%, 70%)', 'right', 700, DISPLAY, 2);
    } else {
      text(priceLabel, t.x + t.w - 14, priceY, 13, can ? 'hsl(48, 100%, 78%)' : 'rgba(255,255,255,0.35)', 'right', 700, DISPLAY);
      gem(t.x + t.w - 14 - h.measureText(priceLabel).width - 10, priceY - 5, 5, can ? 'hsl(48, 100%, 70%)' : 'rgba(255,255,255,0.3)');
    }
  }
  button(back, pointer.touch ? 'BACK' : 'BACK  (ESC)', 200);
}

function drawTopLeft() {
  const lag = G.score - G.displayScore;
  const size = 30 + Math.min(10, lag / 400);
  h.shadowColor = lag > 50 ? `hsl(${G.hue}, 100%, 60%)` : 'transparent';
  h.shadowBlur = lag > 50 ? 16 : 0;
  text(Math.floor(G.displayScore).toLocaleString(), 24, 46, size, '#fff', 'left', 700, DISPLAY, 1);
  h.shadowBlur = 0;
  for (let i = 0; i < maxHp(); i++) ember(32 + i * 24, 72, 9, i < G.hp);
  if (G.combo > 1) {
    text(`x${G.combo}`, 24, 108, 20, `hsl(${G.hue}, 100%, 75%)`, 'left', 700, DISPLAY);
    if (G.combo >= COMBO_CAP) text('MAX', 28 + h.measureText(`x${G.combo}`).width, 108, 10, 'hsl(48, 100%, 70%)', 'left', 700, DISPLAY, 2);
    bar(24, 116, 70, 3, G.comboTimer / comboWindow(), `hsl(${G.hue}, 100%, 70%)`);
  }
}

function drawTopCenter() {
  const { W } = view;
  const bw = Math.min(300, W * 0.42);
  const b = G.boss;
  if (b && b.enter > 0) {
    const w = Math.min(560, W * 0.62);
    text(b.name.toUpperCase(), W / 2, 24, 13, `hsl(${b.hue}, 100%, 80%)`, 'center', 700, DISPLAY, 3);
    bar(W / 2 - w / 2, 32, w, 8, b.hp / b.maxHp, `hsl(${b.hue}, 100%, 58%)`);
    for (let i = 0; i < b.plates; i++) {
      h.fillStyle = 'hsl(275, 100%, 72%)';
      h.fillRect(W / 2 - 3 * 14 + i * 14 + 2, 46, 10, 3);
    }
  } else {
    const s = sector();
    const label = `${s.name.toUpperCase()}${G.loop ? `  ·  ASCENSION ${roman(G.loop)}` : ''}`;
    text(label, W / 2, 24, 12, `hsl(${s.hue}, 100%, 80%)`, 'center', 700, DISPLAY, 3);
    if (G.state === 'warp') {
      text('WARPING', W / 2, 44, 11, 'rgba(255,255,255,0.6)', 'center', 700, DISPLAY, 6);
    } else {
      bar(W / 2 - bw / 2, 32, bw, 4, G.sectorTime / s.duration, `hsl(${s.hue}, 100%, 65%)`);
      text('APEX', W / 2 + bw / 2 + 8, 37, 9, 'rgba(255,255,255,0.4)', 'left', 700, DISPLAY, 2);
    }
  }

  const t = tier();
  const eb = bw * 0.8;
  text(TIERS[t].name.toUpperCase(), W / 2, 68, 11, `hsl(${G.hue}, 100%, 82%)`, 'center', 700, DISPLAY, 3);
  bar(W / 2 - eb / 2, 75, eb, 5, G.essence / G.need, `hsl(${G.hue}, 100%, 68%)`);
  const next = TIERS[t + 1];
  if (next) text(`${next.name} in ${next.at - G.evolutions}`, W / 2, 94, 10, 'rgba(255,255,255,0.35)', 'center', 500);
}

function drawTopRight() {
  const { W } = view;
  // on a phone the best score would sit on top of the sector bar
  if (G.best > 0 && W >= 640) text(`best ${G.best.toLocaleString()}`, W - 20, 40, 15, 'rgba(255,255,255,0.5)', 'right', 500);
  const ev = G.event;
  if (!ev) return;
  const def = EVENTS[ev.kind];
  const hue = def.hue;
  const label = `${def.name}  ${Math.ceil(ev.time)}`;
  h.font = `700 11px ${DISPLAY}`;
  h.letterSpacing = '3px';
  const w = h.measureText(label).width + 24;
  h.fillStyle = `hsla(${hue}, 80%, 22%, 0.8)`;
  h.strokeStyle = `hsl(${hue}, 100%, 65%)`;
  h.lineWidth = 1.5;
  h.beginPath();
  const y = W < 640 ? 108 : 54;
  h.roundRect(W - 20 - w, y, w, 24, 12);
  h.fill();
  h.stroke();
  text(label, W - 20 - w / 2, y + 16, 11, `hsl(${hue}, 100%, 85%)`, 'center', 700, DISPLAY, 3);
}

function drawBottomCenter() {
  const { W, H } = view;
  const mc = maxCharge();
  for (let i = 0; i < mc; i++) {
    const fill = clamp(G.charge - i, 0, 1);
    const x = W / 2 + (i - (mc - 1) / 2) * 30;
    const y = H - 30;
    h.strokeStyle = 'rgba(255,255,255,0.3)';
    h.lineWidth = 2;
    h.beginPath();
    h.arc(x, y, 10, 0, TAU);
    h.stroke();
    if (fill <= 0) continue;
    h.fillStyle = fill >= 1 ? `hsl(${G.hue}, 100%, 70%)` : `hsla(${G.hue}, 100%, 70%, 0.35)`;
    if (fill >= 1) {
      h.shadowColor = `hsl(${G.hue}, 100%, 60%)`;
      h.shadowBlur = 10;
    }
    h.beginPath();
    h.moveTo(x, y);
    h.arc(x, y, 8, -Math.PI / 2, -Math.PI / 2 + TAU * fill);
    h.closePath();
    h.fill();
    h.shadowBlur = 0;
  }

  // fever meter
  const fw = 220;
  const fx = W / 2 - fw / 2;
  const fy = H - 58;
  const on = G.feverTime > 0;
  const g = h.createLinearGradient(fx, 0, fx + fw, 0);
  for (let k = 0; k <= 6; k++) {
    const hue = on ? (G.clock * 300 + k * 60) % 360 : 330 + k * 8;
    g.addColorStop(k / 6, `hsl(${hue}, 100%, ${on ? 62 : 58}%)`);
  }
  bar(fx, fy, fw, 6, on ? G.feverTime / feverDuration() : G.fever, g);
  const ready = !on && G.fever > 0.85;
  text(on ? `FEVER  x3` : 'FEVER', fx - 10, fy + 7, 10, on || ready ? `hsl(${(G.clock * 300) % 360}, 100%, 75%)` : 'rgba(255,255,255,0.45)', 'right', 700, DISPLAY, 2);
}

function drawPhaseArc(ox: number, oy: number) {
  if (!G.levels.phase || (G.phaseMeter >= 1 && !G.phasing)) return;
  const x = player.x + ox;
  const y = player.y + oy;
  h.strokeStyle = 'rgba(255,255,255,0.12)';
  h.lineWidth = 3;
  h.beginPath();
  h.arc(x, y, 30, 0, TAU);
  h.stroke();
  h.strokeStyle = G.phaseLocked ? 'hsl(0, 100%, 62%)' : G.phasing ? '#fff' : 'hsl(175, 100%, 65%)';
  h.beginPath();
  h.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * G.phaseMeter);
  h.stroke();
}

function drawMutationList() {
  const { W, H } = view;
  if (W < 640) return;
  const held = MUTATIONS.filter((m) => G.levels[m.id] > 0);
  const step = held.length > 14 ? 14 : 17;
  if (held.length) backing(W - 178, H - 22 - held.length * step - 2, 168, held.length * step + 14);
  let y = H - 22;
  for (let i = held.length - 1; i >= 0; i--) {
    const m = held[i];
    text(`${m.name} ${roman(G.levels[m.id])}`, W - 20, y, step > 14 ? 12 : 11, m.requires ? 'hsl(45, 100%, 70%)' : `hsl(${m.hue}, 100%, 75%)`, 'right', 600);
    y -= step;
  }
}

function drawGenomePanel() {
  const { W, H } = view;
  const avg = pool.average();
  const study = pool.topThreat();
  if (W < 640) {
    text(`VOID GEN ${pool.generation}`, W - 20, 96, 10, 'hsla(320, 100%, 75%, 0.7)', 'right', 700, DISPLAY, 1);
    return;
  }
  const x = 20;
  const y0 = H - 22 - GENES.length * 13;
  backing(x - 8, y0 - (study ? 38 : 22), 160, GENES.length * 13 + (study ? 50 : 34));
  text(`THE VOID  ·  GEN ${pool.generation}`, x, y0 - 8, 10, 'hsla(320, 100%, 78%, 0.75)', 'left', 700, DISPLAY, 2);
  if (study) {
    text(`STUDYING YOU: ${THREAT_LABEL[study.threat]} ${Math.round(study.share * 100)}%`, x, y0 - 24, 10, `hsla(${(G.clock * 40) % 30 + 340}, 100%, 70%, ${0.6 + 0.3 * Math.sin(G.clock * 3)})`, 'left', 700, UI, 1);
  }
  GENES.forEach((g, i) => {
    const y = y0 + i * 13;
    text(GENE_LABEL[g], x, y + 8, 9, 'rgba(255,255,255,0.45)', 'left', 600, UI, 1);
    h.fillStyle = 'rgba(255,255,255,0.08)';
    h.fillRect(x + 62, y + 2, 70, 6);
    h.fillStyle = `hsl(${GENE_HUE[g]}, 100%, 62%)`;
    h.fillRect(x + 62, y + 2, 70 * avg[g], 6);
  });
}

/** In the Abyss you can't see the voids, only their eyes. */
function drawEyes(ox: number, oy: number) {
  const lightR = 240 + tier() * 14;
  for (const e of G.enemies) {
    if (Math.hypot(e.x - player.x, e.y - player.y) < lightR * 0.75) continue;
    const a = 0.55 + 0.35 * Math.sin(G.clock * 3 + e.phase);
    h.fillStyle = `hsla(${e.hue}, 100%, 70%, ${a})`;
    for (const s of [-1, 1]) {
      h.beginPath();
      h.arc(e.x + ox + s * e.r * 0.28, e.y + oy - e.r * 0.1, 1.8, 0, TAU);
      h.fill();
    }
  }
}

function drawAnnounce() {
  const a = G.announce;
  if (!a) return;
  const { W, H } = view;
  const age = ANNOUNCE_LIFE - a.life;
  const pop = age < 0.15 ? 1.7 - (age / 0.15) * 0.7 : 1 + Math.max(0, 0.04 - (age - 0.15) * 0.1);
  const fever = a.tier === FEVER_TIER;
  const base = fever ? 76 : 24 + a.tier * 3.6;
  const size = Math.min(base, W / (fever ? 6 : 10)) * pop;
  const hue = fever || a.tier >= 7 ? (G.clock * 360) % 360 : a.hue;
  h.globalAlpha = clamp(a.life * 2.5, 0, 1);
  h.shadowColor = `hsl(${hue}, 100%, 55%)`;
  h.shadowBlur = 30;
  h.font = `900 ${size}px ${DISPLAY}`;
  h.letterSpacing = `${size * 0.12}px`;
  h.textAlign = 'center';
  h.lineWidth = Math.max(2, size * 0.06);
  h.strokeStyle = `hsla(${hue}, 100%, 25%, 0.9)`;
  const y = H * (fever ? 0.5 : 0.68);
  h.strokeText(a.text, W / 2, y);
  h.fillStyle = `hsl(${hue}, 100%, 86%)`;
  h.fillText(a.text, W / 2, y);
  h.shadowBlur = 0;
  if (!fever && G.streak > 1) text(`${G.streak} STREAK`, W / 2, y + size * 0.55 + 6, 12, `hsla(${hue}, 100%, 80%, 0.8)`, 'center', 700, DISPLAY, 4);
  h.globalAlpha = 1;
}

function drawDeath() {
  const { W, H } = view;
  if (G.deadTimer < 0.5) return;
  h.globalAlpha = clamp((G.deadTimer - 0.5) * 2, 0, 1);
  h.fillStyle = 'rgba(3, 3, 9, 0.5)';
  h.fillRect(0, 0, W, H);
  h.shadowColor = 'hsl(0, 100%, 50%)';
  h.shadowBlur = 24;
  text('SNUFFED OUT', W / 2, H / 2 - 118, Math.min(46, W / 10), '#fff', 'center', 900, DISPLAY, 6);
  h.shadowBlur = 0;
  text(`${G.score.toLocaleString()} points${G.score >= G.best && G.score > 0 ? '  ·  new best!' : ''}`, W / 2, H / 2 - 78, 20, `hsl(${G.hue}, 100%, 78%)`, 'center', 700);
  const s = sector();
  const n = G.evolutions;
  const where = `${s.name}${G.loop ? ` (ascension ${roman(G.loop)})` : ''}`;
  text(G.killedBy ? `taken by ${G.killedBy} in ${where}` : `fell in ${where}`, W / 2, H / 2 - 50, 15, 'hsl(8, 100%, 72%)', 'center', 600);
  const mins = Math.floor(G.time / 60);
  const secs = String(Math.floor(G.time % 60)).padStart(2, '0');
  const narrowDeath = W < 640;
  const stats = [`${mins}:${secs}`, `${G.apexes} apex${G.apexes === 1 ? '' : 'es'}`, `${G.kills} voids`, `best streak ${G.bestStreak}`, `max combo x${G.maxCombo}`];
  if (narrowDeath) {
    text(stats.slice(0, 3).join('  ·  '), W / 2, H / 2 - 24, 13, 'rgba(255,255,255,0.65)', 'center', 400);
    text(stats.slice(3).join('  ·  '), W / 2, H / 2 - 6, 13, 'rgba(255,255,255,0.65)', 'center', 400);
  } else {
    text(stats.join('  ·  '), W / 2, H / 2 - 24, 14, 'rgba(255,255,255,0.65)', 'center', 400);
  }
  text(`you fell as a ${TIERS[tier()].name.toLowerCase()} with ${n} mutation${n === 1 ? '' : 's'}`, W / 2, H / 2 + (narrowDeath ? 14 : 0), 14, 'rgba(255,255,255,0.65)', 'center', 400);
  text(`the void is now generation ${pool.generation}. it will remember this.`, W / 2, H / 2 + (narrowDeath ? 36 : 24), Math.min(13, W / 32), 'hsla(320, 100%, 75%, 0.85)', 'center', 400);

  // the stardust payout counts up
  const shown = Math.floor(G.runDust * clamp((G.deadTimer - 0.7) / 1.2, 0, 1));
  gem(W / 2 - 70, H / 2 + 62, 9, 'hsl(48, 100%, 70%)');
  text(`+${shown} stardust`, W / 2 - 54, H / 2 + 69, 20, 'hsl(48, 100%, 80%)', 'left', 700, DISPLAY);
  text(`${meta.dust.toLocaleString()} total`, W / 2, H / 2 + 94, 12, 'rgba(255,255,255,0.45)', 'center', 500);
  if (G.deadTimer > DEATH_HOLD) {
    button(deathForgeRect(), pointer.touch ? 'STARFORGE' : 'STARFORGE  (F)', 48);
    text(pointer.touch ? 'TAP ANYWHERE TO RELIGHT' : 'CLICK ANYWHERE TO RELIGHT', W / 2, H / 2 + 200, 12, 'rgba(255,255,255,0.6)', 'center', 700, DISPLAY, 4);
  }
  h.globalAlpha = 1;
}

function drawBanner() {
  const b = G.banners[0];
  if (!b) return;
  const { W, H } = view;
  h.globalAlpha = clamp(Math.min(b.life, b.maxLife - b.life) * 3, 0, 1);
  const y = H * (b.big ? 0.3 : 0.24);
  const spacing = b.big ? 8 : 4;
  // long callouts ("THE VOID EVOLVED EVASION") shrink to fit a phone instead of running off both edges
  const size = fitSize(b.text, W - 32, b.big ? 34 : 24, 11, 900, DISPLAY, spacing);
  h.shadowColor = `hsl(${b.hue}, 100%, 55%)`;
  h.shadowBlur = 22;
  text(b.text, W / 2, y, size, `hsl(${b.hue}, 100%, 84%)`, 'center', 900, DISPLAY, spacing);
  h.shadowBlur = 0;
  if (b.sub) text(b.sub, W / 2, y + 28, fitSize(b.sub, W - 32, 15, 10, 400, UI, 1), 'rgba(255,255,255,0.7)', 'center', 400, UI, 1);
  h.globalAlpha = 1;
}

function drawPause() {
  const { W, H } = view;
  h.fillStyle = 'rgba(3, 3, 9, 0.78)';
  h.fillRect(0, 0, W, H);
  const held = MUTATIONS.filter((m) => G.levels[m.id] > 0);
  const cols = W >= 900 ? 2 : 1;
  const colW = Math.min(380, (W - 48 - (cols - 1) * 24) / cols);
  const rowH = 54;
  const rows = Math.ceil(held.length / cols);
  const fit = Math.max(0, Math.floor((H - 260) / rowH));
  const shownRows = Math.min(rows, fit);
  const blockH = shownRows * rowH;
  const titleY = Math.max(70, H / 2 - blockH / 2 - 40);
  text('PAUSED', W / 2, titleY, 36, '#fff', 'center', 900, DISPLAY, 10);
  text(pointer.touch ? 'tap to resume' : 'press P or click to resume', W / 2, titleY + 30, 14, 'rgba(255,255,255,0.6)', 'center', 400);
  if (!held.length) return;
  const x0 = W / 2 - (cols * colW + (cols - 1) * 24) / 2;
  const y0 = titleY + 70;
  text('YOUR BUILD', W / 2, y0 - 12, 10, 'rgba(255,255,255,0.45)', 'center', 700, DISPLAY, 4);
  held.slice(0, shownRows * cols).forEach((m, i) => {
    const x = x0 + (i % cols) * (colW + 24);
    const y = y0 + Math.floor(i / cols) * rowH;
    const lvl = G.levels[m.id];
    h.globalCompositeOperation = 'lighter';
    drawGlow(h, x + 10, y + 14, 12, m.hue, 65);
    h.globalCompositeOperation = 'source-over';
    text(`${m.name.toUpperCase()} ${roman(lvl)}`, x + 28, y + 12, 12, m.requires ? 'hsl(45, 100%, 72%)' : `hsl(${m.hue}, 100%, 78%)`, 'left', 700, DISPLAY, 1);
    wrap(m.desc(lvl), colW - 30, 12).slice(0, 2).forEach((line, k) => text(line, x + 28, y + 29 + k * 15, 12, 'rgba(255,255,255,0.62)', 'left', 400));
  });
  if (shownRows < rows) text(`+${held.length - shownRows * cols} more`, W / 2, y0 + blockH + 8, 11, 'rgba(255,255,255,0.4)', 'center', 600);
}

function drawReticle() {
  if (!pointer.moved) return;
  h.strokeStyle = 'rgba(255,255,255,0.55)';
  h.lineWidth = 1.5;
  h.beginPath();
  h.arc(pointer.x, pointer.y, 8, 0, TAU);
  h.stroke();
  h.fillStyle = '#fff';
  h.beginPath();
  h.arc(pointer.x, pointer.y, 1.8, 0, TAU);
  h.fill();
}

export function drawHud(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  h = ctx;
  for (const p of G.popups) {
    h.globalAlpha = clamp(p.life, 0, 1);
    text(p.text, p.x + ox, p.y + oy, p.size, `hsl(${p.hue}, 100%, 75%)`, 'center', 700);
  }
  h.globalAlpha = 1;

  // the forge stands alone: whatever screen opened it would only show through as clutter
  if (G.state === 'forge') {
    drawForge();
    drawReticle();
    return;
  }
  if (G.state === 'title') {
    drawTitle();
    drawBanner();
    drawReticle();
    return;
  }
  if (isDark() && G.state !== 'warp') drawEyes(ox, oy);
  if (G.state === 'play') drawPhaseArc(ox, oy);
  drawTopLeft();
  drawTopCenter();
  drawTopRight();
  drawBottomCenter();
  drawMutationList();
  drawGenomePanel();
  // banners freeze under the card and pause overlays, so they'd sit behind those titles
  if (!G.paused) drawAnnounce();
  if (!G.paused && G.state !== 'evolve') drawBanner();
  if (G.state === 'evolve') drawEvolve();
  if (G.state === 'dead') drawDeath();
  if (G.paused) drawPause();
  drawReticle();
}
