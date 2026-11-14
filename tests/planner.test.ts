import { describe, it, expect } from 'vitest';
import { moonState, sunElevationAtNearSideCentre, daysToMarsWindow, marsWindowOffsetDays } from '../src/core/astro';
import {
  moonBudget, moonTrip, coastTime, transferPerigeeSpeed, REAL_GM_EARTH, REAL_LEO_R, marsBudget,
} from '../src/physics/transfer';
import { evaluateDay, weatherVerdict, LAUNCH_SITES, bestDay, ARTEMIS_II, type Weather } from '../src/data/launch';
import { designCost, missionGrant } from '../src/data/budget';
import { PRESETS, presetParts } from '../src/data/presets';
import { computeStats } from '../src/physics/rocket';
import { FlightSim, defaultControl, windAt, type SimEvent } from '../src/physics/sim';
import { PRESET_BASIC } from '../src/data/parts';

const calm: Weather = { windMax: 4, wind: 2, rainMm: 0, cloudPct: 10, tempC: 22 };

describe('Moon ephemeris', () => {
  it('is full during the total lunar eclipse of 3 March 2026', () => {
    const m = moonState(new Date(Date.UTC(2026, 2, 3, 11, 33)));
    expect(m.illumination).toBeGreaterThan(0.99);
    expect(m.phase).toBe('full');
  });
  it('is new during the annular solar eclipse of 17 February 2026', () => {
    const m = moonState(new Date(Date.UTC(2026, 1, 17, 12, 12)));
    expect(m.illumination).toBeLessThan(0.01);
    expect(m.phase).toBe('new');
  });
  it('stays between perigee and apogee', () => {
    for (let d = 0; d < 60; d++) {
      const m = moonState(new Date(Date.UTC(2026, 0, 1 + d)));
      expect(m.distanceKm).toBeGreaterThan(355000);
      expect(m.distanceKm).toBeLessThan(407500);
    }
  });
  it('puts the Sun overhead at full Moon and on the horizon at quarter', () => {
    expect(sunElevationAtNearSideCentre(180)).toBe(90);
    expect(sunElevationAtNearSideCentre(90)).toBe(0);
    expect(sunElevationAtNearSideCentre(10)).toBeLessThan(0);
  });
});

describe('transfer physics', () => {
  it('needs about 3.1 km/s for a real trans-lunar burn', () => {
    const b = moonBudget(384400);
    expect(b.real.transLunar).toBeGreaterThan(3050);
    expect(b.real.transLunar).toBeLessThan(3200);
    // the 1/10-scale game needs about a third of that
    expect(b.transLunar).toBeGreaterThan(800);
    expect(b.transLunar).toBeLessThan(1100);
  });
  it('coasts about 5 days on the minimum-energy path', () => {
    const r = 384400e3;
    const t = coastTime(REAL_GM_EARTH, REAL_LEO_R, transferPerigeeSpeed(REAL_GM_EARTH, REAL_LEO_R, r), r);
    expect(t / 86400).toBeGreaterThan(4.5);
    expect(t / 86400).toBeLessThan(5.5);
  });
  it('arrives sooner with more Δv (a lighter rocket)', () => {
    const need = moonBudget(384400).total;
    const slow = moonTrip(need + 20, 384400);
    const fast = moonTrip(need + 600, 384400);
    expect(slow.enough && fast.enough).toBe(true);
    expect(fast.tripDays).toBeLessThan(slow.tripDays);
    expect(fast.tripDays).toBeGreaterThan(0.3);
  });
  it('reports how much Δv is missing', () => {
    const trip = moonTrip(2600, 384400);
    expect(trip.enough).toBe(false);
    expect(trip.shortBy).toBeGreaterThan(2000);
  });
  it('makes Mars cheap only inside the window', () => {
    expect(marsBudget(0).inWindow).toBe(true);
    expect(marsBudget(60).inWindow).toBe(false);
    expect(marsBudget(60).total).toBeGreaterThan(marsBudget(0).total);
  });
});

