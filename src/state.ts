// Shared game state. Systems read and write through G so the modules stay decoupled.

import { GenePool, type Gene, type Genome } from './genome';
import { up } from './meta';
import { emptyLevels, tierFor, type Levels, type MutationId, type Rarity } from './mutations';
import { SECTORS, type SectorDef } from './sectors';
import { segmentDistance, type Pt } from './util';

export type GameState = 'title' | 'forge' | 'play' | 'evolve' | 'warp' | 'dead';
export type RingKind = 'pulse' | 'bloom' | 'flare' | 'echo' | 'nova' | 'fever';
export type BossMove = 'idle' | 'aim' | 'dash' | 'slam' | 'summon' | 'barrage' | 'vanish' | 'tether';
export type SparkKind = 'spark' | 'mote' | 'gold';
export type EventKind = 'starfall' | 'bloodmoon' | 'goldrush' | 'eclipse' | 'storm';

export const WARP_TIME = 3;

export interface TimedPt extends Pt { t: number }
export interface Dust { x: number; y: number; vx: number; vy: number; z: number }
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; hue: number;
  kind: 'glow' | 'streak' | 'shard'; rot: number; spin: number;
}
/** `age` only advances while the run is live, so motes don't fade away behind the card screen. */
export interface Spark { x: number; y: number; vy: number; phase: number; born: number; age: number; kind: SparkKind }
export interface Enemy {
  x: number; y: number; vx: number; vy: number; r: number; phase: number; hue: number;
  geno: Genome; ph: Genome; shells: number; born: number; minDist: number; hitCd: number;
  fireCd: number; drained: number; dealt: number; leeching: boolean;
  /** Fireproof: survives one Burning Wake loop (the ward breaks instead). */
  warded: boolean;
  /** Strikes through Phase. */
  pierce: boolean;
  /** Already counted as a phase-dodge for the void's threat model. */
  dodged: boolean;
  elite: boolean; dead: boolean; recorded: boolean;
}
export interface Bullet { x: number; y: number; vx: number; vy: number; life: number; r: number; hue: number; owner: Enemy | null; dead: boolean }
export interface Ring { x: number; y: number; r: number; maxR: number; kind: RingKind; hue: number; hit: Set<object> }
export interface Well { x: number; y: number; life: number; maxLife: number }
export interface Shard { x: number; y: number; vx: number; vy: number; life: number }
export interface Loop { poly: Pt[]; life: number; resisted: boolean }
export interface Bolt { pts: Pt[]; life: number }
export interface Popup { x: number; y: number; text: string; life: number; hue: number; size: number }
export interface Banner { text: string; sub: string; life: number; maxLife: number; hue: number; big: boolean }
/** The big centre-screen kill-streak callout. Tier 99 is FEVER. */
export interface Announce { text: string; life: number; hue: number; tier: number }
/** Purely visual: a ripple the post-processing shader refracts the screen through. */
export interface Shock { x: number; y: number; r: number; speed: number; strength: number; life: number; maxLife: number }
export interface Jelly { x: number; y: number; vx: number; vy: number; r: number; phase: number; hue: number; dead: boolean }
export interface Rift { x: number; y: number; angle: number; t: number; hit: Set<object> }
export interface GameEvent { kind: EventKind; time: number; maxTime: number }

export interface Boss {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxHp: number; phase: number; hue: number;
  genes: Gene[]; geno: Genome; name: string;
  move: BossMove; moveTime: number; cd: number; volleys: number;
  aimX: number; aimY: number;
  plates: number; plateRegen: number;
  hitCd: number; flash: number; blinkCd: number;
  /** 0..1 while it descends onto the field; invulnerable until 1. */
  enter: number;
  /** HP fractions at which a Legion apex sheds elites. */
  splitAt: number[];
  /** Seconds into its death throes, 0 while alive. */
  dying: number;
  alpha: number;
  /** Below a third of its health it fights faster and meaner. */
  enraged: boolean;
}

