// Player evolution: mutations picked from cards, and the forms they add up to.

import { pick } from './util';

export type MutationId =
  | 'lasso' | 'orbitals' | 'echo' | 'corona' | 'capacitor' | 'magnet'
  | 'rebirth' | 'singularity' | 'prism' | 'predator' | 'phase'
  | 'binary' | 'overclock' | 'arc' | 'heart' | 'stasis' | 'bloom' | 'tail'
  | 'flare' | 'constellation' | 'devourer';

export interface MutationDef {
  id: MutationId;
  name: string;
  hue: number;
  max: number;
  /** Description of the level you'd be picking. */
  desc: (level: number) => string;
  /** Synergies only appear once you hold these levels of other mutations. */
  requires?: Partial<Record<MutationId, number>>;
}

export const MUTATIONS: readonly MutationDef[] = [
  { id: 'lasso', name: 'Burning Wake', hue: 22, max: 2,
    desc: (l) => l === 1 ? 'Close a loop with your trail to incinerate everything inside it' : 'Your wake burns longer, so you can draw bigger loops' },
  { id: 'orbitals', name: 'Satellites', hue: 185, max: 4,
    desc: (l) => l === 1 ? 'A mote orbits you and shreds any void it touches' : `${l} motes orbit you` },
  { id: 'echo', name: 'Echo', hue: 262, max: 2,
    desc: (l) => l === 1 ? 'A ghost retraces your path, eating sparks and voids' : 'A second ghost joins the procession' },
  { id: 'corona', name: 'Corona', hue: 45, max: 3,
    desc: (l) => `Pulse reaches ${l * 30}% farther and hurls survivors away` },
  { id: 'capacitor', name: 'Capacitor', hue: 158, max: 2,
    desc: (l) => `Hold ${3 + l} pulse charges. Sparks charge you faster` },
  { id: 'magnet', name: 'Gravity', hue: 210, max: 3,
    desc: (l) => l === 1 ? 'Sparks drift toward you' : 'Sparks drift toward you from even farther' },
  { id: 'rebirth', name: 'Second Sun', hue: 38, max: 1,
    desc: () => 'Cheat death once. You burst into a nova and relight at full strength' },
  { id: 'singularity', name: 'Singularity', hue: 280, max: 2,
    desc: (l) => l === 1 ? 'Each pulse leaves a black hole that devours voids' : 'Black holes last longer and pull harder' },
  { id: 'prism', name: 'Prism', hue: 300, max: 2,
    desc: (l) => `Every spark you eat fires ${1 + l * 2} homing shards` },
  { id: 'predator', name: 'Predator', hue: 352, max: 2,
    desc: (l) => l === 1 ? 'Slain voids shed essence motes' : 'Slain voids shed twice as many motes' },
  { id: 'phase', name: 'Phase', hue: 175, max: 2,
    desc: (l) => l === 1 ? 'Move fast enough and nothing can touch you' : 'Phase kicks in at a lower speed' },
  { id: 'binary', name: 'Binary Star', hue: 205, max: 2,
    desc: (l) => l === 1 ? 'A mirrored twin moves opposite you, eating sparks and voids' : 'Your twin pulses whenever you do' },
  { id: 'overclock', name: 'Overclock', hue: 140, max: 2,
    desc: (l) => `Regain a pulse charge every ${l === 1 ? 9 : 6} seconds` },
  { id: 'arc', name: 'Arc', hue: 195, max: 2,
    desc: (l) => `Pulses chain lightning through ${l * 2} more voids` },
  { id: 'heart', name: 'Ember Heart', hue: 8, max: 2,
    desc: () => 'One more ember of life, and heal one now' },
  { id: 'stasis', name: 'Stasis', hue: 215, max: 2,
    desc: (l) => l === 1 ? 'Voids and spit near you slow to half speed' : 'The stasis field grows wider and colder' },
  { id: 'bloom', name: 'Bloom', hue: 50, max: 2,
    desc: (l) => l === 1 ? 'Every spark you eat bursts in a small shockwave' : 'Spark bursts grow larger' },
  { id: 'tail', name: 'Comet Tail', hue: 28, max: 2,
    desc: (l) => l === 1 ? 'Your fresh trail scorches any void it touches' : 'Your scorching trail lasts longer' },
  { id: 'flare', name: 'Solar Flare', hue: 40, max: 1, requires: { lasso: 1, corona: 2 },
    desc: () => 'Closing a loop also detonates a free pulse at its heart' },
  { id: 'constellation', name: 'Constellation', hue: 190, max: 1, requires: { orbitals: 3, prism: 1 },
    desc: () => 'Your satellites fire homing shards on their own' },
  { id: 'devourer', name: 'Devourer', hue: 285, max: 1, requires: { singularity: 1, predator: 1 },
    desc: () => 'Black holes last longer, and every 10 voids they eat restores an ember' },
];

