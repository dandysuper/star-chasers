/**
 * music.ts — the runtime half of the soundtrack: crossfades, ducking, and the
 * victory sting.
 *
 * The theme changes as the player moves between rooms, so the manager has to
 * outlive any single scene. Every sound it owns lives on the game object, not
 * on the scene that happened to start it, which is what lets the builder bed
 * fade out while the flight bed fades in across a scene transition.
 *
 * Browsers refuse to start audio before a gesture. When that happens the
 * request is remembered and replayed on the first click or on the sound
 * system's own 'unlocked' event, so the music arrives as soon as it is allowed
 * rather than never.
 */

import Phaser from 'phaser';
import { state } from '../core/state';
import {
  CROSSFADE_SECONDS,
  TRACKS,
  VICTORY_JINGLE,
  crossfadeLevels,
  isDuckedScene,
  musicVolume,
  trackForScene,
  type TrackId,
} from '../core/themeTracks';

interface MusicBucket {
  beds: Map<TrackId, Phaser.Sound.BaseSound>;
  current: TrackId | null;
  /** Track the player is meant to hear, even if the browser has not allowed
   *  audio yet — the deferral replays this once it unlocks. */
  wanted: TrackId | null;
  ducked: boolean;
  fade?: Phaser.Tweens.Tween;
  jingle?: Phaser.Sound.BaseSound;
}

type MusicGame = Phaser.Game & { __music?: MusicBucket };

/** Phaser's event names, spelled out so this module has no runtime dependency
 *  on the engine and can be unit-tested under node. */
const EVENT_SOUND_UNLOCKED = 'unlocked';
const EVENT_POINTER_DOWN = 'pointerdown';
const EVENT_SOUND_COMPLETE = 'complete';
const EVENT_SOUND_STOP = 'stop';

function bucket(scene: Phaser.Scene): MusicBucket {
  const game = scene.game as MusicGame;
  if (!game.__music) {
    game.__music = { beds: new Map(), current: null, wanted: null, ducked: false };
  }
  return game.__music;
}

function setVolume(sound: Phaser.Sound.BaseSound, value: number): void {
  // setVolume exists on the WebAudio and HTML5 implementations; the base type
  // only guarantees the property, so both paths are used.
  const target = sound as Phaser.Sound.BaseSound & { setVolume?: (v: number) => void };
  try {
    if (typeof target.setVolume === 'function') target.setVolume(value);
    else (sound as unknown as { volume: number }).volume = value;
  } catch {
    // a sound destroyed mid-fade throws here; nothing left to set
  }
}

function stopBed(sound: Phaser.Sound.BaseSound): void {
  try {
    setVolume(sound, 0);
    sound.stop();
  } catch {
    // already gone
  }
}

/** Is this bed actually producing sound right now? */
function isRunning(sound: Phaser.Sound.BaseSound): boolean {
  return sound.isPlaying && !sound.isPaused;
}

/** Kill the running fade, snapping the outgoing bed to silence. */
function cancelFade(scene: Phaser.Scene, b: MusicBucket): void {
  if (b.fade) {
    b.fade.remove();
    b.fade = undefined;
  }
  for (const [id, sound] of b.beds) {
    if (id !== b.current) stopBed(sound);
  }
  void scene;
}

function bedFor(scene: Phaser.Scene, b: MusicBucket, track: TrackId): Phaser.Sound.BaseSound {
  const existing = b.beds.get(track);
  if (existing) return existing;
  const created = scene.sound.add(TRACKS[track].assetKey, { loop: true, volume: 0 });
  b.beds.set(track, created);
  return created;
}

/** Start (or resume) a bed at `volume`, tolerating a locked sound system. */
function startBed(scene: Phaser.Scene, sound: Phaser.Sound.BaseSound, volume: number): void {
  const kick = () => {
    if (!state.music) return;
    try {
      if (sound.isPaused) sound.resume();
      else if (!sound.isPlaying) sound.play();
      setVolume(sound, volume);
    } catch {
      // the sound was destroyed while the system was still locked
    }
  };

  if (scene.sound.locked) {
    scene.sound.once(EVENT_SOUND_UNLOCKED, kick);
    scene.input.once(EVENT_POINTER_DOWN, kick);
    return;
  }
  kick();
}

/**
 * Crossfade from whatever is playing to `next`.
 *
 * The incoming bed starts at zero and rises while the outgoing one falls, both
 * on the same counter, so the total loudness stays roughly level instead of
 * dipping in the middle the way a fade-out-then-fade-in would.
 */
