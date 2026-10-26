// Hype: kill streaks, the announcer, and FEVER mode.

import { blip, noiseHit } from './audio';
import { addShake, announce, hitstop, popup, punch, shock } from './fx';
import { up } from './meta';
import { G, maxCharge, player, scoreMult } from './state';

const STREAKS: readonly (readonly [number, string])[] = [
  [2, 'DOUBLE KILL'],
  [3, 'TRIPLE KILL'],
  [5, 'MULTI KILL'],
  [8, 'RAMPAGE'],
  [12, 'MASSACRE'],
  [18, 'UNSTOPPABLE'],
  [25, 'GODLIKE'],
  [35, 'BEYOND GODLIKE'],
  [50, 'VOID EATER'],
  [75, 'EXTINCTION EVENT'],
];
/** Seconds between kills before a streak breaks. */
const STREAK_WINDOW = 0.9;
export const FEVER_TIME = 7;
/** FEVER's length, stretched by the Starforge's Afterglow. */
export const feverDuration = () => FEVER_TIME + 1.5 * up('afterglow');
/** Announcer tier reserved for FEVER, drawn in rainbow. */
export const FEVER_TIER = 99;

export function addFever(n: number) {
  if (G.feverTime > 0 || G.state !== 'play') return;
  G.fever = Math.min(1, G.fever + n * (1 + 0.25 * up('fervor')));
  G.feverIdle = 0;
  if (G.fever >= 1) startFever();
}

function startFever() {
  G.fever = 0;
  G.feverTime = feverDuration();
  G.charge = maxCharge();
  announce('FEVER', 0, FEVER_TIER);
  hitstop(0.12);
  punch(0.09, player.x, player.y);
  G.flash = 0.4;
  shock(player.x, player.y, 650, 36, 0.8);
  addShake(14);
  blip(220, 0.9, 'sawtooth', 0.1, 4);
  noiseHit(0.3, 0.8, 1200, 'bandpass');
  [523, 659, 784, 1046, 1318].forEach((f, i) => blip(f, 0.3, 'square', 0.05, 1, i * 0.05));
}

function stinger(tier: number) {
  const base = 262 * Math.pow(2, Math.min(tier, 10) / 8);
  [1, 1.26, 1.5, 2].forEach((m, k) => blip(base * m, 0.4, 'triangle', 0.06, 1, k * 0.03));
  noiseHit(0.18 + tier * 0.02, 0.25, 3000);
}

/** Call for every scoring kill: feeds the streak, the announcer, and the fever meter. */
export function registerKill(x: number, y: number, elite: boolean) {
  G.streak++;
  G.bestStreak = Math.max(G.bestStreak, G.streak);
  G.streakTimer = STREAK_WINDOW;
  addFever(elite ? 0.15 : 0.025);
  for (let i = STREAKS.length - 1; i >= 0; i--) {
    const [n, name] = STREAKS[i];
    if (G.streak !== n) continue;
    const tier = i + 1;
    announce(name, 20 + tier * 32, tier);
    // grows with the streak alone: stacking the spark combo on top made one FEVER chain worth millions
    const bonus = 100 * tier * tier * scoreMult();
    G.score += bonus;
    popup(player.x, player.y - 48, `+${bonus}`, 50, 16 + tier);
    addFever(0.05);
    if (tier >= 3) {
      hitstop(0.035 + tier * 0.006);
      punch(0.025 + tier * 0.006, x, y);
    }
    addShake(4 + tier);
    stinger(tier);
    break;
  }
}

export function updateHype(dt: number) {
  if (G.announce) {
    G.announce.life -= dt;
    if (G.announce.life <= 0) G.announce = null;
  }
  // the world is frozen while you pick a card, so FEVER and the streak window wait too
  if (G.state === 'evolve') return;
  if (G.streakTimer > 0) {
    G.streakTimer -= dt;
    if (G.streakTimer <= 0) G.streak = 0;
  }
  if (G.feverTime > 0) {
    G.feverTime -= dt;
    if (G.feverTime <= 0) {
      G.feverTime = 0;
      blip(400, 0.6, 'sawtooth', 0.06, 0.3);
    }
  } else if (G.state === 'play') {
    G.feverIdle += dt;
    if (G.feverIdle > 3) G.fever = Math.max(0, G.fever - 0.04 * dt);
  }
}
