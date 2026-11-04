/**
 * minionVoice.ts — give a minion a voice.
 *
 * Two sources, in order: a recorded take if the batch has been imported (see
 * tools/minion-audio.ts), otherwise a synthesized mumble built from that
 * character's profile. The fallback matters — the crew talked to themselves in
 * silence for want of an audio file, and a game should not go mute waiting for
 * one.
 *
 * Everything is gated on the player's sound toggle. The audio context is the
 * one Phaser already owns, so the in-game mute, the browser's autoplay rules
 * and the device's own interruptions all keep working.
 */
import type Phaser from 'phaser';
import { state } from './state';
import { hasMinionClip, playMinionVoice } from './minionAudio';
import {
  mumbleDuration, planMumble, VOICE_PROFILES, type VoiceWho,
} from './minionMumble';

/**
 * Recorded lines worth hearing from a character who is just going about their
 * work — the chatter and thinking-aloud takes, never the drill SFX.
 */
const RECORDED: Record<VoiceWho, string[]> = {
  driller: ['driller_v01', 'driller_v09', 'driller_v06'],
  chemist: ['chemist_v01', 'chemist_v10', 'chemist_v05', 'chemist_v08'],
  mechanic: [],
  radio: [],
};

/** Nobody speaks over anybody: one mumble per gap, across the whole scene. */
const MIN_GAP_MS = 3400;

let lastSpokeAt = -Infinity;
let noise: AudioBuffer | null = null;

/**
 * How many times the crew have spoken, split by source. It is the only way to
 * confirm from outside that a minion actually said something, because a
 * synthesised mumble leaves no object behind to inspect.
 */
export const voiceStats = { spoken: 0, synthesized: 0, recorded: 0, blocked: 0 };

// exposed next to window.__state / window.__game, for the same reason: the
// headless checks need to see what happened
if (typeof window !== 'undefined') {
  (window as Window & { __voiceStats?: typeof voiceStats }).__voiceStats = voiceStats;
}

export interface MumbleOptions {
  /** Ignore the global gap, for a line the player directly caused. */
  force?: boolean;
  /** Multiplies the profile's own level. */
  volume?: number;
}

/**
 * Make a minion say something. Safe to call every frame: the gate keeps the
 * crew from chattering over each other.
 */
export function mumble(
  scene: Phaser.Scene, who: VoiceWho, options: MumbleOptions = {},
): void {
  if (!state.music) { voiceStats.blocked += 1; return; }   // the sound toggle wins
  const now = nowMs();
  if (!options.force && now - lastSpokeAt < MIN_GAP_MS) { voiceStats.blocked += 1; return; }

  const available = (RECORDED[who] ?? []).filter((id) => hasMinionClip(scene, id));
  if (available.length > 0) {
    const id = available[Math.floor(Math.random() * available.length)];
    playMinionVoice(scene, id, { volume: options.volume ?? 0.9 });
    lastSpokeAt = now;
    voiceStats.spoken += 1;
    voiceStats.recorded += 1;
    return;
  }

  if (synthesize(scene, who, options.volume)) {
    lastSpokeAt = now;
    voiceStats.spoken += 1;
    voiceStats.synthesized += 1;
  }
}

/** True when this scene can actually make a sound of its own. */
export function canSpeak(scene: Phaser.Scene): boolean {
  return !!contextOf(scene);
}

function contextOf(scene: Phaser.Scene): AudioContext | null {
  const manager = scene.sound as Phaser.Sound.WebAudioSoundManager & { context?: AudioContext };
  return manager?.context ?? null;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** One short white-noise buffer, reused for every consonant click. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const frames = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

/**
 * Render a mumble into the scene's audio context.
 *
 * Each syllable is an oscillator bent from one pitch to another through a
 * band-pass (the vowel), plus a band of noise at the onset (the consonant).
 * That is enough to read as speech-shaped rather than as a tone, and it costs
 * nothing to ship.
 */
function synthesize(scene: Phaser.Scene, who: VoiceWho, volume?: number): boolean {
  const ctx = contextOf(scene);
  if (!ctx) return false;                       // HTML5-audio fallback: no synth
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

  const profile = VOICE_PROFILES[who];
  const plan = planMumble(who);
  if (plan.length === 0) return false;

  const master = ctx.createGain();
  master.gain.value = (volume ?? 1) * profile.gain;
  master.connect(ctx.destination);

  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = profile.formantHz;
  formant.Q.value = profile.q;
  formant.connect(master);

  const start = ctx.currentTime + 0.02;
  let at = start;

  for (const syllable of plan) {
    at += syllable.gap;
    const end = at + syllable.seconds;

    const osc = ctx.createOscillator();
    osc.type = profile.wave;
    osc.frequency.setValueAtTime(syllable.fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, syllable.toHz), Math.max(at + 0.01, end),
    );
    const env = ctx.createGain();
    // exponential ramps cannot touch zero, hence the floor
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(1, at + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env);
    env.connect(formant);
    osc.start(at);
    osc.stop(end + 0.02);

    if (syllable.noise > 0.02) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = profile.formantHz * 1.7;
      band.Q.value = 1.1;
      const click = ctx.createGain();
      click.gain.setValueAtTime(0.0001, at);
      click.gain.exponentialRampToValueAtTime(Math.max(0.001, syllable.noise * 0.4), at + 0.005);
      click.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
      src.connect(band);
      band.connect(click);
      click.connect(master);
      src.start(at);
      src.stop(at + 0.07);
    }

    at = end;
  }

  // one node graph per mumble; drop it once the tail has played out
  const lifeMs = (mumbleDuration(plan) + 0.4) * 1000;
  setTimeout(() => {
    try {
      formant.disconnect();
      master.disconnect();
    } catch {
      // the context may have been closed underneath us
    }
  }, lifeMs);
  return true;
}

/** Test hook: forget the chatter gate. */
export function resetVoiceGate(): void {
  lastSpokeAt = -Infinity;
}
