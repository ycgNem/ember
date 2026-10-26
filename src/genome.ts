// The void evolves: every enemy carries a genome, and the ones that do best
// against the player breed the next spawns. It also studies *how* you kill it
// and breeds counters to your favorite weapons. The pool persists between runs.

import { clamp, gauss, pick, rand } from './util';

export const GENES = ['speed', 'size', 'armor', 'swarm', 'split', 'evasion', 'cloak', 'spit', 'leech', 'ward', 'pierce'] as const;
export type Gene = (typeof GENES)[number];
export type Genome = Record<Gene, number>;

/** Counter-genes are knowledge, not power: they're expressed in full regardless of the strength budget. */
const COUNTER_GENES: readonly Gene[] = ['ward', 'pierce'];

/** Pool average a gene must reach before the game announces the void "learned" it. */
export const LEARN_AT = 0.45;

export const GENE_LABEL: Record<Gene, string> = {
  speed: 'SPEED',
  size: 'MASS',
  armor: 'ARMOR',
  swarm: 'SWARM',
  split: 'MITOSIS',
  evasion: 'EVASION',
  cloak: 'CLOAK',
  spit: 'SPIT',
  leech: 'LEECH',
  ward: 'WARD',
  pierce: 'PIERCE',
};

export const GENE_HUE: Record<Gene, number> = {
  speed: 0,
  size: 335,
  armor: 270,
  swarm: 22,
  split: 300,
  evasion: 350,
  cloak: 210,
  spit: 95,
  leech: 160,
  ward: 52,
  pierce: 238,
};

export const GENE_FLAVOR: Record<Gene, string> = {
  speed: 'it learned to hunt faster',
  size: 'it grows heavier',
  armor: 'it hardened its shell',
  swarm: 'it hunts in packs now',
  split: 'it divides when struck',
  evasion: 'it learned to dodge your pulse',
  cloak: 'it learned to hide in the dark',
  spit: 'it learned to spit',
  leech: 'it feeds on your light',
  ward: 'it learned to endure your fire',
  pierce: 'it learned to strike through your phase',
};

// apex bosses are named after the genes they embody: "The Hungry Bastion"
export const GENE_ADJ: Record<Gene, string> = {
  speed: 'Swift',
  size: 'Colossal',
  armor: 'Armored',
  swarm: 'Teeming',
  split: 'Dividing',
  evasion: 'Watching',
  cloak: 'Unseen',
  spit: 'Spitting',
  leech: 'Hungry',
  ward: 'Fireproof',
  pierce: 'Piercing',
};

export const GENE_NOUN: Record<Gene, string> = {
  speed: 'Hunter',
  size: 'Titan',
  armor: 'Bastion',
  swarm: 'Hive',
  split: 'Legion',
  evasion: 'Eye',
  cloak: 'Phantom',
  spit: 'Maw',
  leech: 'Lamprey',
  ward: 'Warden',
  pierce: 'Lance',
};

/** The ways you kill the void (and slip past it), which it studies. */
export type Threat = 'fire' | 'pulse' | 'touch' | 'shard' | 'gravity' | 'phase';
const THREATS: readonly Threat[] = ['fire', 'pulse', 'touch', 'shard', 'gravity', 'phase'];

export const THREAT_LABEL: Record<Threat, string> = {
  fire: 'FIRE',
  pulse: 'PULSE',
  touch: 'CONTACT',
  shard: 'SHARDS',
  gravity: 'GRAVITY',
  phase: 'PHASE',
};

/** The gene the void reaches for when you lean on each tactic. */
const COUNTER: Record<Threat, Gene> = {
  fire: 'ward',
  pulse: 'armor',
  touch: 'armor',
  shard: 'evasion',
  gravity: 'size',
  phase: 'pierce',
};

const KEY = 'ember-void-pool';
const POOL_MAX = 16;
const DEATHS_PER_GENERATION = 6;
const ADAPT_RATE = 0.4;

interface Entry { g: Genome; fitness: number }

export function emptyGenome(): Genome {
  return { speed: 0, size: 0, armor: 0, swarm: 0, split: 0, evasion: 0, cloak: 0, spit: 0, leech: 0, ward: 0, pierce: 0 };
}

function emptyThreat(): Record<Threat, number> {
  return { fire: 0, pulse: 0, touch: 0, shard: 0, gravity: 0, phase: 0 };
}

function randomGenome(): Genome {
  const g = emptyGenome();
  for (const k of GENES) g[k] = COUNTER_GENES.includes(k) ? 0 : rand(0, 0.25);
  g[pick(GENES)] += rand(0.2, 0.45);
  return g;
}

/**
 * Scales a genotype down so its power genes sum to at most `budget`. Run time caps
 * how strong the void is; the inherited genotype decides how it spends that strength.
 */
