/**
 * astro.ts — where the Moon, the Sun and Mars are on a given date.
 *
 * Pure maths, no network: the planner must work offline, and NASA's own
 * Moon-phase service (SVS Dial-A-Moon) does not allow calls from other web
 * sites. The formulas are the low-precision series from Jean Meeus,
 * "Astronomical Algorithms" (2nd ed., ch. 25 and 47): the Moon's longitude is
 * good to about 0.3°, its distance to a few hundred km, which is far more
 * than a phase picture or a launch-window score needs.
 *
 * Mars uses circular mean orbits (JPL "Approximate Positions of the Planets",
 * Table 1). Real windows wobble by a few weeks around what this gives,
 * because Mars's orbit is noticeably elliptical.
 */

const RAD = Math.PI / 180;
/** Average length of one lunar phase cycle (new Moon to new Moon), days. */
export const SYNODIC_MONTH = 29.530588;

const sin = (deg: number): number => Math.sin(deg * RAD);
const cos = (deg: number): number => Math.cos(deg * RAD);
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Julian Day of a JS date (UTC). */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0. */
function centuries(date: Date): number {
  return (julianDay(date) - 2451545.0) / 36525;
}

export type MoonPhaseName =
  | 'new' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous'
  | 'full' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

export interface MoonState {
  /** Geocentric ecliptic longitude, degrees 0..360. */
  lonDeg: number;
  /** Geocentric ecliptic latitude, degrees. */
  latDeg: number;
  /** Earth-centre to Moon-centre distance, km. */
  distanceKm: number;
  /** The Sun's geocentric ecliptic longitude, degrees. */
  sunLonDeg: number;
  /**
   * How far the Moon is ahead of the Sun in longitude, 0..360°.
   * 0 = new, 90 = first quarter, 180 = full, 270 = last quarter.
   */
  elongationDeg: number;
  /** Lit fraction of the disc as seen from Earth, 0..1. */
  illumination: number;
  /** Days since the last new Moon, 0..29.5. */
  ageDays: number;
  waxing: boolean;
  phase: MoonPhaseName;
}

/** The Sun's apparent ecliptic longitude (Meeus ch. 25, low precision). */
export function sunLongitude(date: Date): number {
  const T = centuries(date);
  const L0 = 280.46646 + 36000.76983 * T;
  const M = 357.52911 + 35999.05029 * T;
  const C = (1.914602 - 0.004817 * T) * sin(M) + 0.019993 * sin(2 * M) + 0.000289 * sin(3 * M);
  return norm360(L0 + C);
}

/** Meeus ch. 47, the largest periodic terms of the lunar theory. */
export function moonState(date: Date): MoonState {
  const T = centuries(date);
  const Lp = 218.3164477 + 481267.88123421 * T; // mean longitude
  const D = 297.8501921 + 445267.1114034 * T;   // mean elongation
  const M = 357.5291092 + 35999.0502909 * T;    // Sun's mean anomaly
  const Mp = 134.9633964 + 477198.8675055 * T;  // Moon's mean anomaly
  const F = 93.272095 + 483202.0175233 * T;     // argument of latitude

  // longitude terms, 1e-6 degree
  const sl =
    6288774 * sin(Mp) + 1274027 * sin(2 * D - Mp) + 658314 * sin(2 * D)
    + 213618 * sin(2 * Mp) - 185116 * sin(M) - 114332 * sin(2 * F)
    + 58793 * sin(2 * D - 2 * Mp) + 57066 * sin(2 * D - M - Mp)
    + 53322 * sin(2 * D + Mp) + 45758 * sin(2 * D - M)
    - 40923 * sin(M - Mp) - 34720 * sin(D) - 30383 * sin(M + Mp)
    + 15327 * sin(2 * D - 2 * F) - 12528 * sin(Mp + 2 * F) + 10980 * sin(Mp - 2 * F);
  // distance terms, metres
  const sr =
    -20905355 * cos(Mp) - 3699111 * cos(2 * D - Mp) - 2955968 * cos(2 * D)
    - 569925 * cos(2 * Mp) + 48888 * cos(M) - 3149 * cos(2 * F)
    + 246158 * cos(2 * D - 2 * Mp) - 152138 * cos(2 * D - M - Mp)
    - 170733 * cos(2 * D + Mp) - 204586 * cos(2 * D - M)
    - 129620 * cos(M - Mp) + 108743 * cos(D) + 104755 * cos(M + Mp);
  // latitude terms, 1e-6 degree
  const sb =
    5128122 * sin(F) + 280602 * sin(Mp + F) + 277693 * sin(Mp - F)
    + 173237 * sin(2 * D - F) + 55413 * sin(2 * D - Mp + F)
    + 46271 * sin(2 * D - Mp - F) + 32573 * sin(2 * D + F);

  const lonDeg = norm360(Lp + sl / 1e6);
  const latDeg = sb / 1e6;
  const distanceKm = 385000.56 + sr / 1000;
  const sunLonDeg = sunLongitude(date);
  const elongationDeg = norm360(lonDeg - sunLonDeg);

  // Angle Sun–Moon as seen from Earth, then the phase angle at the Moon.
  // The Sun is ~390× farther than the Moon, so i ≈ 180° − ψ is plenty.
  const psi = Math.acos(cos(latDeg) * cos(lonDeg - sunLonDeg)) / RAD;
  const i = 180 - psi;
  const illumination = (1 + cos(i)) / 2;

  return {
    lonDeg, latDeg, distanceKm, sunLonDeg, elongationDeg, illumination,
    ageDays: (elongationDeg / 360) * SYNODIC_MONTH,
    waxing: elongationDeg < 180,
    phase: phaseName(elongationDeg),
  };
}

