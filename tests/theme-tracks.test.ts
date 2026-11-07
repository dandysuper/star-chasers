import { describe, it, expect } from 'vitest';
import {
  CROSSFADE_SECONDS,
  DUCK_FACTOR,
  TRACKS,
  VICTORY_JINGLE,
  crossfadeLevels,
  isDuckedScene,
  musicAssetFiles,
  musicVolume,
  trackForScene,
} from '../src/core/themeTracks';

describe('theme track routing', () => {
  it('gives every room of the game a track', () => {
    expect(trackForScene('menu')).toBe('menu');
    expect(trackForScene('hub')).toBe('menu');
    expect(trackForScene('result')).toBe('menu');
    expect(trackForScene('builder')).toBe('builder');
    expect(trackForScene('explore')).toBe('builder');
    expect(trackForScene('flight')).toBe('flight');
  });

  it('falls back to the menu bed for an unknown scene', () => {
    expect(trackForScene('something-that-does-not-exist')).toBe('menu');
  });

  it('only ducks the flight screen', () => {
    expect(isDuckedScene('flight')).toBe(true);
    for (const key of ['menu', 'hub', 'builder', 'explore', 'result']) {
      expect(isDuckedScene(key)).toBe(false);
    }
  });

  it('each track points at its own file', () => {
    const files = new Set(Object.values(TRACKS).map((t) => t.file));
    expect(files.size).toBe(Object.values(TRACKS).length);
    expect(TRACKS.builder.file).toBe('assets/audio/builder_theme.mp3');
    expect(TRACKS.flight.file).toBe('assets/audio/flight_theme.mp3');
    expect(TRACKS.menu.file).toBe('assets/audio/main_theme.mp3');
  });
});

describe('music volume', () => {
  it('is silent when the player muted', () => {
    expect(musicVolume('menu', false)).toBe(0);
    expect(musicVolume('flight', false, true)).toBe(0);
  });

  it('plays the track at its own level when nothing is ducked', () => {
    expect(musicVolume('menu', true)).toBe(TRACKS.menu.volume);
    expect(musicVolume('builder', true)).toBe(TRACKS.builder.volume);
  });

  it('halves the level while ducked', () => {
    expect(musicVolume('flight', true, true)).toBeCloseTo(TRACKS.flight.volume * DUCK_FACTOR);
    expect(musicVolume('flight', true, true)).toBeLessThan(musicVolume('flight', true, false));
  });
});

describe('crossfade', () => {
  it('starts with the outgoing bed full and the incoming silent', () => {
    const { out, in: incoming } = crossfadeLevels(0.5, 0.4, 0);
    expect(out).toBeCloseTo(0.5);
    expect(incoming).toBeCloseTo(0);
  });

  it('ends with the outgoing silent and the incoming full', () => {
    const { out, in: incoming } = crossfadeLevels(0.5, 0.4, 1);
    expect(out).toBeCloseTo(0);
    expect(incoming).toBeCloseTo(0.4);
  });

  it('meets in the middle without a dip in total loudness', () => {
    const { out, in: incoming } = crossfadeLevels(0.4, 0.4, 0.5);
    expect(out).toBeCloseTo(0.2);
    expect(incoming).toBeCloseTo(0.2);
    expect(out + incoming).toBeCloseTo(0.4);
  });

  it('clamps t outside 0..1', () => {
    expect(crossfadeLevels(1, 1, -3)).toEqual({ out: 1, in: 0 });
    expect(crossfadeLevels(1, 1, 9)).toEqual({ out: 0, in: 1 });
  });

  it('takes under two seconds so scene changes are not drifting', () => {
    expect(CROSSFADE_SECONDS).toBeGreaterThan(0);
    expect(CROSSFADE_SECONDS).toBeLessThan(2);
  });
});

describe('music assets', () => {
  it('lists every bed plus the victory jingle exactly once', () => {
    const assets = musicAssetFiles();
    const keys = assets.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(4);
    expect(keys).toContain(TRACKS.menu.assetKey);
    expect(keys).toContain(TRACKS.builder.assetKey);
    expect(keys).toContain(TRACKS.flight.assetKey);
    expect(keys).toContain(VICTORY_JINGLE.assetKey);
  });
});
