/**
 * budget.ts — what the rocket costs and how big each mission's grant is.
 *
 * Real missions are planned around money as much as physics: every engine and
 * tank has a price, and a grant (a fixed sum from the agency) caps the total.
 * The prices are invented but keep real proportions: engines cost the most,
 * a crew pod costs more than a robot probe, tanks are cheap metal.
 * Amounts are in millions of dollars ("$M").
 */
import { isKnownPart } from './parts';

export const PART_COST: Record<string, number> = {
  nose_cone: 2,
  probe_core: 6,
  pod: 30,
  tank_s: 3,
  tank_m: 5,
  tank_l: 9,
  engine_spark: 12,
  engine_bull: 30,
  engine_whisper: 20,
  decoupler: 2,
  fins: 1,
  parachute: 3,
};

/**
 * Grant per mission, $M. Each one fits the rocket the presets recommend for
 * it with some room to spare; the sandbox has no grant.
 */
export const MISSION_GRANT: Record<string, number> = {
  m1: 40,
  m2: 140,
  moon: 150,
  mars: 200,
};

export function partCost(id: string): number {
  return isKnownPart(id) ? PART_COST[id] ?? 0 : 0;
}

/** Total price of a rocket, $M. */
export function designCost(parts: readonly string[]): number {
  return parts.reduce((s, id) => s + partCost(id), 0);
}

/** The grant for a mission, or null when money is no object (sandbox). */
export function missionGrant(missionId: string | null): number | null {
  return missionId ? MISSION_GRANT[missionId] ?? null : null;
}
