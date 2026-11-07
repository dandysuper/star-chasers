/** Part catalog. All parts share diameter S = 1.25 m (CORE_SPEC §3). */

export const PART_DIAMETER = 1.25;
export const PART_AREA = Math.PI * 0.625 * 0.625; // 1.227 m²

export interface PartDef {
  id: string;
  massDry: number; // kg
  fuel?: number; // kg propellant capacity
  thrustVac?: number; // N
  ispVac?: number; // s
  ispAsl?: number; // s
  control?: boolean;
  crew?: number;
  stability?: number;
  cdChute?: number;
  chuteArea?: number; // m²
  /** draw height in "units" (1 unit ≈ 1.25 m) for the side-view stub */
  h: number;
  kind: 'nose' | 'control' | 'tank' | 'engine' | 'decoupler' | 'fins' | 'chute';
}

export const PARTS: Record<string, PartDef> = {
  nose_cone:      { id: 'nose_cone',      massDry: 100,  h: 1.0, kind: 'nose' },
  probe_core:     { id: 'probe_core',     massDry: 100,  control: true, h: 0.6, kind: 'control' },
  pod:            { id: 'pod',            massDry: 800,  control: true, crew: 1, h: 1.2, kind: 'control' },
  tank_s:         { id: 'tank_s',         massDry: 125,  fuel: 500,  h: 1.0, kind: 'tank' },
  tank_m:         { id: 'tank_m',         massDry: 250,  fuel: 1000, h: 2.0, kind: 'tank' },
  tank_l:         { id: 'tank_l',         massDry: 500,  fuel: 2000, h: 4.0, kind: 'tank' },
  engine_spark:   { id: 'engine_spark',   massDry: 300,  thrustVac: 60000,  ispVac: 320, ispAsl: 280, h: 0.8, kind: 'engine' },
  engine_bull:    { id: 'engine_bull',    massDry: 1200, thrustVac: 250000, ispVac: 300, ispAsl: 260, h: 1.2, kind: 'engine' },
  engine_whisper: { id: 'engine_whisper', massDry: 400,  thrustVac: 40000,  ispVac: 360, ispAsl: 150, h: 1.4, kind: 'engine' },
  decoupler:      { id: 'decoupler',      massDry: 50,   h: 0.3, kind: 'decoupler' },
  fins:           { id: 'fins',           massDry: 100,  stability: 1, h: 0.5, kind: 'fins' },
  parachute:      { id: 'parachute',      massDry: 80,   cdChute: 1.5, chuteArea: 30, h: 0.5, kind: 'chute' },
};

export const PART_IDS = Object.keys(PARTS);

/** The "Basic rocket" preset (spec §3): m0 = 1750 kg, TWR ≈ 3.1, Δv ≈ 2.7 km/s. */
export const PRESET_BASIC: string[] = [
  'nose_cone', 'probe_core', 'tank_m', 'engine_spark',
];

/** False for ids from an older save (the retired sensor parts, for one). */
export function isKnownPart(id: string): boolean {
  return id in PARTS;
}

export function partDef(id: string): PartDef {
  const d = PARTS[id];
  if (!d) throw new Error(`unknown part ${id}`);
  return d;
}
