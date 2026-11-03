import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../src/core/state';
import { TRACKS, VICTORY_JINGLE } from '../src/core/themeTracks';
import { applyMusicSetting, playSceneMusic, playVictoryJingle } from '../src/ui/music';

/**
 * These tests drive the real music manager against stand-in Phaser objects.
 * The point is the routing behaviour the player can hear: which bed starts in
 * which room, that the old one actually stops, that muting silences everything,
 * and that a locked sound system does not swallow the request.
 */

class FakeSound {
  key: string;
  volume = 0;
  isPlaying = false;
  isPaused = false;
  playCalls = 0;
  stopCalls = 0;
  private handlers = new Map<string, Array<() => void>>();

  constructor(key: string) {
    this.key = key;
  }

  play(): void {
    this.playCalls += 1;
    this.isPlaying = true;
    this.isPaused = false;
  }

  stop(): void {
    this.stopCalls += 1;
    this.isPlaying = false;
    this.isPaused = false;
  }

  pause(): void {
    this.isPlaying = false;
    this.isPaused = true;
  }

  resume(): void {
    this.isPlaying = true;
    this.isPaused = false;
  }

  setVolume(value: number): void {
    this.volume = value;
  }

  once(event: string, cb: () => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string): void {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, []);
    for (const cb of list) cb();
  }
}

interface TweenConfig {
  from: number;
  to: number;
  onUpdate?: (tween: { getValue: () => number }) => void;
  onComplete?: () => void;
}

function makeScene(key: string) {
  const sounds: FakeSound[] = [];
  const tweens: TweenConfig[] = [];
  const soundEvents = new Map<string, Array<() => void>>();
  const inputEvents = new Map<string, Array<() => void>>();

  const scene = {
    scene: { key },
    game: {} as Record<string, unknown>,
    sound: {
      locked: false,
      mute: false,
      add: (assetKey: string) => {
        const sound = new FakeSound(assetKey);
        sounds.push(sound);
        return sound;
      },
      once: (event: string, cb: () => void) => {
        const list = soundEvents.get(event) ?? [];
        list.push(cb);
        soundEvents.set(event, list);
      },
    },
    input: {
      once: (event: string, cb: () => void) => {
        const list = inputEvents.get(event) ?? [];
        list.push(cb);
        inputEvents.set(event, list);
      },
    },
    tweens: {
      addCounter: (config: TweenConfig) => {
        tweens.push(config);
        return { remove: vi.fn() };
      },
    },
  };

  return {
    scene: scene as unknown as Parameters<typeof playSceneMusic>[0],
    sounds,
    tweens,
    find: (assetKey: string) => sounds.filter((s) => s.key === assetKey),
    fireSoundEvent: (event: string) => {
      const list = soundEvents.get(event) ?? [];
      soundEvents.set(event, []);
      for (const cb of list) cb();
    },
    fireInputEvent: (event: string) => {
      const list = inputEvents.get(event) ?? [];
      inputEvents.set(event, []);
      for (const cb of list) cb();
    },
  };
}

/** Run the crossfade tween that was just created to its end. */
function finishFade(tweens: TweenConfig[]): void {
  const config = tweens[tweens.length - 1];
  config.onUpdate?.({ getValue: () => config.to });
  config.onComplete?.();
}

beforeEach(() => {
  state.music = true;
});

