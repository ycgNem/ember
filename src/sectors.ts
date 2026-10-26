// The voyage: each sector has its own sky, its own hazard, and ends with an apex.

export type Hazard = 'none' | 'jellies' | 'rifts' | 'dark' | 'gravity';
export type Rgb = readonly [number, number, number];

export interface SectorDef {
  name: string;
  subtitle: string;
  /** Accent for dust and UI. */
  hue: number;
  /** Nebula colors for the background shader: base, main cloud, secondary wisps. */
  palette: readonly [Rgb, Rgb, Rgb];
  hazard: Hazard;
  /** Seconds before the apex arrives. */
  duration: number;
  /** Root note of the ambient drone, in Hz. */
  root: number;
}

export const SECTORS: readonly SectorDef[] = [
  { name: 'The Shallows', subtitle: 'where every light begins', hue: 190,
    palette: [[0.01, 0.025, 0.06], [0.0, 0.32, 0.42], [0.25, 0.08, 0.45]], hazard: 'none', duration: 70, root: 55 },
  { name: 'Ember Reef', subtitle: 'the drifting things sting', hue: 18,
    palette: [[0.05, 0.012, 0.025], [0.55, 0.16, 0.04], [0.45, 0.04, 0.28]], hazard: 'jellies', duration: 75, root: 49 },
  { name: 'The Rift', subtitle: 'space here is torn open', hue: 290,
    palette: [[0.025, 0.008, 0.05], [0.32, 0.04, 0.5], [0.04, 0.26, 0.55]], hazard: 'rifts', duration: 80, root: 46.25 },
  { name: 'The Abyss', subtitle: 'bring your own light', hue: 215,
    palette: [[0.0, 0.004, 0.012], [0.02, 0.07, 0.2], [0.1, 0.02, 0.14]], hazard: 'dark', duration: 80, root: 41.2 },
  { name: 'Event Horizon', subtitle: 'everything falls inward', hue: 38,
    palette: [[0.035, 0.015, 0.0], [0.6, 0.3, 0.04], [0.38, 0.04, 0.22]], hazard: 'gravity', duration: 85, root: 36.7 },
];
