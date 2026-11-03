/**
 * minionAudio.ts — playing the driller's and the chemist's recordings.
 *
 * Every call is safe when the recording is missing: the clip simply does not
 * play. That is deliberate. The art and the gameplay must not depend on whether
 * a batch of sound files has been imported yet, so the scenes call these
 * unconditionally and the audio appears the moment `MINION_VOICE`/`MINION_SFX`
 * gain entries.
 *
 * The sound manager is global, not per-scene, so a looping effect has to be
 * stopped by hand — a scene switch will not do it.
 */
import type Phaser from 'phaser';
import { MINION_SFX, MINION_VOICE, type MinionClip } from '../data/minionAudio';

/** Everything lives in one folder so the importer has a single target. */
export const MINION_AUDIO_DIR = 'assets/audio/minions/';

/** Cache key for a clip, namespaced so it can never collide with music. */
export function minionSoundKey(id: string): string {
  return `minion:${id}`;
}

/** Voice sits high in the mix; the mumbles are the joke, they must be heard. */
const VOICE_VOLUME = 0.9;
/** Effects sit under the music bed and the voice. */
const SFX_VOLUME = 0.55;

/** Queue every known clip. Call from a scene's `preload`. */
export function preloadMinionAudio(scene: Phaser.Scene): void {
  for (const clip of [...MINION_VOICE, ...MINION_SFX] as MinionClip[]) {
    scene.load.audio(minionSoundKey(clip.id), MINION_AUDIO_DIR + clip.file);
  }
}

/** True when this recording was actually shipped and loaded. */
export function hasMinionClip(scene: Phaser.Scene, id: string): boolean {
  return scene.cache.audio.exists(minionSoundKey(id));
}

export interface MinionPlayOptions {
  loop?: boolean;
  /** Overrides the default level for its kind. */
  volume?: number;
}

/**
 * Play a clip if it exists; returns the sound so a loop can be stopped.
 *
 * `SoundManager.play` only reports whether it started, so the instance is added
 * first and started by hand — a looping effect has to be stoppable later, and
 * the sound manager is global, so nothing else will stop it for us.
 */
export function playMinion(
  scene: Phaser.Scene,
  id: string,
  options: MinionPlayOptions = {},
): Phaser.Sound.BaseSound | undefined {
  if (!hasMinionClip(scene, id)) return undefined;
  const isSfx = MINION_SFX.some((clip) => clip.id === id);
  try {
    const sound = scene.sound.add(minionSoundKey(id), {
      loop: options.loop ?? false,
      volume: options.volume ?? (isSfx ? SFX_VOLUME : VOICE_VOLUME),
    });
    sound.play();
    return sound;
  } catch {
    // a browser that refuses to start a sound must not break a drill
    return undefined;
  }
}

/** A mumble. No-op when the line has not been recorded. */
export function playMinionVoice(
  scene: Phaser.Scene,
  id: string,
  options: MinionPlayOptions = {},
): Phaser.Sound.BaseSound | undefined {
  return playMinion(scene, id, { volume: VOICE_VOLUME, ...options });
}

/** A physical sound: drill, rock, pouring. */
export function playMinionSfx(
  scene: Phaser.Scene,
  id: string,
  options: MinionPlayOptions = {},
): Phaser.Sound.BaseSound | undefined {
  return playMinion(scene, id, { volume: SFX_VOLUME, ...options });
}

/** Pick one line at random from the ones that actually exist. */
export function playAnyMinionVoice(
  scene: Phaser.Scene,
  ids: string[],
  options: MinionPlayOptions = {},
): Phaser.Sound.BaseSound | undefined {
  const available = ids.filter((id) => hasMinionClip(scene, id));
  if (available.length === 0) return undefined;
  return playMinionVoice(scene, available[Math.floor(Math.random() * available.length)], options);
}

/** Stop a loop started with `playMinionSfx(..., { loop: true })`. */
export function stopMinionSound(sound?: Phaser.Sound.BaseSound): void {
  if (!sound) return;
  try { sound.stop(); } catch { /* already gone */ }
}
