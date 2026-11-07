import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { state } from '../src/core/state';
import { canSpeak, mumble, resetVoiceGate, voiceStats } from '../src/core/minionVoice';
import { hasMinionClip, playMinionVoice } from '../src/core/minionAudio';

vi.mock('../src/core/minionAudio', () => ({
  hasMinionClip: vi.fn(() => false),
  playMinionVoice: vi.fn(),
}));

function audioScene(contextState = 'running') {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => ({
    connect: vi.fn(), disconnect: vi.fn(), gain: param(), frequency: param(), Q: param(),
    start: vi.fn(), stop: vi.fn(),
  });
  const destination = {};
  const context = {
    state: contextState, currentTime: 0, sampleRate: 44100, destination: {},
    createGain: vi.fn(node), createBiquadFilter: vi.fn(node),
    createOscillator: vi.fn(node), createBufferSource: vi.fn(node),
    createBuffer: vi.fn(() => ({ sampleRate: 44100, getChannelData: () => new Float32Array(5292) })),
    resume: vi.fn(),
  };
  const sound = { context, destination, locked: false, mute: false };
  return { scene: { sound } as unknown as Phaser.Scene, sound, context, destination };
}

const originalMusic = state.music;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(hasMinionClip).mockReturnValue(false);
  resetVoiceGate();
  state.music = true;
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  state.music = originalMusic;
});

describe('minion playback, not just attempted speech', () => {
  it.each(['suspended', 'interrupted', 'closed'])('does not consume a greeting while %s', (status) => {
    const { scene, context } = audioScene(status);
    const before = voiceStats.spoken;
    expect(mumble(scene, 'radio', { force: true })).toBe(false);
    expect(context.createGain).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();
    expect(voiceStats.spoken).toBe(before);
    context.state = 'running';
    expect(mumble(scene, 'radio', { force: true })).toBe(true);
    expect(voiceStats.spoken).toBe(before + 1);
  });

  it('routes all four voices through the Phaser mute/volume bus, with an audible body', () => {
    const { scene, context, destination } = audioScene();
    for (const who of ['mechanic', 'driller', 'radio', 'chemist'] as const) {
      expect(mumble(scene, who, { force: true })).toBe(true);
    }
    const masters = context.createGain.mock.results.map((r) => r.value)
      .filter((n) => n.connect.mock.calls.some(([to]: unknown[]) => to === destination));
    expect(masters).toHaveLength(4);
    for (const master of masters) {
      expect(master.connect.mock.calls[0][0]).toBe(destination);
      expect(master.connect.mock.calls[0][0]).not.toBe(context.destination);
    }
    // Each syllable feeds both the coloured formant and the audible body.
    expect(context.createOscillator.mock.results[0].value.connect.mock.calls[0][0].connect).toHaveBeenCalledTimes(2);
  });

  it('respects both the player toggle and the sound manager mute/lock', () => {
    const { scene, sound, context } = audioScene();
    state.music = false;
    expect(mumble(scene, 'driller', { force: true })).toBe(false);
    state.music = true;
    sound.mute = true;
    expect(canSpeak(scene)).toBe(false);
    expect(mumble(scene, 'driller', { force: true })).toBe(false);
    sound.mute = false;
    sound.locked = true;
    expect(mumble(scene, 'driller', { force: true })).toBe(false);
    expect(context.createGain).not.toHaveBeenCalled();
  });

  it('spaces ambient chatter but allows a player greeting', () => {
    const { scene } = audioScene();
    expect(mumble(scene, 'mechanic')).toBe(true);
    expect(mumble(scene, 'chemist')).toBe(false);
    expect(mumble(scene, 'chemist', { force: true })).toBe(true);
    vi.advanceTimersByTime(3400);
    expect(mumble(scene, 'radio')).toBe(true);
  });

  it('uses a recording when it actually starts', () => {
    const { scene, context } = audioScene();
    vi.mocked(hasMinionClip).mockReturnValue(true);
    vi.mocked(playMinionVoice).mockReturnValue({} as Phaser.Sound.BaseSound);
    const before = voiceStats.recorded;
    expect(mumble(scene, 'driller')).toBe(true);
    expect(voiceStats.recorded).toBe(before + 1);
    expect(context.createOscillator).not.toHaveBeenCalled();
  });

  it('falls back to a mumble if a recording fails to start', () => {
    const { scene, context } = audioScene();
    vi.mocked(hasMinionClip).mockReturnValue(true);
    vi.mocked(playMinionVoice).mockReturnValue(undefined);
    const before = voiceStats.recorded;
    expect(mumble(scene, 'chemist')).toBe(true);
    expect(voiceStats.recorded).toBe(before);
    expect(context.createOscillator).toHaveBeenCalled();
  });
});
