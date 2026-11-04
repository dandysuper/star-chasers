import { describe, it, expect } from 'vitest';
import {
  mumbleDuration, planMumble, VOICE_PROFILES, type VoiceWho,
} from '../src/core/minionMumble';

const WHOS: VoiceWho[] = ['driller', 'chemist', 'mechanic', 'radio'];

/** A fixed sequence, so a layout can be asserted exactly. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('each minion has its own voice', () => {
  it('covers all four crew members', () => {
    for (const who of WHOS) expect(VOICE_PROFILES[who]).toBeDefined();
  });

  it('keeps the driller far below the chemist — they must be told apart by ear', () => {
    expect(VOICE_PROFILES.driller.baseHz).toBeLessThan(VOICE_PROFILES.chemist.baseHz * 0.5);
  });

  it('gives every voice a distinct pitch, wave, or colour', () => {
    const signatures = WHOS.map((who) => {
      const p = VOICE_PROFILES[who];
      return `${Math.round(p.baseHz)}|${p.wave}|${Math.round(p.formantHz)}`;
    });
    expect(new Set(signatures).size).toBe(WHOS.length);
  });

  it('keeps every profile at a sane level — audible, never clipping', () => {
    for (const who of WHOS) {
      const gain = VOICE_PROFILES[who].gain;
      expect(gain).toBeGreaterThan(0.05);
      expect(gain).toBeLessThan(0.3);
    }
  });
});

describe('laying out a mumble', () => {
  it('always says something, within the profile’s syllable count', () => {
    for (const who of WHOS) {
      const [min, max] = VOICE_PROFILES[who].syllables;
      for (let run = 0; run < 40; run += 1) {
        const plan = planMumble(who);
        expect(plan.length).toBeGreaterThanOrEqual(min);
        expect(plan.length).toBeLessThanOrEqual(max);
      }
    }
  });

  it('never produces a pitch below hearing or above a shriek', () => {
    for (const who of WHOS) {
      for (const syllable of planMumble(who)) {
        expect(syllable.fromHz).toBeGreaterThanOrEqual(40);
        expect(syllable.toHz).toBeGreaterThanOrEqual(40);
        expect(syllable.fromHz).toBeLessThan(1200);
      }
    }
  });

  it('falls for the driller and rises for the chemist', () => {
    const driller = planMumble('driller', seeded([0.5]));
    const chemist = planMumble('chemist', seeded([0.5]));
    expect(driller[0].toHz).toBeLessThan(driller[0].fromHz);
    expect(chemist[0].toHz).toBeGreaterThan(chemist[0].fromHz);
  });

  it('leaves no gap before the first syllable, and a breath between the rest', () => {
    const plan = planMumble('mechanic', seeded([0.9, 0.2, 0.7]));
    expect(plan[0].gap).toBe(0);
    for (const syllable of plan.slice(1)) expect(syllable.gap).toBeGreaterThan(0);
  });

  it('is repeatable when the random source is pinned', () => {
    const a = planMumble('chemist', seeded([0.3, 0.6, 0.1, 0.8]));
    const b = planMumble('chemist', seeded([0.3, 0.6, 0.1, 0.8]));
    expect(a).toEqual(b);
  });

  it('varies between utterances with a live random source', () => {
    const shapes = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const plan = planMumble('radio');
      shapes.add(plan.map((s) => s.fromHz.toFixed(1)).join(','));
    }
    // four minions repeating one identical sample would read as a bug
    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe('how long a mumble lasts', () => {
  it('is a fraction of a second, not a monologue', () => {
    for (const who of WHOS) {
      const seconds = mumbleDuration(planMumble(who));
      expect(seconds).toBeGreaterThan(0.05);
      expect(seconds).toBeLessThan(1.5);
    }
  });

  it('is zero for an empty plan', () => {
    expect(mumbleDuration([])).toBe(0);
  });
});
