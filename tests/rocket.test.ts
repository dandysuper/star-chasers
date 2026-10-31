import { describe, it, expect } from 'vitest';
import { computeStats, splitStages } from '../src/physics/rocket';
import { PRESET_BASIC } from '../src/data/parts';
import { G0 } from '../src/data/bodies';

describe('rocket stats (spec §3)', () => {
  it('default rocket ≈ 1770 kg, TWR ≈ 3.0, Δv ≈ 2.6 km/s', () => {
    const s = computeStats(PRESET_BASIC);
    expect(Math.round(s.mass)).toBe(1770);
    // TWR = F1(asl)/(m0·g0); spark asl = 60000·280/320 = 52500 N
    expect(s.twr).toBeCloseTo(52500 / (1770 * G0), 2);
    expect(s.twr).toBeGreaterThan(2.9);
    // Δv = isp·g0·ln(m0/m1) = 320·9.80665·ln(1770/770)
    const dv = 320 * G0 * Math.log(1770 / 770);
    expect(s.dvTotal).toBeCloseTo(dv, 1);
    expect(s.dvTotal).toBeGreaterThan(2500);
    expect(s.dvTotal).toBeLessThan(2800);
  });

  it('TWR < 1 is blocking', () => {
    // bull engine (heavy) under a tiny tank → still heavy? use spark + tank_l
    const s = computeStats(['nose_cone', 'probe_core', 'tank_l', 'engine_spark']);
    // mass = 100+100+500+2000+300 = 3000; spark asl 52500; TWR=1.78 → fine.
    // heavier: two big tanks
    const heavy = computeStats(['nose_cone', 'probe_core', 'tank_l', 'tank_l', 'engine_spark']);
    expect(heavy.twr).toBeLessThan(1);
    expect(heavy.blocking).toBe(true);
    expect(heavy.warnings.some((w) => w.key === 'warn.twr_low')).toBe(true);
  });

  it('no engine → warning + blocking', () => {
    const s = computeStats(['nose_cone', 'probe_core', 'tank_s']);
    expect(s.blocking).toBe(true);
    expect(s.warnings.some((w) => w.key === 'warn.no_engine')).toBe(true);
  });

  it('no control → warning', () => {
    const s = computeStats(['nose_cone', 'tank_s', 'engine_spark']);
    expect(s.warnings.some((w) => w.key === 'warn.no_control')).toBe(true);
  });

  it('engine not under tank → warning', () => {
    const s = computeStats(['nose_cone', 'probe_core', 'engine_spark']);
    expect(s.warnings.some((w) => w.key === 'warn.engine_attach')).toBe(true);
    expect(s.blocking).toBe(true);
  });

  it('decoupler splits stages; engine in stage 1 gets own Δv', () => {
    // top stage: probe+tank_s+whisper; bottom: tank_m+spark; decoupler between
    const parts = ['nose_cone', 'probe_core', 'tank_s', 'engine_whisper', 'decoupler', 'tank_m', 'engine_spark'];
    const groups = splitStages(parts);
    // top-down groups: [nose,probe,tank_s,whisper] then [decoupler,tank_m,spark]
    expect(groups.length).toBe(2);
    expect(groups[1][0]).toBe('decoupler');
    const s = computeStats(parts);
    expect(s.stages.length).toBe(2);
    // stage 1 = bottom group
    expect(s.stages[0].parts).toEqual(['decoupler', 'tank_m', 'engine_spark']);
    expect(s.stages[0].hasEngine).toBe(true);
    expect(s.stages[1].hasEngine).toBe(true);
    expect(s.dvTotal).toBeGreaterThan(s.stages[0].dv); // two stages add up
  });

  it('stability: no nose and no fins → wobbly', () => {
    const wobbly = computeStats(['probe_core', 'tank_s', 'engine_spark']);
    expect(wobbly.stable).toBe(false);
    const withNose = computeStats(['nose_cone', 'probe_core', 'tank_s', 'engine_spark']);
    expect(withNose.stable).toBe(true);
    const withFins = computeStats(['probe_core', 'tank_s', 'fins', 'engine_spark']);
    expect(withFins.stable).toBe(true);
  });
});