export interface Game {
  state: GameState;
  paused: boolean;
  time: number;        // run time
  clock: number;       // page time
  sectorTime: number;
  slowmo: number;
  hitstop: number;
  zoom: number;
  zoomX: number;
  zoomY: number;
  score: number;
  displayScore: number;
  combo: number;
  comboTimer: number;
  streak: number;
  streakTimer: number;
  announce: Announce | null;
  fever: number;
  feverTime: number;
  feverIdle: number;
  charge: number;
  hp: number;
  phaseMeter: number;
  phaseLocked: boolean;
  wakeCooldown: number;
  shake: number;
  hurtFlash: number;
  flash: number;
  deadTimer: number;
  spawnTimer: number;
  eliteTimer: number;
  warpTime: number;
  hue: number;
  essence: number;
  need: number;
  evolutions: number;
  levels: Levels;
  offer: MutationId[];
  rarities: Rarity[];
  rarityFloor: Rarity;
  rerolls: number;
  offerTime: number;
  sector: number;
  loop: number;
  apexes: number;
  kills: number;
  bossSpawned: boolean;
  event: GameEvent | null;
  eventAt: number;
  eventDone: boolean;
  overclock: number;
  constellation: number;
  devoured: number;
  riftTimer: number;
  phasing: boolean;
  learned: Set<Gene>;
  /** One-shot mutations already used up this run (a spent Second Sun isn't offered again). */
  spent: Set<MutationId>;
  stormTimer: number;
  /** What landed the killing blow, for the death screen. */
  killedBy: string;
  bestStreak: number;
  maxCombo: number;
  /** Reduced flashing, shake and zoom punches. */
  calm: boolean;
  /** Until this clock time, a second R press makes the void forget you. */
  forgetUntil: number;
  boss: Boss | null;
  echoes: Pt[];
  orbiters: Pt[];
  mirror: Pt | null;
  dust: Dust[];
  particles: Particle[];
  sparks: Spark[];
  enemies: Enemy[];
  spawnQueue: Enemy[];
  bullets: Bullet[];
  rings: Ring[];
  wells: Well[];
  shards: Shard[];
  loops: Loop[];
  bolts: Bolt[];
  popups: Popup[];
  banners: Banner[];
  shocks: Shock[];
  jellies: Jelly[];
  rifts: Rift[];
  best: number;
  deepest: number;
  runDust: number;
  forgeFrom: 'title' | 'dead';
}

export const view = { W: 0, H: 0 };
/** `touch` is true once the player steers with a finger (or on a touch-first device), for the on-screen hints. */
export const pointer = { x: 0, y: 0, moved: false, touch: false };
/** `px, py` is where the wisp was last frame: hits are tested along the whole stretch it covered. */
export const player = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0, invuln: 0 };
export const wake: TimedPt[] = [];     // spatially sampled trail: drawn, and closes loops for Burning Wake
export const history: TimedPt[] = [];  // per-frame positions, replayed by Echo ghosts
export const pool = new GenePool();

/** Sparks needed for the next evolution: 6, 9, 13, 18, 23, 29, 35... */
export function essenceNeeded(evolved: number) {
  return Math.round(6 + evolved * 3 + evolved * evolved * 0.3);
}

function stored(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}
export function store(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch { /* storage blocked */ }
}

