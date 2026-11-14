import { describe, it, expect } from 'vitest';
import { LAB_SAMPLES, ELEMENTS, labSamplesFor, spectrumMatch, labStars, TUTORIAL_SAMPLE } from '../src/data/labSamples';
import { PLANETS, PLANET_ORDER } from '../src/data/planets';

describe('sample lab data', () => {
  it('has a lab entry for every sample on every planet', () => {
    for (const p of PLANET_ORDER) {
      const ids = labSamplesFor(p).map((s) => s.id).sort();
      expect(ids).toEqual(PLANETS[p].samples.map((s) => s.id).sort());
    }
  });
  it('gives every sample a spectrum that tells it apart from the others on its planet', () => {
    for (const p of PLANET_ORDER) {
      const keys = labSamplesFor(p).map((s) => [...s.elements].sort().join());
      // ice appears once per planet; basalt and the rest differ
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it('keeps every emission line inside the plotted range and apart from the others', () => {
    const lines = ELEMENTS.flatMap((e) => e.lines);
    for (const nm of lines) expect(nm > 260 && nm < 860).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });
  it('only accepts the exact element set', () => {
    const s = LAB_SAMPLES.find((x) => x.id === 'mars_hematite')!;
    expect(spectrumMatch(s, new Set(['Fe']))).toEqual({ missing: ['O'], extra: [] });
    expect(spectrumMatch(s, new Set(['Fe', 'O', 'Na']))).toEqual({ missing: [], extra: ['Na'] });
    expect(spectrumMatch(s, new Set(['Fe', 'O']))).toEqual({ missing: [], extra: [] });
  });
  it('has a tutorial sample on each planet and scores stars', () => {
    for (const p of PLANET_ORDER) expect(labSamplesFor(p).some((s) => s.id === TUTORIAL_SAMPLE[p])).toBe(true);
    expect(labStars(0, 60, 150)).toBe(3);
    expect(labStars(3, 60, 150)).toBe(2);
    expect(labStars(6, 140, 150)).toBe(1);
  });
});
