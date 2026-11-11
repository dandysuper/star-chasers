/**
 * Exploration planets: what the surface looks like, which samples lie on it,
 * and the sample-collection tasks a walk has to finish.
 *
 * Pure data plus the task maths, so the rules can be checked without Phaser.
 * Every `art` key names an optional dedicated texture listed in reqassets.md;
 * until that file lands the scene draws the `frame` fallback, tinted.
 */

export type PlanetId = 'moon' | 'mars';

export interface SampleDef {
  /** i18n: `sample.<id>` (name) and `fact.<id>` (one-line fact). */
  id: string;
  /** Fallback frame in the `resources` atlas. */
  frame: string;
  /** Multiplied over the fallback frame so a reused icon reads as new rock. */
  tint?: number;
  /** Dedicated texture key, used when it is loaded. */
  art?: string;
  /** How long the drill takes on this sample, ms. */
  drillMs: number;
}

export type TaskKind = 'collect' | 'any' | 'distinct';

export interface TaskDef {
  id: string;
  /** i18n key; receives `{n}` (target count) and `{sample}` (sample name). */
  labelKey: string;
  /** collect: `count` of one `sample` · any: `count` samples of any type ·
   *  distinct: `count` different sample types. */
  kind: TaskKind;
  sample?: string;
  count: number;
  /** Required tasks gate the transmit; the rest are bonus (a star). */
  required: boolean;
}

export interface TileArt {
  frame: string;
  tint?: number;
  art?: string;
}

export interface PlanetDef {
  id: PlanetId;
  nameKey: string;
  /** Surface gravity, m/s² — shown on the HUD and used for the walk feel. */
  gravity: number;
  walkSpeed: number;
  /** Camera background and the solid ground drawn under the tiles. */
  sky: number;
  soil: number;
  ground: TileArt;
  /** A second tile mixed into the ground at `patchChance`. */
  patch: TileArt;
  patchChance: number;
  rocks: string[];
  rockTint?: number;
  decor: string[];
  decorTint?: number;
  /** Dedicated lander texture key (falls back to the launch pad machine). */
  landerArt?: string;
  /** Drifting dust in the air (Mars). */
  dust: boolean;
  samples: SampleDef[];
  /** How many of each sample id are scattered on the map. */
  spawns: Record<string, number>;
  tasks: TaskDef[];
  /** Transmit within this many seconds for the time star. */
  timeLimit: number;
  hintKeys: string[];
  /** How the parked rover drives here, and the marks it and the boots leave. */
  rover: RoverTuning;
  surface: SurfaceLook;
}

/** Rover handling per planet (px, px/s, px/s², rad/s, s). */
export interface RoverTuning {
  maxSpeed: number;
  accel: number;
  /** Deceleration with the stick released: low grip in low gravity. */
  coast: number;
  brake: number;
  turnRate: number;
  /** Tint over the fallback rover sprite. */
  tint?: number;
  dustTint: number;
  trackTint: number;
  /** Pull on the kicked-up dust: weak on the Moon, so it flies in long arcs. */
  dustGravity: number;
  /** Seconds a tyre track stays on the ground. */
  trackLife: number;
}

/** Drawn ground detail over the painted tiles. */
export interface SurfaceLook {
  /** Large soft light/dark patches that break up the tile repeat. */
  blotchDark: number;
  blotchLight: number;
  craters: number;
  craterBowl: number;
  craterRim: number;
  /** Mars: wind ripples drawn as soft arcs. */
  ripples: number;
  rippleColor: number;
  /** Boot prints: tint and how long they last (Moon prints last for ages). */
  bootTint: number;
  bootLife: number;
  /** Colour the screen edges are darkened toward. */
  vignette: number;
  vignetteAlpha: number;
}