export const G: Game = {
  state: 'title',
  paused: false,
  time: 0,
  clock: 0,
  sectorTime: 0,
  slowmo: 0,
  hitstop: 0,
  zoom: 0,
  zoomX: 0,
  zoomY: 0,
  score: 0,
  displayScore: 0,
  combo: 0,
  comboTimer: 0,
  streak: 0,
  streakTimer: 0,
  announce: null,
  fever: 0,
  feverTime: 0,
  feverIdle: 0,
  charge: 1,
  hp: 3,
  phaseMeter: 1,
  phaseLocked: false,
  wakeCooldown: 0,
  shake: 0,
  hurtFlash: 0,
  flash: 0,
  deadTimer: 0,
  spawnTimer: 0,
  eliteTimer: 30,
  warpTime: 0,
  hue: 190,
  essence: 0,
  need: essenceNeeded(0),
  evolutions: 0,
  levels: emptyLevels(),
  offer: [],
  rarities: [],
  rarityFloor: 'common',
  rerolls: 0,
  offerTime: 0,
  sector: 0,
  loop: 0,
  apexes: 0,
  kills: 0,
  bossSpawned: false,
  event: null,
  eventAt: 30,
  eventDone: false,
  overclock: 0,
  constellation: 0,
  devoured: 0,
  riftTimer: 3,
  phasing: false,
  learned: new Set(),
  spent: new Set(),
  stormTimer: 0,
  killedBy: '',
  bestStreak: 0,
  maxCombo: 0,
  calm: stored('ember-calm') === 1,
  forgetUntil: 0,
  boss: null,
  echoes: [],
  orbiters: [],
  mirror: null,
  dust: [],
  particles: [],
  sparks: [],
  enemies: [],
  spawnQueue: [],
  bullets: [],
  rings: [],
  wells: [],
  shards: [],
  loops: [],
  bolts: [],
  popups: [],
  banners: [],
  shocks: [],
  jellies: [],
  rifts: [],
  best: stored('ember-best'),
  deepest: stored('ember-deepest'),
  runDust: 0,
  forgeFrom: 'title',
};

export const tier = () => tierFor(G.evolutions);
/** How close `p` came to the wisp this frame, so a fast flick can't skip clean through something. */
export const sweptDist = (p: Pt) => segmentDistance(p, { x: player.px, y: player.py }, player);
/** The combo keeps counting, but its score multiplier tops out here. */
export const COMBO_CAP = 50;
export const comboMult = () => Math.max(1, Math.min(G.combo, COMBO_CAP));
/** Seconds between sparks before the combo breaks. */
export const comboWindow = () => 2.2 + 0.8 * G.levels.kindle;
export const maxCharge = () => 3 + G.levels.capacitor;
export const maxHp = () => 3 + G.levels.heart + up('embers');
export const playerRadius = () => 7 + tier() * 0.5;
export const wakeLife = () => Math.max([0.45, 1.3, 2.2][G.levels.lasso], tier() >= 3 ? 0.8 : 0, [0, 0.6, 0.9][G.levels.tail]);
export const tailLife = () => [0, 0.4, 0.7][G.levels.tail];
/** Cooldown after a loop burns before the wake can close another one. */
export const wakeCooldownTime = () => [0, 1.6, 1.1][G.levels.lasso];
export const phaseSpeed = () => [Infinity, 1250, 1000][G.levels.phase];
/** Seconds of continuous phasing a full meter buys. */
export const phaseDuration = () => [1, 0.7, 1.0][G.levels.phase];
export const stasisRadius = () => (G.levels.stasis ? 110 + 50 * G.levels.stasis : 0);
export const stasisFactor = () => [1, 0.55, 0.4][G.levels.stasis];
export const sector = (): SectorDef => SECTORS[G.sector];
/** The Abyss, or an Eclipse anywhere else: you only see what your own light reaches. */
export const isDark = () => sector().hazard === 'dark' || G.event?.kind === 'eclipse';
export const feverOn = () => G.feverTime > 0;
export const scoreMult = () => (G.feverTime > 0 ? 3 : 1) * (G.event?.kind === 'bloodmoon' ? 2 : 1);
export const essenceMult = () => 1 + 0.15 * up('kindling');
/** Total gene strength a void may express: grows with run time, depth, and ascension. */
export const budget = () => Math.min(4.5 + G.loop, 0.8 + G.time / 35 + G.sector * 0.35 + G.loop * 1.2);
