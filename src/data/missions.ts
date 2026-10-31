/** Mission definitions (CORE_SPEC §7). */
import type { FlightSim } from '../physics/sim';

export interface MissionResult {
  success: boolean;
  failKey?: string;
  failVars?: Record<string, string | number>;
  maxAltitude: number;
  fuelPercent: number;
  time: number;
  blocks: number;
  samples?: number;
}

export interface MissionDef {
  id: string;
  titleKey: string;
  briefKey: string;
  factKey: string;
  body: 'earth' | 'moon';
  allowedParts: string[];
  starterProgram: unknown;
  timeLimit: number;         // seconds of sim time
  dvNeed: number;            // shown vs the rocket's Δv bar (m/s)
  check: (sim: FlightSim, info: { engineOffByProgram: boolean }) =>
    'running' | 'success' | { fail: string; vars?: Record<string, string | number> };
  stars: (r: MissionResult, ctx: { landedSoftly?: boolean; underTime?: boolean; allSamples?: boolean; mass?: number }) => number;
  hintKeys: string[];
}

const M1_STARTER = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'rs_when_launched', id: 'starter_hat', x: 40, y: 40,
        next: { block: { type: 'rs_engine', id: 'starter_engine', fields: { ON: 'ON' } } },
      },
    ],
  },
};

/** Reused as the sandbox default so the workspace is never empty on entry. */
export const STARTER_PROGRAM = M1_STARTER;

export const MISSIONS: Record<string, MissionDef> = {
  m1: {
    id: 'm1', titleKey: 'mission.m1.title', briefKey: 'mission.m1.brief', factKey: 'fact.m1',
    body: 'earth',
    allowedParts: ['nose_cone', 'probe_core', 'tank_s', 'tank_m', 'engine_spark', 'fins', 'sensor_alt', 'parachute'],
    starterProgram: M1_STARTER,
    timeLimit: 120,
    dvNeed: 1500,
    check: (sim) => {
      if (sim.phase === 'crashed') return { fail: 'fail.crashed' };
      if (sim.maxAltitude >= 10000) return 'success';
      if (sim.t > 120) return { fail: 'fail.timeout' };
      if (sim.phase === 'landed' && sim.launched && sim.maxAltitude < 10000) {
        return { fail: 'fail.fell_back', vars: { h: `${Math.round(sim.maxAltitude / 100) / 10} km` } };
      }
      // fell back: fuel empty, engine off, descending and below goal
      if (sim.launched && sim.maxAltitude < 10000) {
        const st = sim.stages[sim.stageIndex];
        const fuelLeft = sim.stages.reduce((s, x) => s + x.fuel, 0);
        const falling = sim.telemetry().vspeed < -1;
        if ((st.fuel <= 0 || fuelLeft <= 0) && falling) {
          return { fail: 'fail.fell_back', vars: { h: `${Math.round(sim.maxAltitude / 100) / 10} km` } };
        }
      }
      return 'running';
    },
    stars: (r, ctx) => {
      if (!r.success) return 0;
      let s = 1;
      if ((ctx.mass ?? 9999) <= 2000) s = 2;
      if (s === 2 && ctx.landedSoftly) s = 3;
      return s;
    },
    hintKeys: ['hint.m1', 'hint.m1b'],
  },

  m2: {
    id: 'm2', titleKey: 'mission.m2.title', briefKey: 'mission.m2.brief', factKey: 'fact.m2',
    body: 'earth',
    allowedParts: [
      'nose_cone', 'probe_core', 'pod', 'tank_s', 'tank_m', 'tank_l',
      'engine_spark', 'engine_bull', 'engine_whisper', 'decoupler',
      'fins', 'parachute', 'sensor_alt', 'sensor_speed',
    ],
    starterProgram: M1_STARTER,
    timeLimit: 300,
    dvNeed: 3000,
    check: (sim, info) => {
      if (sim.phase === 'crashed') return { fail: 'fail.crashed' };
      if (sim.t > 300) return { fail: 'fail.timeout' };
      if (sim.maxAltitude >= 70000) {
        return info.engineOffByProgram ? 'success' : { fail: 'fail.no_cutoff' };
      }
      if (sim.launched) {
        const falling = sim.telemetry().vspeed < -1 && sim.maxAltitude < 70000;
        const fuelLeft = sim.stages.reduce((s, x) => s + x.fuel, 0);
        if ((fuelLeft <= 0 || sim.phase === 'landed') && falling) {
          return { fail: 'fail.low_dv', vars: { h: `${Math.round(sim.maxAltitude / 100) / 10} km` } };
        }
      }
      return 'running';
    },
    stars: (r) => {
      if (!r.success) return 0;
      let s = 1;
      if (r.fuelPercent >= 0.10) s = 2;
      if (s === 2 && r.blocks <= 12) s = 3;
      return s;
    },
    hintKeys: ['hint.m2'],
  },

  moon: {
    id: 'moon', titleKey: 'mission.moon.title', briefKey: 'mission.moon.brief', factKey: 'fact.moon',
    body: 'moon',
    allowedParts: [],
    starterProgram: {},
    timeLimit: 0,
    dvNeed: 0,
    check: () => 'running', // resolved inside ExploreScene
    stars: (r, ctx) => {
      if (!r.success) return 0;
      let s = 1;
      if (ctx.underTime) s = 2;
      if (ctx.allSamples) s = 3;
      return s;
    },
    hintKeys: ['hint.explore.1', 'hint.explore.2', 'hint.explore.3'],
  },
};

export const MISSION_ORDER = ['m1', 'm2', 'moon'];

export function missionById(id: string | null): MissionDef | null {
  return id ? MISSIONS[id] ?? null : null;
}