export const MUTATION_BY_ID = Object.fromEntries(MUTATIONS.map((m) => [m.id, m])) as Record<MutationId, MutationDef>;

export type Levels = Record<MutationId, number>;

export function emptyLevels(): Levels {
  return Object.fromEntries(MUTATIONS.map((m) => [m.id, 0])) as Levels;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n: number) => ROMAN[n] || String(n);

export interface Tier { name: string; at: number; hue: number }

/** Forms the wisp passes through, by number of mutations taken. */
export const TIERS: readonly Tier[] = [
  { name: 'Mote', at: 0, hue: 190 },
  { name: 'Wisp', at: 1, hue: 172 },
  { name: 'Flame', at: 2, hue: 24 },
  { name: 'Comet', at: 4, hue: 200 },
  { name: 'Star', at: 6, hue: 48 },
  { name: 'Nova', at: 8, hue: 312 },
  { name: 'Singularity', at: 10, hue: 268 },
];

export function tierFor(evolutions: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (evolutions >= TIERS[i].at) t = i;
  return t;
}

function meets(req: Partial<Record<MutationId, number>>, levels: Levels) {
  return Object.entries(req).every(([id, n]) => levels[id as MutationId] >= (n ?? 0));
}

export function rollOffer(levels: Levels, first: boolean, count = 3): MutationId[] {
  const offer: MutationId[] = [];
  const synergies = MUTATIONS.filter((m) => m.requires && levels[m.id] < m.max && meets(m.requires, levels));
  if (synergies.length) offer.push(pick(synergies).id);
  const open = MUTATIONS.filter((m) => !m.requires && levels[m.id] < m.max).map((m) => m.id);
  // the first evolution always offers the wake, it's the most fun one to discover
  if (first && open.includes('lasso')) offer.push('lasso');
  const rest = open.filter((id) => !offer.includes(id)).sort(() => Math.random() - 0.5);
  while (offer.length < count && rest.length) offer.push(rest.pop() as MutationId);
  return offer.sort(() => Math.random() - 0.5);
}

// ---------- card rarity ----------

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface RarityDef {
  label: string;
  hue: number;
  /** Levels of the mutation the card grants. */
  levels: number;
  /** Extra reward, spelled out on the card. */
  bonus: string;
}

export const RARITY: Record<Rarity, RarityDef> = {
  common: { label: 'COMMON', hue: 220, levels: 1, bonus: '' },
  rare: { label: 'RARE', hue: 198, levels: 1, bonus: '+ refills every pulse charge' },
  epic: { label: 'EPIC', hue: 285, levels: 2, bonus: '+ two levels at once' },
  legendary: { label: 'LEGENDARY', hue: 45, levels: 2, bonus: '+ two levels, full heal, and a nova' },
};

const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const rarityRank = (r: Rarity) => RARITY_ORDER.indexOf(r);

/** Luck (0-3, from the Starforge) shifts weight from common toward the rarer tiers. */
export function rollRarity(luck: number, floor: Rarity = 'common'): Rarity {
  const weights = [60 - luck * 10, 27 + luck * 4, 10 + luck * 4, 3 + luck * 2];
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  let r = 0;
  while (r < weights.length - 1 && (roll -= weights[r]) > 0) r++;
  return RARITY_ORDER[Math.max(r, rarityRank(floor))];
}
