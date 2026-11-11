/**
 * Ready-made rockets for the builder's preset picker.
 *
 * Every preset is a full design (spine plus optional strap-on boosters), and
 * every one of them flies its missions with the simplest flight plan there is:
 * light the engine, keep it pointing straight up, drop a stage when it runs
 * dry, and switch the engine off once above 70 km. `predictFlight` runs that
 * plan through the real simulator and the real mission check, so the stars a
 * card promises are the stars the flight actually earns.
 *
 * Pure: no Phaser, so the predictions can be checked under Node.
 */
import { fromSlots, flatten, type DesignSlot } from './assembly';
import { MISSIONS } from './missions';
import { FlightSim, defaultControl, type SimEvent } from '../physics/sim';
import { computeAssemblyStats, type RocketStats } from '../physics/rocket';

export interface RocketPreset {
  /** i18n: `preset.<id>.name`, `preset.<id>.desc`, `preset.<id>.plan`. */
  id: string;
  slots: DesignSlot[];
  /** Missions this preset is the recommended pick for. */
  bestFor: string[];
  /** Card accent colour. */
  color: number;
}

const spine = (ids: string[]): DesignSlot[] => ids.map((id) => ({ id }));
/** A booster column bolted to both flanks of spine part `host`. */
const pair = (host: number, ids: string[]): DesignSlot[] => [
  ...ids.map((id) => ({ id, side: 'left' as const, host })),
  ...ids.map((id) => ({ id, side: 'right' as const, host })),
];

export const PRESETS: RocketPreset[] = [
  {
    // the spec's "Basic rocket": 1750 kg, TWR 3.1, Δv 2.7 km/s
    id: 'basic',
    slots: spine(['nose_cone', 'probe_core', 'tank_m', 'engine_spark']),
    bestFor: [],
    color: 0x3a6bb5,
  },
  {
    // 1930 kg: under the 2-tonne line for First Launch's second star, with
    // fins for a straight climb and a parachute for the way down
    id: 'hopper',
    slots: spine(['nose_cone', 'parachute', 'probe_core', 'tank_m', 'fins', 'engine_spark']),
    bestFor: ['m1'],
    color: 0x4f9142,
  },
  {
    // two stages: a Bull lifts three big tanks through the air, then a
    // Whisper, which is only good in thin air, finishes the climb
    id: 'arrow',
    slots: spine([
      'nose_cone', 'probe_core', 'tank_l', 'tank_l', 'engine_whisper',
      'decoupler', 'tank_l', 'tank_l', 'tank_l', 'fins', 'engine_bull',
    ]),
    bestFor: [],
    color: 0xc97a26,
  },
  {
    // three abreast: two strap-on Spark boosters burn with the Bull core,
    // then the upper stage still has most of its fuel at 70 km
    id: 'triple',
    slots: [
      ...spine([
        'nose_cone', 'probe_core', 'tank_l', 'tank_l', 'engine_whisper',
        'decoupler', 'tank_l', 'engine_bull',
      ]),
      ...pair(6, ['tank_m', 'engine_spark']),
    ],
    bestFor: ['m2'],
    color: 0xb83a3a,
  },
  {
    // an astronaut's pod and parachute on top of a two-stage stack
    id: 'crew',
    slots: spine([
      'nose_cone', 'parachute', 'pod', 'tank_l', 'tank_l', 'engine_whisper',
      'decoupler', 'tank_l', 'tank_l', 'tank_l', 'fins', 'engine_bull',
    ]),
    bestFor: [],
    color: 0x6b4fa0,
  },
  {
    // three stages and two strap-on tanks: the most Δv in the hangar, enough
    // to leave Earth for good
    id: 'escape',
    slots: [
      ...spine([
        'nose_cone', 'probe_core', 'tank_m', 'engine_whisper', 'decoupler',
        'tank_l', 'engine_whisper', 'decoupler', 'tank_l', 'engine_bull',
      ]),
      ...pair(8, ['tank_l']),
    ],
    bestFor: [],
    color: 0xd8a41f,
  },
];

export function presetById(id: string): RocketPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Flat top-to-bottom part list, the shape the flight sim reads. */
export function presetParts(preset: RocketPreset): string[] {
  return flatten(fromSlots(preset.slots)).ids;
}

export function presetStats(preset: RocketPreset): RocketStats {
  return computeAssemblyStats(fromSlots(preset.slots));
}

/** Every part on the rocket is allowed by the mission (sandbox allows all). */
export function presetAllowed(preset: RocketPreset, missionId: string | null): boolean {
  const mission = missionId ? MISSIONS[missionId] : null;
  if (!mission) return true;
  return preset.slots.every((s) => mission.allowedParts.includes(s.id));
}

export interface FlightPrediction {
  success: boolean;
  stars: number;
  /** Sim seconds until the mission check resolved. */
  time: number;
  fuelPercent: number;
  maxAltitude: number;
  /** Cleared Earth's gravity: the orbit no longer closes. */
  escapes: boolean;
}

/** Above this the simple plan switches the engine off (Reach Space's goal). */
const CUTOFF_ALT = 70000;

const cache = new Map<string, FlightPrediction>();

/**
 * Fly `parts` with the simple plan. With a mission id the run ends where the
 * mission check ends it and is scored with the mission's own star rules;
 * without one it burns every stage and reports whether the rocket escapes.
 */
export function predictFlight(parts: string[], missionId: string | null): FlightPrediction {
  const key = `${missionId ?? 'free'}|${parts.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mission = missionId ? MISSIONS[missionId] : null;
  const sim = new FlightSim(parts);
  const control = defaultControl();
  control.engineOn = true;
  const limit = mission && mission.kind === 'flight' ? mission.timeLimit + 5 : 900;
  const events: SimEvent[] = [];
  let outcome: 'running' | 'success' | 'fail' = 'running';

  while (sim.t < limit) {
    const stage = sim.stage;
    if (stage && stage.fuel <= 0 && sim.stageIndex < sim.stages.length - 1) control.stageRequest = true;
    if (mission && sim.telemetry().altitude >= CUTOFF_ALT) control.engineOn = false;
    events.length = 0;
    sim.step(control, events);
    if (mission) {
      const r = mission.check(sim, { engineOn: control.engineOn });
      if (r === 'success') { outcome = 'success'; break; }
      if (r !== 'running') { outcome = 'fail'; break; }
    }
    if (sim.phase === 'crashed' || sim.phase === 'landed') break;
    // a free flight is settled once every stage is spent
    if (!mission && sim.stages.every((s) => s.fuel <= 0 || !s.hasEngine)) break;
  }

  const tel = sim.telemetry(control);
  const success = outcome === 'success';
  const result = {
    success,
    maxAltitude: sim.maxAltitude,
    fuelPercent: tel.fuelPercent,
    time: sim.t,
  };
  const stars = mission && success
    ? mission.stars(result, { landedSoftly: sim.phase === 'landed', mass: sim.stats.mass })
    : 0;
  const prediction: FlightPrediction = {
    success,
    stars,
    time: sim.t,
    fuelPercent: tel.fuelPercent,
    maxAltitude: sim.maxAltitude,
    escapes: tel.apoapsis === Infinity,
  };
  cache.set(key, prediction);
  return prediction;
}