describe('Mars windows', () => {
  it('come round every ~26 months', () => {
    const d0 = new Date(Date.UTC(2026, 0, 1));
    const ahead = daysToMarsWindow(d0);
    const next = daysToMarsWindow(new Date(d0.getTime() + (ahead + 5) * 86400000));
    expect(next).toBeGreaterThan(760);
    expect(next).toBeLessThan(785);
  });
  it('opens at the end of 2026, like the real window', () => {
    // the real 2026 Earth→Mars window is around November–December 2026
    const off = marsWindowOffsetDays(new Date(Date.UTC(2026, 10, 15)));
    expect(Math.abs(off)).toBeLessThan(60);
  });
});

describe('launch rules', () => {
  const ksc = LAUNCH_SITES.ksc;
  it('scrubs for wind, storms, thick cloud and cold', () => {
    expect(weatherVerdict({ ...calm, windMax: 20 }, ksc).reasons).toContain('wind');
    expect(weatherVerdict({ ...calm, rainMm: 12 }, ksc).reasons).toContain('storm');
    expect(weatherVerdict({ ...calm, cloudPct: 95 }, ksc).reasons).toContain('clouds');
    expect(weatherVerdict({ ...calm, tempC: 1 }, ksc).reasons).toContain('cold');
    expect(weatherVerdict(calm, ksc).reasons).toEqual([]);
  });
  it('lets Soyuz fly in a Baikonur winter that would scrub SLS', () => {
    const frost = { ...calm, tempC: -20 };
    expect(weatherVerdict(frost, LAUNCH_SITES.baikonur).reasons).toEqual([]);
    expect(weatherVerdict(frost, ksc).reasons).toContain('cold');
  });
  it('refuses a Moon landing in the lunar night', () => {
    const days = Array.from({ length: 30 }, (_, i) => evaluateDay({
      date: new Date(Date.UTC(2026, 5, 1 + i)), site: ksc, target: 'moon', weather: calm, rocketDv: 6000,
    }));
    expect(days.some((d) => d.reasons.includes('dark'))).toBe(true);
    expect(days.some((d) => d.go)).toBe(true);
    const best = bestDay(days);
    expect(days[best].lighting).not.toBe('dark');
  });
  it('could fly Artemis II on its real launch day', () => {
    const p = evaluateDay({ date: ARTEMIS_II.launch, site: ksc, target: 'moon', weather: calm, rocketDv: 6000 });
    expect(p.moon.phase === 'full' || p.moon.phase === 'waxing_gibbous' || p.moon.phase === 'waning_gibbous').toBe(true);
  });
});

describe('budget', () => {
  it('fits each mission\'s recommended preset into its grant', () => {
    for (const p of PRESETS) {
      for (const m of p.bestFor) {
        expect(designCost(presetParts(p))).toBeLessThanOrEqual(missionGrant(m)!);
      }
    }
  });
  it('lets at least one preset reach the Moon and Mars within the grant', () => {
    for (const [m, need] of [['moon', moonBudget(384400).total], ['mars', marsBudget(0).total]] as const) {
      const ok = PRESETS.some((p) => {
        const parts = presetParts(p);
        return computeStats(parts).dvTotal >= need && designCost(parts) <= missionGrant(m)!;
      });
      expect(ok).toBe(true);
    }
  });
});

describe('wind in flight', () => {
  it('peaks near the jet stream and fades above it', () => {
    expect(windAt(0, 10)).toBe(10);
    expect(windAt(11000, 10)).toBeCloseTo(30);
    expect(windAt(30000, 10)).toBe(0);
  });
  it('pushes a climbing rocket downwind', () => {
    const fly = (windEast: number) => {
      const sim = new FlightSim(PRESET_BASIC, { windEast });
      const c = defaultControl();
      c.engineOn = true;
      const ev: SimEvent[] = [];
      for (let i = 0; i < 60 * 40; i++) sim.step(c, ev);
      return sim.telemetry().hspeed;
    };
    expect(fly(0)).toBeCloseTo(0, 3);
    expect(fly(14)).toBeGreaterThan(1);
  });
});
