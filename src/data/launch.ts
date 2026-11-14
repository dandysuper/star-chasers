/**
 * launch.ts — launch sites, launch weather rules, and scoring a launch day.
 *
 * The weather rules are a kid-sized version of the real Launch Commit
 * Criteria that NASA and the Space Force weather officers check before
 * every launch: too much wind at the pad, storms (lightning) nearby, a thick
 * cloud deck, or cold beyond what the rocket is rated for all scrub the
 * launch. Different rockets have different limits: Soyuz flies from
 * Baikonur in −40 °C, while NASA will not fly SLS in near-freezing weather
 * since the 1986 Challenger accident.
 *
 * Pure data and functions: the planner scene and the unit tests share them.
 */
import { moonState, sunElevationAtNearSideCentre, marsWindowOffsetDays, type MoonState } from '../core/astro';
import { moonTrip, marsBudget, type MoonTrip, type MarsBudget } from '../physics/transfer';

export interface LaunchSite {
  id: 'ksc' | 'baikonur' | 'vostochny';
  lat: number;
  lon: number;
  /** Highest allowed peak ground wind, m/s. */
  windLimit: number;
  /** Coldest allowed air temperature, °C. */
  coldLimit: number;
}

export const LAUNCH_SITES: Record<LaunchSite['id'], LaunchSite> = {
  // Kennedy Space Center LC-39B: SLS / Artemis
  ksc: { id: 'ksc', lat: 28.627, lon: -80.621, windLimit: 15, coldLimit: 4 },
  // Baikonur Cosmodrome, Gagarin's Start
  baikonur: { id: 'baikonur', lat: 45.92, lon: 63.342, windLimit: 15, coldLimit: -40 },
  // Vostochny Cosmodrome
  vostochny: { id: 'vostochny', lat: 51.884, lon: 128.333, windLimit: 15, coldLimit: -40 },
};
export const SITE_ORDER: LaunchSite['id'][] = ['ksc', 'baikonur', 'vostochny'];

/** One day of launch-site weather. */
export interface Weather {
  /** Peak wind at 10 m, m/s. */
  windMax: number;
  /** Average wind at 10 m, m/s. */
  wind: number;
  /** Rain over the day, mm. */
  rainMm: number;
  /** Cloud cover, %. */
  cloudPct: number;
  /** Air temperature at 2 m, °C. */
  tempC: number;
  /** Where the wind blows FROM, degrees clockwise from north (weather convention). */
  dirDeg?: number;
}

/** Part of the average wind blowing toward the east, m/s (− = toward the west). */
export function windTowardEast(w: Weather): number {
  if (w.dirDeg === undefined) return w.wind;
  // a wind FROM the west (270°) blows toward the east
  return -w.wind * Math.sin((w.dirDeg * Math.PI) / 180);
}

/** Rain above this is treated as thunderstorms: lightning scrubs the launch. */
export const STORM_RAIN_MM = 5;
/** A cloud deck this thick can trigger lightning on a climbing rocket. */
export const CLOUD_LIMIT_PCT = 90;
export const CLOUD_CAUTION_PCT = 70;

export type ScrubReason = 'wind' | 'storm' | 'clouds' | 'cold' | 'dark' | 'mars_closed';
export type Caution = 'gusty' | 'cloudy' | 'harsh_sun' | 'far_moon';

/** Go / no-go for the weather alone. */
export function weatherVerdict(w: Weather, site: LaunchSite): { reasons: ScrubReason[]; cautions: Caution[] } {
  const reasons: ScrubReason[] = [];
  const cautions: Caution[] = [];
  if (w.windMax > site.windLimit) reasons.push('wind');
  else if (w.windMax > site.windLimit * 0.75) cautions.push('gusty');
  if (w.rainMm > STORM_RAIN_MM) reasons.push('storm');
  if (w.cloudPct > CLOUD_LIMIT_PCT) reasons.push('clouds');
  else if (w.cloudPct > CLOUD_CAUTION_PCT) cautions.push('cloudy');
  if (w.tempC < site.coldLimit) reasons.push('cold');
  return { reasons, cautions };
}

export type Lighting = 'good' | 'ok' | 'harsh' | 'dark';

/** How the landing site looks when the crew arrive (Sun height, degrees). */
export function landingLighting(sunElevDeg: number): Lighting {
  if (sunElevDeg < 0) return 'dark';
  if (sunElevDeg <= 30) return 'good';
  if (sunElevDeg <= 60) return 'ok';
  return 'harsh';
}

