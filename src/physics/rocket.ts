/**
 * Rocket design → stages & stats. Pure functions, no Phaser (CORE_SPEC §3).
 * Design = array of part ids, index 0 = TOP of the rocket.
 *
 * Stages: split at each decoupler. A decoupler belongs to the stage BELOW it
 * (it is the topmost part of that lower stage and drops with it).
 * Stage numbering from the bottom: stage 1 fires first.
 */
import { partDef } from '../data/parts';
import { G0 } from '../data/bodies';

export const MAX_PARTS = 12;

export interface StageStats {
  /** part ids top→bottom within this stage */
  parts: string[];
  hasEngine: boolean;
  fuel: number;      // capacity, kg
  dry: number;       // dry mass, kg
  m0: number;        // mass of this stage + everything above, fuelled
  m1: number;        // m0 − this stage's fuel
  thrustVac: number; // N
  thrustAsl: number; // N (sea-level equivalent)
  isp: number;       // combined vacuum Isp, s
  dv: number;        // m/s
  burn: number;      // s
}

export interface Warn {
  key: string;
  vars?: Record<string, string | number>;
  /** optional index into the design to highlight in the Builder */
  partIndex?: number;
}

export interface RocketStats {
  /** stages bottom-first: stages[0] fires first */
  stages: StageStats[];
  mass: number;
  fuelTotal: number;
  dvTotal: number;
  twr: number;       // launch TWR vs Earth gravity
  stable: boolean;   // nose cone or fins present
  cd: number;
  hasControl: boolean;
  hasParachute: boolean;
  hasAltSensor: boolean;
  hasSpeedSensor: boolean;
  warnings: Warn[];
  /** fatal problems — the rocket can't fly */
  blocking: boolean;
}

/** Split a design (top→bottom) into stage groups (top→bottom). */
export function splitStages(partIds: string[]): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const id of partIds) {
    // a decoupler starts a new group BELOW the current one
    if (partDef(id).kind === 'decoupler' && cur.length > 0) {
      groups.push(cur);
      cur = [id];
    } else {
      cur.push(id);
    }
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export function computeStats(partIds: string[]): RocketStats {
  const warnings: Warn[] = [];
  let blocking = false;

  if (partIds.length > MAX_PARTS) {
    warnings.push({ key: 'warn.max_parts' });
    blocking = true;
  }

  // groups top→bottom, then reverse so index 0 = bottom stage (stage 1)
  const groupsTopDown = splitStages(partIds);
  const groupsBotUp = [...groupsTopDown].reverse();

  const stageMass = groupsBotUp.map((g) =>
    g.reduce((s, id) => {
      const d = partDef(id);
      return s + d.massDry + (d.fuel ?? 0);
    }, 0),
  );

  const stages: StageStats[] = groupsBotUp.map((g, k) => {
    // m0_k = mass of all parts in stages ≥ k (with fuel)
    const m0 = stageMass.slice(k).reduce((a, b) => a + b, 0);
    const fuel = g.reduce((s, id) => s + (partDef(id).fuel ?? 0), 0);
    const dry = g.reduce((s, id) => s + partDef(id).massDry, 0);
    const m1 = m0 - fuel;
    const engines = g.filter((id) => partDef(id).kind === 'engine').map(partDef);
    const thrustVac = engines.reduce((s, e) => s + (e.thrustVac ?? 0), 0);
    const thrustAsl = engines.reduce(
      (s, e) => s + (e.thrustVac ?? 0) * ((e.ispAsl ?? 0) / (e.ispVac ?? 1)),
      0,
    );
    // combined Isp = F / Σ(F_i/isp_i)
    const isp =
      thrustVac > 0
        ? thrustVac / engines.reduce((s, e) => s + (e.thrustVac ?? 0) / (e.ispVac ?? 1), 0)
        : 0;
    const dv = isp > 0 && m1 > 0 && m0 > m1 ? isp * G0 * Math.log(m0 / m1) : 0;
    const burn = thrustVac > 0 ? (fuel * isp * G0) / thrustVac : 0;
    return { parts: g, hasEngine: engines.length > 0, fuel, dry, m0, m1, thrustVac, thrustAsl, isp, dv, burn };
  });

  const mass = stageMass.reduce((a, b) => a + b, 0);
  const fuelTotal = stages.reduce((s, st) => s + st.fuel, 0);
  const dvTotal = stages.reduce((s, st) => s + st.dv, 0);
  const stage1 = stages[0];
  const twr = stage1 && mass > 0 ? stage1.thrustAsl / (mass * G0) : 0;

  // --- validation ---
  let hasControl = false;
  let hasEngine = false;
  let hasNose = false;
  let hasFins = false;
  let hasParachute = false;
  let hasAlt = false;
  let hasSpeed = false;

  // map flat part index → its group (top→bottom index) and group's flat end
  const partIndexToGroup = new Map<number, number>();
  const groupEnds = new Map<number, number>(); // group idx → last flat index
  let flatIdx = 0;
  groupsTopDown.forEach((g, gi) => {
    g.forEach(() => partIndexToGroup.set(flatIdx++, gi));
    groupEnds.set(gi, flatIdx - 1);
  });

  partIds.forEach((id, i) => {
    const d = partDef(id);
    if (d.control) hasControl = true;
    if (d.kind === 'engine') {
      hasEngine = true;
      // must sit directly under a tank or decoupler
      const above = i > 0 ? partDef(partIds[i - 1]).kind : null;
      if (above !== 'tank' && above !== 'decoupler') {
        warnings.push({ key: 'warn.engine_attach', partIndex: i });
        blocking = true;
      }
      // must be bottom part of its stage
      const gi = partIndexToGroup.get(i) ?? 0;
      if (i !== groupEnds.get(gi)) {
        warnings.push({ key: 'warn.engine_bottom', partIndex: i });
        blocking = true;
      }
    }
    if (d.kind === 'nose') {
      hasNose = true;
      if (i !== 0) {
        warnings.push({ key: 'warn.nose_top', partIndex: i });
        blocking = true;
      }
    }
    if (d.kind === 'fins') {
      hasFins = true;
      // fins help on stage 1 (bottom group); warn otherwise
      const bottomGroup = groupsTopDown[groupsTopDown.length - 1] ?? [];
      if (!bottomGroup.includes(id)) {
        warnings.push({ key: 'warn.fins_bottom', partIndex: i });
      }
    }
    if (d.kind === 'chute') hasParachute = true;
    if (id === 'sensor_alt') hasAlt = true;
    if (id === 'sensor_speed') hasSpeed = true;
  });

  if (!hasControl && partIds.length > 0) warnings.push({ key: 'warn.no_control' });
  if (!hasEngine && partIds.length > 0) {
    warnings.push({ key: 'warn.no_engine' });
    blocking = true;
  }
  if (hasEngine && twr < 1) {
    warnings.push({ key: 'warn.twr_low', vars: { twr: twr.toFixed(2) } });
    blocking = true;
  }

  const stable = hasNose || hasFins;
  const cd = hasNose ? 0.3 : 0.5;

  return {
    stages, mass, fuelTotal, dvTotal, twr, stable, cd,
    hasControl, hasParachute, hasAltSensor: hasAlt, hasSpeedSensor: hasSpeed,
    warnings, blocking,
  };
}
