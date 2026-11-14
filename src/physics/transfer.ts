/**
 * transfer.ts — the Δv budget for a trip to the Moon or Mars, and how long the
 * coast takes.
 *
 * Two scales live side by side:
 * - **game scale**: the flight sim's Earth and Moon are 1/10 of real size with
 *   real surface gravity (data/bodies.ts), so every Δv the builder shows is
 *   about 1/3 of the real one. The budget the player must beat is in game m/s.
 * - **real scale**: the trip time and the "real NASA" numbers on the planner
 *   are computed with real Earth constants and the Moon's real distance on
 *   the chosen date, so the player sees Apollo-like days, not minutes.
 *
 * Extra Δv left after the minimum burn makes the coast faster: the transfer
 * orbit gets longer than needed (or becomes a hyperbola), and the craft
 * reaches the Moon's distance sooner. That is why lighter rockets arrive
 * first, and why Apollo took ~3 days instead of the minimum ~5.
 */
import { EARTH, MOON } from '../data/bodies';

// ---- real constants ----
export const REAL_GM_EARTH = 3.986004418e14; // m³/s²
export const REAL_R_EARTH = 6371e3;
/** Low Earth parking orbit used by Apollo and Artemis, ~185 km. */
export const REAL_LEO_R = REAL_R_EARTH + 185e3;

// ---- game constants ----
/** Game parking orbit: just above the 70 km atmosphere. */
export const GAME_LEO_R = EARTH.R + 80e3;
/**
 * Δv from the pad to a low orbit in the game, including gravity and drag
 * losses. A 1/10-scale Earth with real gravity behaves like Kerbin, where
 * reaching orbit costs ~3.4 km/s.
 */
export const GAME_DV_TO_ORBIT = 3400;
/** Real equivalent: Falcon 9 / SLS spend ~9.4 km/s to reach LEO. */
export const REAL_DV_TO_ORBIT = 9400;

/** Speed on a circular orbit of radius r. */
export function circularSpeed(GM: number, r: number): number {
  return Math.sqrt(GM / r);
}

/** Perigee speed of a transfer ellipse from rp out to ra (vis-viva). */
export function transferPerigeeSpeed(GM: number, rp: number, ra: number): number {
  return Math.sqrt((2 * GM * ra) / (rp * (rp + ra)));
}

/** Minimum (Hohmann) burn from a circular orbit rp to reach distance ra. */
export function hohmannBurn(GM: number, rp: number, ra: number): number {
  return transferPerigeeSpeed(GM, rp, ra) - circularSpeed(GM, rp);
}

/**
 * Time to coast from perigee rp (speed vp) out to distance r, seconds.
 * Handles the ellipse (vp below escape) and the hyperbola (above). Returns
 * Infinity when the orbit never gets that far.
 */
export function coastTime(GM: number, rp: number, vp: number, r: number): number {
  const energy = (vp * vp) / 2 - GM / rp;
  const h = rp * vp;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (GM * GM)));
  if (energy < 0) {
    const a = -GM / (2 * energy);
    const ra = a * (1 + e);
    if (ra < r) return Infinity;
    // eccentric anomaly at radius r: r = a(1 − e cos E)
    const E = Math.acos(Math.min(1, Math.max(-1, (1 - r / a) / e)));
    return Math.sqrt((a * a * a) / GM) * (E - e * Math.sin(E));
  }
  // hyperbola: r = a(e cosh H − 1) with a = GM / (2·energy) > 0
  const a = GM / (2 * energy);
  const H = Math.acosh((r / a + 1) / e);
  return Math.sqrt((a * a * a) / GM) * (e * Math.sinh(H) - H);
}

// ------------------------------------------------------------------ Moon ---

/** Moon landing after the coast: capture into low lunar orbit + descent. */
export const GAME_DV_MOON_LANDING = 900;
/** Real: lunar orbit insertion ~0.9 km/s + powered descent ~1.9 km/s. */
export const REAL_DV_MOON_LANDING = 2800;

export interface MoonBudget {
  /** Game m/s, what the builder's Δv must reach. */
  toOrbit: number;
  transLunar: number;
  landing: number;
  total: number;
  /** Real-world equivalents, m/s. */
  real: { toOrbit: number; transLunar: number; landing: number; total: number };
}

/** The Δv to land on the Moon when it is `moonDistanceKm` away. */
export function moonBudget(moonDistanceKm: number): MoonBudget {
  // the game Moon is 1/10 as far, like everything else in the sim
  const gameRa = (moonDistanceKm * 1000) / 10;
  const transLunar = hohmannBurn(EARTH.GM, GAME_LEO_R, gameRa);
  const realTli = hohmannBurn(REAL_GM_EARTH, REAL_LEO_R, moonDistanceKm * 1000);
  return {
    toOrbit: GAME_DV_TO_ORBIT,
    transLunar,
    landing: GAME_DV_MOON_LANDING,
    total: GAME_DV_TO_ORBIT + transLunar + GAME_DV_MOON_LANDING,
    real: {
      toOrbit: REAL_DV_TO_ORBIT,
      transLunar: realTli,
      landing: REAL_DV_MOON_LANDING,
      total: REAL_DV_TO_ORBIT + realTli + REAL_DV_MOON_LANDING,
    },
  };
}

