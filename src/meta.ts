// The Starforge: permanent upgrades bought with stardust earned across runs.

export type UpgradeId = 'embers' | 'charge' | 'kindling' | 'lodestone' | 'foresight' | 'reroll' | 'headstart' | 'fervor' | 'luck';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  hue: number;
  /** Cost of each level; the upgrade maxes out after the last one. */
  costs: readonly number[];
  /** The effect at a given level. */
  desc: (level: number) => string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'embers', name: 'Ember Core', hue: 18, costs: [200, 500],
    desc: (l) => `Start every run with ${3 + l} embers` },
  { id: 'charge', name: 'Capacitance', hue: 158, costs: [120, 320],
    desc: (l) => `Start with ${1 + l} pulse charges` },
  { id: 'kindling', name: 'Kindling', hue: 40, costs: [150, 320, 600],
    desc: (l) => `Sparks give ${15 * l}% more essence` },
  { id: 'lodestone', name: 'Lodestone', hue: 210, costs: [100, 240, 450],
    desc: (l) => `Sparks drift to you from ${70 * l}px away` },
  { id: 'foresight', name: 'Foresight', hue: 262, costs: [650],
    desc: () => 'Choose from four mutation cards instead of three' },
  { id: 'reroll', name: 'Second Thoughts', hue: 190, costs: [180, 380, 650],
    desc: (l) => `${l} card reroll${l === 1 ? '' : 's'} per run` },
  { id: 'headstart', name: 'Head Start', hue: 300, costs: [450, 1000],
    desc: (l) => `Begin each run with ${l} random mutation${l === 1 ? '' : 's'}` },
  { id: 'fervor', name: 'Fervor', hue: 330, costs: [220, 480],
    desc: (l) => `Fever fills ${25 * l}% faster` },
  { id: 'luck', name: 'Stellar Luck', hue: 50, costs: [260, 550, 950],
    desc: (l) => `Rare, epic and legendary cards appear more often (${l}/3)` },
];

type Levels = Record<UpgradeId, number>;

const KEY = 'ember-meta';

function zero(): Levels {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Levels;
}

function load(): { dust: number; levels: Levels } {
  const state = { dust: 0, levels: zero() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return state;
    const data = JSON.parse(raw) as { dust?: unknown; levels?: unknown } | null;
    if (typeof data?.dust === 'number') state.dust = Math.max(0, Math.floor(data.dust));
    if (typeof data?.levels === 'object' && data.levels !== null) {
      const lv = data.levels as Record<string, unknown>;
      for (const u of UPGRADES) {
        const v = lv[u.id];
        if (typeof v === 'number') state.levels[u.id] = Math.max(0, Math.min(u.costs.length, Math.floor(v)));
      }
    }
  } catch { /* storage blocked or corrupt: start fresh */ }
  return state;
}

export const meta = load();

export function saveMeta() {
  try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch { /* storage blocked */ }
}

export const up = (id: UpgradeId) => meta.levels[id];

/** Cost of the next level, or null once maxed. */
export function nextCost(u: UpgradeDef): number | null {
  const l = meta.levels[u.id];
  return l < u.costs.length ? u.costs[l] : null;
}

export function buy(u: UpgradeDef): boolean {
  const cost = nextCost(u);
  if (cost === null || meta.dust < cost) return false;
  meta.dust -= cost;
  meta.levels[u.id]++;
  saveMeta();
  return true;
}

/** Stardust a run earns: score, apexes slain, how deep you got, and how many voids fell. */
export function dustFor(score: number, apexes: number, depth: number, kills: number) {
  return Math.floor(score / 150 + apexes * 60 + depth * 25 + kills / 8);
}