export function express(geno: Genome, budget: number): Genome {
  let sum = 0;
  for (const k of GENES) if (!COUNTER_GENES.includes(k)) sum += geno[k];
  const s = sum > budget ? budget / sum : 1;
  const ph = emptyGenome();
  for (const k of GENES) ph[k] = COUNTER_GENES.includes(k) ? geno[k] : geno[k] * s;
  return ph;
}

function normalize(v: unknown): Genome | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const g = emptyGenome();
  let found = 0;
  for (const k of GENES) {
    const x = o[k];
    if (typeof x === 'number' && Number.isFinite(x)) {
      g[k] = clamp(x, 0, 1);
      found++;
    }
  }
  // genes added after a memory was saved simply start at zero
  return found ? g : null;
}

export class GenePool {
  private entries: Entry[] = [];
  private deaths = 0;
  private threat = emptyThreat();
  generation = 0;

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { entries?: unknown; generation?: unknown; threat?: unknown } | null;
      if (!data) return;
      if (Array.isArray(data.entries)) {
        for (const e of data.entries as { g?: unknown; fitness?: unknown }[]) {
          const g = normalize(e.g);
          if (g && typeof e.fitness === 'number') this.entries.push({ g, fitness: e.fitness });
        }
      }
      if (typeof data.generation === 'number') this.generation = data.generation;
      if (typeof data.threat === 'object' && data.threat !== null) {
        const t = data.threat as Record<string, unknown>;
        for (const k of THREATS) if (typeof t[k] === 'number') this.threat[k] = t[k] as number;
      }
    } catch { /* storage blocked or corrupt: start fresh */ }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ entries: this.entries, generation: this.generation, threat: this.threat }));
    } catch { /* storage blocked */ }
  }

  reset() {
    this.entries = [];
    this.generation = 0;
    this.deaths = 0;
    this.threat = emptyThreat();
    this.save();
  }

  record(g: Genome, fitness: number) {
    // old champions slowly fade so the void keeps adapting to how you play now
    for (const e of this.entries) e.fitness *= 0.985;
    this.entries.push({ g: { ...g }, fitness });
    this.entries.sort((a, b) => b.fitness - a.fitness);
    if (this.entries.length > POOL_MAX) this.entries.length = POOL_MAX;
    if (++this.deaths % DEATHS_PER_GENERATION === 0) this.generation++;
  }

  /** The void watches how it dies. Older observations fade as new ones arrive. */
  noteThreat(t: Threat, weight = 1) {
    for (const k of THREATS) this.threat[k] *= 0.996;
    this.threat[t] += weight;
  }

  /** What the void is currently studying, once it has seen enough to have an opinion. */
  topThreat(): { threat: Threat; share: number } | null {
    let total = 0;
    let best: Threat = THREATS[0];
    for (const k of THREATS) {
      total += this.threat[k];
      if (this.threat[k] > this.threat[best]) best = k;
    }
    return total > 3 ? { threat: best, share: this.threat[best] / total } : null;
  }

  private adaptTarget(): Gene | null {
    let total = 0;
    for (const k of THREATS) total += this.threat[k];
    if (total <= 3) return null;
    let roll = Math.random() * total;
    for (const k of THREATS) {
      roll -= this.threat[k];
      if (roll <= 0) return COUNTER[k];
    }
    return null;
  }

  breed(): Genome {
    let child: Genome;
    if (this.entries.length < 3) {
      child = randomGenome();
    } else {
      const a = this.select();
      const b = this.select();
      child = emptyGenome();
      for (const k of GENES) {
        const v = (Math.random() < 0.5 ? a[k] : b[k]) * 0.98 + gauss() * 0.08;
        child[k] = clamp(v, 0, 1);
      }
      // occasional big jump, so new strategies can appear instead of only drifting
      if (Math.random() < 0.12) {
        const k = pick(GENES);
        child[k] = clamp(child[k] + rand(0.2, 0.4), 0, 1);
      }
    }
    // directed adaptation: push toward whatever counters how you've been killing it
    if (Math.random() < ADAPT_RATE) {
      const g = this.adaptTarget();
      if (g) child[g] = clamp(child[g] + rand(0.08, 0.2), 0, 1);
    }
    return child;
  }

  /** The fittest genome the void has produced, or null before it has any memory. */
  champion(): Genome | null {
    return this.entries.length ? { ...this.entries[0].g } : null;
  }

  /** Tournament selection: the fittest of three random entries. */
  private select(): Genome {
    let best = pick(this.entries);
    for (let i = 0; i < 2; i++) {
      const e = pick(this.entries);
      if (e.fitness > best.fitness) best = e;
    }
    return best.g;
  }

  average(): Genome {
    const avg = emptyGenome();
    if (!this.entries.length) return avg;
    for (const e of this.entries) for (const k of GENES) avg[k] += e.g[k];
    for (const k of GENES) avg[k] /= this.entries.length;
    return avg;
  }

  dominant(n: number): Gene[] {
    const avg = this.average();
    return [...GENES].sort((x, y) => avg[y] - avg[x]).slice(0, n);
  }
}
