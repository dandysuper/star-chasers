/**
 * themeTracks.ts — which piece of music belongs to which room of the game.
 *
 * The soundtrack is three looping beds plus a one-shot sting. Keeping the
 * mapping here, with no Phaser and no audio objects, means the routing can be
 * tested under node and read by anyone wondering "why does the builder sound
 * different from the flight".
 *
 * Volume is deliberately not a single number: the flight screen has a rocket
 * under the player's hands and the spec asks for the music to sit back while
 * they fly, so every track carries its own level and a duck factor is applied
 * on top of it.
 */

/** The looping beds. One plays at a time; switching crossfades. */
export type TrackId = 'menu' | 'builder' | 'flight';

export interface TrackDef {
  id: TrackId;
  /** Phaser audio cache key (loaded in BootScene). */
  assetKey: string;
  /** File path under public/. */
  file: string;
  /** Mix level when the player has sound on and nothing is dictating a duck. */
  volume: number;
}

export const TRACKS: Record<TrackId, TrackDef> = {
  menu: {
    id: 'menu',
    assetKey: 'theme_menu',
    file: 'assets/audio/main_theme.mp3',
    volume: 0.5,
  },
  builder: {
    id: 'builder',
    assetKey: 'theme_builder',
    file: 'assets/audio/builder_theme.mp3',
    volume: 0.45,
  },
  flight: {
    id: 'flight',
    assetKey: 'theme_flight',
    file: 'assets/audio/flight_theme.mp3',
    volume: 0.55,
  },
};

/** One-shot sting played once when a mission is won. Never looped. */
export const VICTORY_JINGLE = {
  assetKey: 'jingle_victory',
  file: 'assets/audio/victory_jingle.mp3',
  volume: 0.7,
} as const;

/** Multiplier applied to a track's own level while it is ducked. */
export const DUCK_FACTOR = 0.5;

/** Seconds for one bed to hand over to the next. */
export const CROSSFADE_SECONDS = 0.9;

/**
 * Scene key → track id.
 *
 * Hub and Result share the menu bed: both are between-mission screens, and
 * restarting the theme on every hop would be jarring. Explore walks the lunar
 * surface, which is a base-side activity here, so it keeps the builder bed.
 */
const SCENE_TRACKS: Record<string, TrackId> = {
  boot: 'menu',
  menu: 'menu',
  hub: 'menu',
  result: 'menu',
  builder: 'builder',
  explore: 'builder',
  flight: 'flight',
};

/** Track for a scene, defaulting to the menu bed for anything unlisted. */
export function trackForScene(sceneKey: string): TrackId {
  return SCENE_TRACKS[sceneKey] ?? 'menu';
}

/** Does this scene's music sit back under the gameplay? */
export function isDuckedScene(sceneKey: string): boolean {
  return sceneKey === 'flight';
}

/**
 * Final volume for a track: 0 when the player muted, half level while ducked,
 * otherwise the track's own mix level.
 */
export function musicVolume(track: TrackId, on: boolean, ducked = false): number {
  if (!on) return 0;
  const base = TRACKS[track].volume;
  return ducked ? base * DUCK_FACTOR : base;
}

/**
 * Volume of a bed that is fading out but still audible.
 *
 * A crossfade is linear in time: at `t` (0..1) the outgoing track is at
 * `from * (1 - t)` and the incoming one at `to * t`. Returned together so the
 * caller never multiplies them out of step.
 */
export function crossfadeLevels(from: number, to: number, t: number): { out: number; in: number } {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return { out: from * (1 - k), in: to * k };
}

/** Every asset the music system needs, so BootScene can load the list. */
export function musicAssetFiles(): { key: string; file: string }[] {
  return [
    ...Object.values(TRACKS).map((track) => ({ key: track.assetKey, file: track.file })),
    { key: VICTORY_JINGLE.assetKey, file: VICTORY_JINGLE.file },
  ];
}
