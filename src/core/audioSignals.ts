/**
 * audioSignals.ts — the pure part of "is the sound actually reaching the
 * player": a mapping from what the platform reports to a verdict.
 *
 * Kept apart from audioState.ts, which owns the listeners and the audio
 * context, so the decision itself can be unit-tested without a browser or a
 * Phaser instance.
 */

export type SilenceSource = 'interrupted' | 'suspended' | 'hidden';

export interface AudioSignals {
  /** `AudioContext.state` — 'running' | 'suspended' | 'closed' | null. */
  contextState: string | null;
  /** `navigator.audioSession.state` on iOS 17+ — 'active' | 'interrupted' | … */
  sessionState: string | null;
  /** `document.visibilityState` — 'visible' | 'hidden'. */
  visibility: string | null;
  /** Audio has genuinely played at least once since the page loaded. */
  playedOnce: boolean;
}

/**
 * Why the sound is off, or null when nothing is holding it.
 *
 * Order matters. An interrupted session outranks everything: on iOS that is an
 * incoming call, and the context often still claims to be running. The
 * `playedOnce` gate is what keeps a freshly loaded page from showing "muted"
 * just because the browser has not granted audio yet — that is not a mute the
 * player did anything about.
 */
export function classifySilence(signals: AudioSignals): SilenceSource | null {
  if (signals.sessionState === 'interrupted') return 'interrupted';
  if (!signals.playedOnce) return null;
  if (signals.contextState === 'suspended') return 'suspended';
  if (signals.visibility === 'hidden') return 'hidden';
  return null;
}

/** True when this context state proves audio has run at least once. */
export function hasPlayed(contextState: string | null): boolean {
  return contextState === 'running';
}