export type Target = 'earth' | 'moon' | 'mars';

export interface DayPlan {
  date: Date;
  weather: Weather | null;
  /** Share of past years this date scrubbed for weather, 0..1 (NASA POWER). */
  scrubChance: number | null;
  go: boolean;
  reasons: ScrubReason[];
  cautions: Caution[];
  moon: MoonState;
  /** Moon on arrival day (Moon trips). */
  arrivalMoon?: MoonState;
  arrivalSunElev?: number;
  lighting?: Lighting;
  trip?: MoonTrip;
  mars?: MarsBudget;
  marsOffsetDays?: number;
  /** 0..100, higher is a better day to fly. */
  score: number;
}

const DAY_MS = 86400000;

/**
 * Score one launch day.
 *
 * Weather decides go / no-go. For the Moon the landing site must be in
 * daylight on arrival, best with a low morning Sun. For Mars the planets
 * must line up. Inside the go days, the score prefers calm weather, good
 * light and a closer Moon (a shorter coast).
 */
export function evaluateDay(opts: {
  date: Date;
  site: LaunchSite;
  target: Target;
  weather: Weather | null;
  scrubChance?: number | null;
  rocketDv: number;
}): DayPlan {
  const { date, site, target, weather } = opts;
  const moon = moonState(date);
  const plan: DayPlan = {
    date, weather, scrubChance: opts.scrubChance ?? null,
    go: true, reasons: [], cautions: [], moon, score: 0,
  };
  let score = 100;

  if (weather) {
    const v = weatherVerdict(weather, site);
    plan.reasons.push(...v.reasons);
    plan.cautions.push(...v.cautions);
    // calm is better even when legal: up to −20 for wind near the limit
    score -= 20 * Math.min(1, weather.windMax / site.windLimit);
    score -= 10 * Math.min(1, weather.cloudPct / 100);
  }
  if (plan.scrubChance !== null) score -= 15 * plan.scrubChance;

  if (target === 'moon') {
    const trip = moonTrip(opts.rocketDv, moon.distanceKm);
    plan.trip = trip;
    const arrival = new Date(date.getTime() + trip.tripDays * DAY_MS);
    const am = moonState(arrival);
    plan.arrivalMoon = am;
    plan.arrivalSunElev = sunElevationAtNearSideCentre(am.elongationDeg);
    plan.lighting = landingLighting(plan.arrivalSunElev);
    if (plan.lighting === 'dark') plan.reasons.push('dark');
    if (plan.lighting === 'harsh') { plan.cautions.push('harsh_sun'); score -= 15; }
    if (plan.lighting === 'ok') score -= 8;
    // perigee 356,500 km … apogee 406,700 km: up to −10 for a far Moon
    const far = Math.min(1, Math.max(0, (moon.distanceKm - 356500) / (406700 - 356500)));
    score -= 10 * far;
    if (far > 0.8) plan.cautions.push('far_moon');
  } else if (target === 'mars') {
    const off = marsWindowOffsetDays(date);
    plan.marsOffsetDays = off;
    plan.mars = marsBudget(off);
    if (!plan.mars.inWindow) plan.reasons.push('mars_closed');
    score -= Math.min(40, Math.abs(off));
  }

  plan.go = plan.reasons.length === 0;
  plan.score = plan.go ? Math.max(1, Math.round(score)) : 0;
  return plan;
}

/** Index of the best go day, or −1 when every day is a scrub. */
export function bestDay(plans: DayPlan[]): number {
  let best = -1;
  plans.forEach((p, i) => {
    if (p.go && (best < 0 || p.score > plans[best].score)) best = i;
  });
  return best;
}

// --------------------------------------------------------------- history ---

/** Artemis II: the first crewed Moon trip since 1972. */
export const ARTEMIS_II = {
  /** Lift-off 1 April 2026, 6:35 p.m. EDT, LC-39B, Kennedy Space Center. */
  launch: new Date(Date.UTC(2026, 3, 1, 22, 35)),
  /** Closest pass around the far side of the Moon. */
  flyby: new Date(Date.UTC(2026, 3, 6, 23, 0)),
  /** Splashdown off San Diego, 10 April 2026, 8:07 p.m. EDT. */
  splashdown: new Date(Date.UTC(2026, 3, 11, 0, 7)),
  site: 'ksc' as const,
};