/** Real-to-game Δv ratio for the trans-lunar burn (~0.30). */
export function tliScale(moonDistanceKm: number): number {
  const b = moonBudget(moonDistanceKm);
  return b.transLunar / b.real.transLunar;
}

/**
 * Crews never spend all their spare Δv on speed: most stays in the tanks as
 * a reserve for course corrections and the trip home. About a tenth goes into a
 * faster burn, which gives Apollo-like 2–4 day coasts for good rockets.
 */
const SURPLUS_FOR_SPEED = 0.08;
/** Never quicker than a day: a crewed capsule is not New Horizons (9 h). */
const MIN_TRIP_S = 24 * 3600;

export interface MoonTrip {
  /** The rocket can do the whole trip. */
  enough: boolean;
  /** Game m/s still missing (0 when enough). */
  shortBy: number;
  /** Game m/s above the minimum, spent on a faster burn. */
  surplus: number;
  /** Real coast time, days. */
  tripDays: number;
  /** The minimum-energy coast for this distance, days (~5). */
  hohmannDays: number;
}

/**
 * How the rocket's Δv plays out: does it reach the Moon, and how fast. The
 * surplus is converted to a real-scale extra burn at perigee, then the real
 * coast time is solved from Kepler's equation.
 */
export function moonTrip(rocketDv: number, moonDistanceKm: number): MoonTrip {
  const b = moonBudget(moonDistanceKm);
  const r = moonDistanceKm * 1000;
  const vMin = transferPerigeeSpeed(REAL_GM_EARTH, REAL_LEO_R, r);
  const hohmannS = coastTime(REAL_GM_EARTH, REAL_LEO_R, vMin, r);
  const surplus = rocketDv - b.total;
  if (surplus < 0) {
    return { enough: false, shortBy: -surplus, surplus: 0, tripDays: hohmannS / 86400, hohmannDays: hohmannS / 86400 };
  }
  const extraReal = (surplus * SURPLUS_FOR_SPEED) / tliScale(moonDistanceKm);
  const t = coastTime(REAL_GM_EARTH, REAL_LEO_R, vMin + extraReal, r);
  return {
    enough: true,
    shortBy: 0,
    surplus,
    tripDays: Math.max(MIN_TRIP_S, Math.min(t, hohmannS)) / 86400,
    hohmannDays: hohmannS / 86400,
  };
}

// ------------------------------------------------------------------ Mars ---

/**
 * Real Δv from low Earth orbit to the Martian surface inside a window:
 * trans-Mars injection ~3.6 km/s; the thin air does most of the braking
 * (heat shield + parachute), so landing adds only ~0.7 km/s. That is less
 * than a Moon landing, which has no air to brake with.
 */
export const REAL_DV_TMI = 3600;
export const REAL_DV_MARS_LANDING = 700;
/** Window half-width: about ±3 weeks around the ideal day stays cheap. */
export const MARS_WINDOW_HALF_DAYS = 21;

export interface MarsBudget {
  toOrbit: number;
  transMars: number;
  landing: number;
  total: number;
  /** The trip is only possible inside a window. */
  inWindow: boolean;
  real: { toOrbit: number; transMars: number; landing: number; total: number };
  /** Hohmann coast to Mars, days. */
  tripDays: number;
}

/**
 * Δv to land on Mars when launching `offsetDays` from the ideal day. The extra
 * cost off-window is a simple quadratic stand-in for a porkchop plot: a month
 * late roughly doubles the injection burn.
 */
export function marsBudget(offsetDays: number): MarsBudget {
  const off = Math.abs(offsetDays);
  const tmiReal = REAL_DV_TMI * (1 + (off / 30) ** 2);
  // the same real→game ratio as the Moon trip, ~0.30
  const k = tliScale(384400);
  const transMars = tmiReal * k;
  const landing = REAL_DV_MARS_LANDING * k;
  return {
    toOrbit: GAME_DV_TO_ORBIT,
    transMars,
    landing,
    total: GAME_DV_TO_ORBIT + transMars + landing,
    inWindow: off <= MARS_WINDOW_HALF_DAYS,
    real: {
      toOrbit: REAL_DV_TO_ORBIT,
      transMars: tmiReal,
      landing: REAL_DV_MARS_LANDING,
      total: REAL_DV_TO_ORBIT + tmiReal + REAL_DV_MARS_LANDING,
    },
    tripDays: 259,
  };
}

/** Game-scale distance to the Moon the sim's static Moon uses, for reference. */
export const GAME_MOON_DISTANCE = MOON.y;
