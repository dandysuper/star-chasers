/** Mission definitions (CORE_SPEC §7). */
import type { FlightSim } from '../physics/sim';
import type { PlanetId } from './planets';

export interface MissionResult {
  success: boolean;
  failKey?: string;
  failVars?: Record<string, string | number>;
  maxAltitude: number;
  fuelPercent: number;
  time: number;
  samples?: number;
  /** Explore runs: finished tasks out of all tasks. */
  tasksDone?: number;
  tasksTotal?: number;
}

export interface StarContext {
  landedSoftly?: boolean;
  mass?: number;
  /** Explore: transmitted inside the planet's time limit. */
  underTime?: boolean;
  /** Explore: every bonus sample task finished. */
  bonusDone?: boolean;
}

export interface MissionDef {
  id: string;
  /** flight: build and pilot a rocket · explore: walk a planet and collect samples. */
  kind: 'flight' | 'explore';
  titleKey: string;
  briefKey: string;
  factKey: string;
  body: 'earth' | PlanetId;
  /** Explore missions only: which surface to walk. */
  planet?: PlanetId;
  allowedParts: string[];
  timeLimit: number;         // seconds of sim time
  dvNeed: number;            // shown vs the rocket's Δv bar (m/s)
  check: (sim: FlightSim, info: { engineOn: boolean }) =>
    'running' | 'success' | { fail: string; vars?: Record<string, string | number> };
  stars: (r: MissionResult, ctx: StarContext) => number;
  hintKeys: string[];
}

/** Explore missions are resolved inside ExploreScene, never by a flight check. */
const exploreCheck = (): 'running' => 'running';

/** One star for the transmit, one for the bonus samples, one for the clock. */
const exploreStars = (r: MissionResult, ctx: StarContext): number => {
  if (!r.success) return 0;
  return 1 + (ctx.bonusDone ? 1 : 0) + (ctx.underTime ? 1 : 0);
};

export const MISSIONS: Record<string, MissionDef> = {
  m1: {
    id: 'm1', kind: 'flight',
    titleKey: 'mission.m1.title', briefKey: 'mission.m1.brief', factKey: 'fact.m1',
    body: 'earth',
    allowedParts: ['nose_cone', 'probe_core', 'tank_s', 'tank_m', 'engine_spark', 'fins', 'parachute'],
    timeLimit: 120,
    dvNeed: 1500,
    check: (sim) => {
      if (sim.phase === 'crashed') return { fail: 'fail.crashed' };
      if (sim.maxAltitude >= 10000) return 'success';
      if (sim.t > 120) return { fail: 'fail.timeout' };
      if (sim.phase === 'landed' && sim.launched && sim.maxAltitude < 10000) {
        return { fail: 'fail.fell_back', vars: { h: `${Math.round(sim.maxAltitude / 100) / 10} km` } };
      }
      // fell back: fuel empty, descending and below goal
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
    id: 'm2', kind: 'flight',
    titleKey: 'mission.m2.title', briefKey: 'mission.m2.brief', factKey: 'fact.m2',
    body: 'earth',
    allowedParts: [
      'nose_cone', 'probe_core', 'pod', 'tank_s', 'tank_m', 'tank_l',
      'engine_spark', 'engine_bull', 'engine_whisper', 'decoupler',
      'fins', 'parachute',
    ],
    timeLimit: 300,
    dvNeed: 3000,
    check: (sim, info) => {
      if (sim.phase === 'crashed') return { fail: 'fail.crashed' };
      if (sim.t > 300) return { fail: 'fail.timeout' };
      if (sim.maxAltitude >= 70000) {
        // in space: the pilot has to switch the engine off before falling back
        if (!info.engineOn) return 'success';
        const tel = sim.telemetry();
        if (tel.altitude < 70000 && tel.vspeed < 0) return { fail: 'fail.no_cutoff' };
        return 'running';
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
      if (s === 2 && r.fuelPercent >= 0.25) s = 3;
      return s;
    },
    hintKeys: ['hint.m2', 'hint.m2b'],
  },
  moon: {
    id: 'moon', kind: 'explore',
    titleKey: 'mission.moon.title', briefKey: 'mission.moon.brief', factKey: 'fact.moon',
    body: 'moon', planet: 'moon',
    allowedParts: [],
    timeLimit: 0,
    dvNeed: 0,
    check: exploreCheck,
    stars: exploreStars,
    hintKeys: ['hint.explore.1', 'hint.explore.2', 'hint.explore.3'],
  },
  mars: {
    id: 'mars', kind: 'explore',
    titleKey: 'mission.mars.title', briefKey: 'mission.mars.brief', factKey: 'fact.mars',
    body: 'mars', planet: 'mars',
    allowedParts: [],
    timeLimit: 0,
    dvNeed: 0,
    check: exploreCheck,
    stars: exploreStars,
    hintKeys: ['hint.explore.1', 'hint.explore.2', 'hint.mars.mudstone'],
  },
};

export const MISSION_ORDER = ['m1', 'm2', 'moon', 'mars'];

export function missionById(id: string | null): MissionDef | null {
  return id ? MISSIONS[id] ?? null : null;
}

export function isExploreMission(id: string | null): boolean {
  return missionById(id)?.kind === 'explore';
}