/** Eight named phases, each a 45° slice centred on its exact moment. */
export function phaseName(elongationDeg: number): MoonPhaseName {
  const names: MoonPhaseName[] = [
    'new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
    'full', 'waning_gibbous', 'last_quarter', 'waning_crescent',
  ];
  return names[Math.floor(norm360(elongationDeg + 22.5) / 45) % 8];
}

/**
 * The Sun's height above the horizon at a landing site in the middle of the
 * Moon's near side (0° lat, 0° lon), degrees; negative = lunar night.
 *
 * At first quarter the terminator (sunrise line) crosses the centre of the
 * disc, so the Sun is just rising there; at full Moon it is overhead.
 * Apollo landed with the Sun 5–20° up, low enough for long shadows that show
 * every rock, high enough to see at all.
 */
export function sunElevationAtNearSideCentre(elongationDeg: number): number {
  const e = norm360(elongationDeg);
  return 90 - Math.abs(180 - e);
}

// ------------------------------------------------------------------ Mars ---

/** Heliocentric mean longitude of Earth and Mars, degrees (JPL Table 1). */
export function planetLongitudes(date: Date): { earth: number; mars: number } {
  const T = centuries(date);
  return {
    earth: norm360(100.46457166 + 35999.37244981 * T),
    mars: norm360(-4.55343205 + 19140.30268499 * T),
  };
}

/**
 * Mars ahead of Earth (heliocentric), −180..180°. A Hohmann transfer takes
 * ~259 days, during which Mars moves ~136°, so launch when Mars leads by
 * 180° − 136° ≈ 44°.
 */
export function marsPhaseAngle(date: Date): number {
  const { earth, mars } = planetLongitudes(date);
  let a = norm360(mars - earth);
  if (a > 180) a -= 360;
  return a;
}

/** The ideal phase angle for an Earth → Mars Hohmann transfer, degrees. */
export const MARS_WINDOW_ANGLE = 44.3;
/** How fast Earth catches up with Mars, degrees per day (360 / 779.9 d). */
const MARS_SYNODIC_RATE = (35999.37244981 - 19140.30268499) / 36525;

/** Days from `date` to the next Mars launch window (0 if open now). */
export function daysToMarsWindow(date: Date): number {
  const a = marsPhaseAngle(date);
  // Earth gains on Mars, so the angle shrinks; wrap to the next pass of 44°
  const diff = norm360(a - MARS_WINDOW_ANGLE);
  return diff / MARS_SYNODIC_RATE;
}

/** Days to the centre of the nearest window: + = still ahead, − = it already passed. */
export function marsWindowOffsetDays(date: Date): number {
  const ahead = daysToMarsWindow(date);
  const synodic = 360 / MARS_SYNODIC_RATE;
  // just after a window the "next" one is two years out: count back instead
  return ahead > synodic / 2 ? ahead - synodic : ahead;
}
