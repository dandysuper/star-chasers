/**
 * audioState.ts — is sound actually reaching the player right now?
 *
 * The in-game toggle is only half of the answer. A browser silences a page by
 * itself: the audio context stays suspended until the platform lets it run, an
 * incoming call interrupts it on iOS, and a backgrounded tab is muted outright
 * on most phones. When that happens the sound button must show "off" instead of
 * claiming the music is playing.
 *
 * Only states that are actually observable are reported — there is no web API
 * for "the hardware volume is at zero", so that case is left to the player.
 * Everything is guarded because the unit tests import this module under node.
 */

import Phaser from 'phaser';
import { classifySilence, hasPlayed, type SilenceSource } from './audioSignals';

export type { SilenceSource };

interface AudioSessionLike {
  state?: string;
  type?: string;
  addEventListener?: (type: string, listener: () => void) => void;
}

const listeners = new Set<(silenced: boolean) => void>();

let silenceSource: SilenceSource | null = null;
/** Audio has genuinely played once. Until then "suspended" just means the tab
 *  has not been clicked yet, which is not a mute the player should be shown. */
let playedOnce = false;
let watching = false;
let context: AudioContext | null = null;

function doc(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

function session(): AudioSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  return api ?? null;
}

/** True when the platform, not the player, is holding the sound off. */
export function deviceSilenced(): boolean {
  return silenceSource !== null;
}

/** Why the sound is off, for the label under the button. */
export function silenceReason(): SilenceSource | null {
  return silenceSource;
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function onDeviceSilenceChange(listener: (silenced: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(next: SilenceSource | null): void {
  if (next === silenceSource) return;
  silenceSource = next;
  for (const listener of [...listeners]) listener(silenceSource !== null);
}

function evaluate(): SilenceSource | null {
  const contextState = context?.state ?? null;
  if (hasPlayed(contextState)) playedOnce = true;
  return classifySilence({
    contextState,
    sessionState: session()?.state ?? null,
    visibility: doc()?.visibilityState ?? null,
    playedOnce,
  });
}

function refresh(): void {
  publish(evaluate());
}

/** Let game audio follow the media volume instead of the ringer switch.
 *
 *  On iOS the default "ambient" session type is silenced by the hardware mute
 *  switch, which makes a game that ships its own sound setting look broken.
 *  Asking for the playback session routes it through the media channel the same
 *  way a video app does, and is a no-op on every other platform. */
export function useMediaAudioSession(): void {
  const api = session();
  if (!api) return;
  try {
    api.type = 'playback';
  } catch {
    // older Safari exposes the object but not a writable type
  }
}

/** Ask the audio context to come back. Browsers only allow this from a real
 *  gesture, so it is called from a click, never on a timer. */
export function resumeAudio(): void {
  const ctx = context;
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** Start watching. Idempotent; the first scene to call it wins. */
export function watchAudioOutput(scene: Phaser.Scene): void {
  if (watching) return;
  watching = true;

  const manager = scene.sound as Phaser.Sound.WebAudioSoundManager & { context?: AudioContext };
  context = manager.context ?? null;
  context?.addEventListener('statechange', refresh);

  // iOS 17+ reports interruption explicitly; older versions only flip the
  // context, which the statechange listener above already covers.
  session()?.addEventListener?.('statechange', refresh);

  doc()?.addEventListener('visibilitychange', refresh);
  refresh();
}