const MOON_SAMPLES: SampleDef[] = [
  { id: 'ice_cube_bug', frame: 'resources_ice_cube_bug', art: 'sample_moon_ice', drillMs: 1500 },
  { id: 'magma_rock', frame: 'resources_magma_rock', art: 'sample_moon_basalt', drillMs: 1500 },
  { id: 'purple_crystal', frame: 'resources_purple_crystal', art: 'sample_moon_crystal', drillMs: 1500 },
  { id: 'iron_ore', frame: 'resources_iron_ore', art: 'sample_moon_iron', drillMs: 1500 },
  { id: 'gold_nugget', frame: 'resources_gold_nugget', art: 'sample_moon_gold', drillMs: 1500 },
];

const MARS_SAMPLES: SampleDef[] = [
  { id: 'mars_hematite', frame: 'resources_iron_ore', tint: 0xb0503c, art: 'sample_mars_hematite', drillMs: 1500 },
  { id: 'mars_mudstone', frame: 'resources_bone_shell', tint: 0xd09a6a, art: 'sample_mars_mudstone', drillMs: 2200 },
  { id: 'mars_ice', frame: 'resources_ice_cube_bug', tint: 0xf2f6ff, art: 'sample_mars_ice', drillMs: 1800 },
  { id: 'mars_basalt', frame: 'resources_magma_rock', tint: 0x6a5552, art: 'sample_mars_basalt', drillMs: 1500 },
  { id: 'mars_salt', frame: 'resources_purple_crystal', tint: 0xfbe8dc, art: 'sample_mars_salt', drillMs: 1500 },
];

export const PLANETS: Record<PlanetId, PlanetDef> = {
  moon: {
    id: 'moon',
    nameKey: 'planet.moon',
    gravity: 1.62,
    walkSpeed: 160,
    sky: 0x1a1a2e,
    soil: 0x3a3040,
    ground: { frame: 'terrain_crater_64', art: 'ground_moon' },
    patch: { frame: 'terrain_ice_64' },
    patchChance: 0.12,
    rocks: ['terrain_crater_rock', 'terrain_crystal_rock', 'terrain_fossil_rock'],
    decor: ['terrain_crater_dirt', 'terrain_ice_cracked', 'terrain_alien_grass_eyes', 'terrain_crater_rock'],
    landerArt: 'lander_moon',
    dust: false,
    samples: MOON_SAMPLES,
    spawns: { ice_cube_bug: 3, magma_rock: 2, purple_crystal: 2, iron_ore: 2, gold_nugget: 1 },
    tasks: [
      { id: 'moon_ice', labelKey: 'task.collect', kind: 'collect', sample: 'ice_cube_bug', count: 2, required: true },
      { id: 'moon_basalt', labelKey: 'task.collect', kind: 'collect', sample: 'magma_rock', count: 1, required: true },
      { id: 'moon_any', labelKey: 'task.any', kind: 'any', count: 4, required: true },
      { id: 'moon_all', labelKey: 'task.distinct', kind: 'distinct', count: 5, required: false },
    ],
    timeLimit: 150,
    hintKeys: ['hint.explore.1', 'hint.explore.2', 'hint.explore.3', 'hint.moon.ice', 'hint.explore.rover'],
    rover: {
      maxSpeed: 390, accel: 380, coast: 110, brake: 520, turnRate: 3.4,
      tint: 0xe4e8f4, dustTint: 0xc9ccd6, trackTint: 0x2a2833, dustGravity: 55, trackLife: 70,
    },
    surface: {
      blotchDark: 0x1d1b2e, blotchLight: 0xffffff,
      craters: 22, craterBowl: 0x23212f, craterRim: 0xe8e8f0,
      ripples: 0, rippleColor: 0x000000,
      bootTint: 0x24222e, bootLife: 90,
      vignette: 0x05040c, vignetteAlpha: 0.55,
    },
  },
  mars: {
    id: 'mars',
    nameKey: 'planet.mars',
    gravity: 3.71,
    walkSpeed: 150,
    sky: 0x2a1410,
    soil: 0x7a3a22,
    ground: { frame: 'terrain_sand_64', tint: 0xe0835a, art: 'ground_mars' },
    patch: { frame: 'terrain_sand_64', tint: 0xc4643f, art: 'ground_mars_rock' },
    patchChance: 0.18,
    rocks: ['terrain_crater_rock', 'terrain_fossil_rock', 'terrain_crystal_rock'],
    rockTint: 0xd2765a,
    decor: ['terrain_crater_dirt', 'terrain_crater_rock'],
    decorTint: 0xd88a66,
    landerArt: 'lander_mars',
    dust: true,
    samples: MARS_SAMPLES,
    spawns: { mars_hematite: 3, mars_mudstone: 2, mars_ice: 2, mars_basalt: 2, mars_salt: 1 },
    tasks: [
      { id: 'mars_hematite', labelKey: 'task.collect', kind: 'collect', sample: 'mars_hematite', count: 2, required: true },
      { id: 'mars_mudstone', labelKey: 'task.collect', kind: 'collect', sample: 'mars_mudstone', count: 1, required: true },
      { id: 'mars_ice', labelKey: 'task.collect', kind: 'collect', sample: 'mars_ice', count: 1, required: true },
      { id: 'mars_all', labelKey: 'task.distinct', kind: 'distinct', count: 5, required: false },
    ],
    timeLimit: 200,
    hintKeys: ['hint.explore.1', 'hint.explore.2', 'hint.explore.3', 'hint.mars.mudstone', 'hint.mars.dust', 'hint.explore.rover'],
    rover: {
      maxSpeed: 350, accel: 420, coast: 220, brake: 560, turnRate: 3.6,
      tint: 0xf0c8b0, dustTint: 0xd98a5e, trackTint: 0x4a1d10, dustGravity: 130, trackLife: 30,
    },
    surface: {
      blotchDark: 0x3a120a, blotchLight: 0xffc49a,
      craters: 7, craterBowl: 0x4a1a0e, craterRim: 0xffb48a,
      ripples: 46, rippleColor: 0x5a2212,
      bootTint: 0x4a1a0e, bootLife: 25,
      vignette: 0x1f0703, vignetteAlpha: 0.5,
    },
  },
};