function switchTo(scene: Phaser.Scene, b: MusicBucket, next: TrackId): void {
  const target = musicVolume(next, state.music, b.ducked);

  if (b.current === next) {
    // same room again (a replay, a scene restart): keep the bed running and
    // just correct its level rather than restarting the track from zero
    const sound = bedFor(scene, b, next);
    if (!isRunning(sound)) startBed(scene, sound, target);
    else setVolume(sound, target);
    return;
  }

  const incoming = bedFor(scene, b, next);
  const outgoingId = b.current;
  const outgoing = outgoingId ? b.beds.get(outgoingId) : undefined;
  const fromVolume = outgoing ? musicVolume(outgoingId!, true, b.ducked) : 0;

  cancelFade(scene, b);
  b.current = next;

  if (!state.music) {
    // muted: nothing should be audible, and nothing should be left running
    if (outgoing) stopBed(outgoing);
    b.wanted = next;
    return;
  }

  startBed(scene, incoming, 0);

  const counter = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: CROSSFADE_SECONDS * 1000,
    ease: 'Linear',
    onUpdate: (tween) => {
      const { out, in: inLevel } = crossfadeLevels(fromVolume, target, tween.getValue() ?? 0);
      if (outgoing) setVolume(outgoing, out);
      setVolume(incoming, inLevel);
    },
    onComplete: () => {
      if (outgoing) stopBed(outgoing);
      setVolume(incoming, target);
    },
  });
  b.fade = counter;
  b.wanted = next;
}

/**
 * Play the music this scene belongs to, crossfading from whatever is already
 * on. Call from `create()` of every scene. `ducked` overrides the per-scene
 * default when a scene wants to set it explicitly.
 */
export function playSceneMusic(scene: Phaser.Scene, ducked = isDuckedScene(scene.scene.key)): void {
  const b = bucket(scene);
  b.ducked = ducked;
  switchTo(scene, b, trackForScene(scene.scene.key));
}

/**
 * Play a specific track regardless of the scene — used when a screen wants a
 * different mood from its neighbours (the result screen's victory sting).
 */
export function playTrack(scene: Phaser.Scene, track: TrackId, ducked = false): void {
  const b = bucket(scene);
  b.ducked = ducked;
  switchTo(scene, b, track);
}

/**
 * Apply the player's on/off choice. Called by the sound toggles in the menu and
 * the in-game menu; keeps the current bed in place instead of restarting it.
 */
export function applyMusicSetting(scene: Phaser.Scene, on: boolean, ducked?: boolean): void {
  const b = bucket(scene);
  // falling back to the scene's own default matters: a scene that does not
  // mention ducking must not inherit the duck from the flight screen it came
  // from, or the builder bed comes in at half volume forever after one flight
  b.ducked = ducked ?? isDuckedScene(scene.scene.key);
  state.music = on;
  scene.sound.mute = !on;

  if (!on) {
    if (b.fade) {
      b.fade.remove();
      b.fade = undefined;
    }
    for (const sound of b.beds.values()) stopBed(sound);
    return;
  }

  // turning the sound back on: replay whatever the current scene wants
  switchTo(scene, b, trackForScene(scene.scene.key));
}

/**
 * One-shot victory sting, played over a briefly lowered bed.
 *
 * The theme is pulled down rather than stopped so the win has a bed under it
 * and the screen does not fall silent once the sting ends.
 */
export function playVictoryJingle(scene: Phaser.Scene): void {
  const b = bucket(scene);
  if (!state.music) return;

  const bed = b.current ? b.beds.get(b.current) : undefined;
  const bedLevel = b.current ? musicVolume(b.current, true, b.ducked) : 0;
  if (bed) setVolume(bed, bedLevel * 0.35);

  const jingle = scene.sound.add(VICTORY_JINGLE.assetKey, { volume: 0, loop: false });
  b.jingle = jingle;
  setVolume(jingle, VICTORY_JINGLE.volume);

  const restore = () => {
    if (bed) setVolume(bed, bedLevel);
  };
  jingle.once(EVENT_SOUND_COMPLETE, restore);
  jingle.once(EVENT_SOUND_STOP, restore);

  try {
    jingle.play();
  } catch {
    restore();
  }
}

/**
 * Silence everything this manager owns. Called when leaving to a screen that
 * has no music of its own, and on a full game shutdown.
 */
export function stopAllMusic(scene: Phaser.Scene): void {
  const b = bucket(scene);
  if (b.fade) {
    b.fade.remove();
    b.fade = undefined;
  }
  for (const sound of b.beds.values()) stopBed(sound);
  b.beds.clear();
  try {
    b.jingle?.stop();
  } catch {
    // already finished
  }
  b.jingle = undefined;
  b.current = null;
  b.wanted = null;
}