describe('scene music', () => {
  it('starts the menu bed in the menu', () => {
    const { scene, find, tweens } = makeScene('menu');
    playSceneMusic(scene);

    const beds = find(TRACKS.menu.assetKey);
    expect(beds).toHaveLength(1);
    expect(beds[0].playCalls).toBe(1);

    finishFade(tweens);
    expect(beds[0].volume).toBeCloseTo(TRACKS.menu.volume);
  });

  it('gives the builder and the flight their own beds', () => {
    const builder = makeScene('builder');
    playSceneMusic(builder.scene);
    expect(builder.find(TRACKS.builder.assetKey)).toHaveLength(1);

    const flight = makeScene('flight');
    playSceneMusic(flight.scene);
    expect(flight.find(TRACKS.flight.assetKey)).toHaveLength(1);
  });

  it('ducks the flight bed under the gameplay', () => {
    const { scene, find, tweens } = makeScene('flight');
    playSceneMusic(scene);
    finishFade(tweens);
    expect(find(TRACKS.flight.assetKey)[0].volume).toBeCloseTo(TRACKS.flight.volume * 0.5);
  });

  it('crossfades instead of cutting when the room changes', () => {
    const { scene, sounds, find, tweens } = makeScene('menu');
    playSceneMusic(scene);
    finishFade(tweens);

    // the builder arrives with the menu bed still on
    const builderScene = scene as unknown as { scene: { key: string } };
    builderScene.scene.key = 'builder';
    playSceneMusic(scene);

    const menuBed = find(TRACKS.menu.assetKey)[0];
    const builderBed = find(TRACKS.builder.assetKey)[0];
    expect(builderBed).toBeDefined();
    expect(builderBed.playCalls).toBe(1);

    finishFade(tweens);
    expect(menuBed.isPlaying).toBe(false);
    expect(builderBed.volume).toBeCloseTo(TRACKS.builder.volume);
    expect(sounds).toHaveLength(2);
  });

  it('does not restart a bed that is already playing in the same room', () => {
    const { scene, find, tweens } = makeScene('menu');
    playSceneMusic(scene);
    finishFade(tweens);
    playSceneMusic(scene);

    const beds = find(TRACKS.menu.assetKey);
    expect(beds).toHaveLength(1);
    expect(beds[0].playCalls).toBe(1);
  });
});

describe('the sound toggle', () => {
  it('silences every bed and mutes the system when switched off', () => {
    const { scene, sounds, tweens } = makeScene('menu');
    playSceneMusic(scene);
    finishFade(tweens);

    applyMusicSetting(scene, false);

    expect(state.music).toBe(false);
    expect((scene as unknown as { sound: { mute: boolean } }).sound.mute).toBe(true);
    for (const sound of sounds) expect(sound.isPlaying).toBe(false);
  });

  it('brings the current room back when switched on again', () => {
    const { scene, find, tweens } = makeScene('builder');
    applyMusicSetting(scene, false);
    applyMusicSetting(scene, true);
    finishFade(tweens);

    const beds = find(TRACKS.builder.assetKey);
    expect(beds).toHaveLength(1);
    expect(beds[0].isPlaying).toBe(true);
    expect(beds[0].volume).toBeCloseTo(TRACKS.builder.volume);
    expect((scene as unknown as { sound: { mute: boolean } }).sound.mute).toBe(false);
  });

  it('starts nothing at all while muted', () => {
    const { scene, sounds } = makeScene('flight');
    applyMusicSetting(scene, false);
    playSceneMusic(scene);

    for (const sound of sounds) expect(sound.isPlaying).toBe(false);
  });
});

describe('a locked sound system', () => {
  it('waits for the first gesture before playing', () => {
    const { scene, find, fireInputEvent } = makeScene('menu');
    (scene as unknown as { sound: { locked: boolean } }).sound.locked = true;

    playSceneMusic(scene);
    const bed = find(TRACKS.menu.assetKey)[0];
    expect(bed.playCalls).toBe(0);

    fireInputEvent('pointerdown');
    expect(bed.playCalls).toBe(1);
  });
});

describe('the victory sting', () => {
  it('plays the jingle over a lowered bed and restores it afterwards', () => {
    const { scene, find, tweens } = makeScene('result');
    playSceneMusic(scene);
    finishFade(tweens);
    const bed = find(TRACKS.menu.assetKey)[0];

    playVictoryJingle(scene);
    const jingle = find(VICTORY_JINGLE.assetKey)[0];
    expect(jingle).toBeDefined();
    expect(jingle.playCalls).toBe(1);
    expect(jingle.volume).toBeCloseTo(VICTORY_JINGLE.volume);
    expect(bed.volume).toBeLessThan(TRACKS.menu.volume);

    jingle.emit('complete');
    expect(bed.volume).toBeCloseTo(TRACKS.menu.volume);
  });

  it('stays silent when the player has sound off', () => {
    const { scene, find } = makeScene('result');
    state.music = false;
    playVictoryJingle(scene);
    expect(find(VICTORY_JINGLE.assetKey)).toHaveLength(0);
  });
});