export const PLANET_ORDER: PlanetId[] = ['moon', 'mars'];

export function planetById(id: string | undefined | null): PlanetDef {
  return PLANETS[(id as PlanetId)] ?? PLANETS.moon;
}

export function sampleDef(planet: PlanetDef, id: string): SampleDef | undefined {
  return planet.samples.find((s) => s.id === id);
}

/** Every sample id across every planet, in planet order. */
export function allSampleIds(): string[] {
  return PLANET_ORDER.flatMap((p) => PLANETS[p].samples.map((s) => s.id));
}

/** How far along a task is, as a count toward `task.count` (never above it). */
export function taskProgress(task: TaskDef, inventory: readonly string[]): number {
  let n: number;
  if (task.kind === 'collect') n = inventory.filter((s) => s === task.sample).length;
  else if (task.kind === 'any') n = inventory.length;
  else n = new Set(inventory).size;
  return Math.min(n, task.count);
}

export function taskDone(task: TaskDef, inventory: readonly string[]): boolean {
  return taskProgress(task, inventory) >= task.count;
}

/** True once every required task is finished: the lander may transmit. */
export function requiredTasksDone(planet: PlanetDef, inventory: readonly string[]): boolean {
  return planet.tasks.filter((t) => t.required).every((t) => taskDone(t, inventory));
}

/** True when the planet has bonus tasks and all of them are finished. */
export function bonusTasksDone(planet: PlanetDef, inventory: readonly string[]): boolean {
  const bonus = planet.tasks.filter((t) => !t.required);
  return bonus.length > 0 && bonus.every((t) => taskDone(t, inventory));
}

/** Would picking up `sampleId` move any unfinished task forward? */
export function sampleAdvancesTask(planet: PlanetDef, inventory: readonly string[], sampleId: string): boolean {
  const next = [...inventory, sampleId];
  return planet.tasks.some((t) => taskProgress(t, next) > taskProgress(t, inventory));
}
