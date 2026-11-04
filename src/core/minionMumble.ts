/**
 * minionMumble.ts — what a minion's voice *is*, as pure data.
 *
 * The crew do not speak any real language: they mumble in the invented ones
 * from MINION_SOUND_PROMPTS.md. Until recorded lines exist, the game voices
 * them itself, and this is the part that decides the shape of a mumble — how
 * many syllables, how far the pitch drifts, how ragged the consonants are. It
 * is kept apart from the Web Audio player so the character of each voice can be
 * tested without an audio context.
 */

export type VoiceWho = 'mechanic' | 'driller' | 'radio' | 'chemist';

export interface VoiceProfile {
  /** Centre pitch of the voice, Hz. */
  baseHz: number;
  /** Random deviation applied per syllable, Hz. */
  spreadHz: number;
  /** Pitch multiplier reached by the end of a syllable: <1 falls, >1 rises. */
  glide: number;
  /** One syllable's duration, inclusive range in seconds. */
  syllableSec: [number, number];
  /** How many syllables in one mumble, inclusive. */
  syllables: [number, number];
  /** Oscillator character. */
  wave: OscillatorType;
  /** Vowel colour: the band-pass the voice is shaped through, Hz. */
  formantHz: number;
  /** Band-pass sharpness — higher is more nasal and more distinct. */
  q: number;
  /** How much of a consonant click rides on each syllable, 0..1. */
  noise: number;
  /** Peak level, linear. */
  gain: number;
}

/**
 * Four voices that have to be distinguishable by ear in one room.
 *
 * Grubb (driller) sits far below the others with a slow, falling phrase; Fizz
 * (chemist) is high, quick and rises on every syllable — the two shapes are
 * what make them sound like different creatures even though neither says a
 * word. The mechanic is the in-between, and the radio scout is thin and hissy,
 * which reads as a speaker rather than a throat.
 */
export const VOICE_PROFILES: Record<VoiceWho, VoiceProfile> = {
  driller: {
    baseHz: 96,
    spreadHz: 10,
    glide: 0.82,
    syllableSec: [0.11, 0.17],
    syllables: [2, 4],
    wave: 'sawtooth',
    formantHz: 420,
    q: 3.2,
    noise: 0.5,
    gain: 0.16,
  },
  chemist: {
    baseHz: 246,
    spreadHz: 22,
    glide: 1.18,
    syllableSec: [0.06, 0.10],
    syllables: [3, 6],
    wave: 'triangle',
    formantHz: 1250,
    q: 4.5,
    noise: 0.34,
    gain: 0.11,
  },
  mechanic: {
    baseHz: 148,
    spreadHz: 14,
    glide: 0.94,
    syllableSec: [0.08, 0.13],
    syllables: [2, 5],
    wave: 'square',
    formantHz: 700,
    q: 3.8,
    noise: 0.42,
    gain: 0.13,
  },
  radio: {
    baseHz: 198,
    spreadHz: 26,
    glide: 1.06,
    syllableSec: [0.07, 0.12],
    syllables: [2, 5],
    wave: 'sine',
    formantHz: 1650,
    q: 5.5,
    noise: 0.72,
    gain: 0.1,
  },
};

export interface Syllable {
  /** Pitch at the start of the syllable, Hz. */
  fromHz: number;
  /** Pitch at the end of the syllable, Hz. */
  toHz: number;
  /** How long the voiced part lasts, seconds. */
  seconds: number;
  /** Consonant click level for this syllable, 0..1. */
  noise: number;
  /** Silence before it, seconds — the rhythm of speech rather than a tone. */
  gap: number;
}

/**
 * Lay out one mumble.
 *
 * `rand` is injected so a test can pin the sequence; the default keeps each
 * utterance slightly different, which is what stops four minions sounding like
 * four copies of one sample.
 */
export function planMumble(who: VoiceWho, rand: () => number = Math.random): Syllable[] {
  const p = VOICE_PROFILES[who];
  const count = pickInt(p.syllables[0], p.syllables[1], rand);
  const out: Syllable[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = p.baseHz + (rand() * 2 - 1) * p.spreadHz;
    // the glide compounds per syllable a little, so a phrase has a direction
    const bend = 1 + (p.glide - 1) * (0.7 + rand() * 0.6);
    out.push({
      fromHz: Math.max(40, from),
      toHz: Math.max(40, from * bend),
      seconds: p.syllableSec[0] + rand() * (p.syllableSec[1] - p.syllableSec[0]),
      noise: p.noise * (0.55 + rand() * 0.45),
      // a short breath between syllables; none before the first
      gap: i === 0 ? 0 : 0.02 + rand() * 0.05,
    });
  }
  return out;
}

/** How long one mumble takes, in seconds, including the gaps. */
export function mumbleDuration(syllables: Syllable[]): number {
  return syllables.reduce((t, s) => t + s.gap + s.seconds, 0);
}

function pickInt(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
