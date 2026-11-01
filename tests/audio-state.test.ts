import { describe, it, expect } from 'vitest';
import { classifySilence, hasPlayed, type AudioSignals } from '../src/core/audioSignals';

const base: AudioSignals = {
  contextState: 'running',
  sessionState: 'active',
  visibility: 'visible',
  playedOnce: true,
};

describe('classifySilence', () => {
  it('reports nothing while audio is running and the tab is visible', () => {
    expect(classifySilence(base)).toBeNull();
  });

  it('does not call a page muted before its audio has ever played', () => {
    // A freshly loaded tab has a suspended context purely because the browser
    // waits for a gesture; showing "muted" there would be wrong.
    expect(classifySilence({ ...base, contextState: 'suspended', playedOnce: false })).toBeNull();
  });

  it('reports a suspended context once audio has played', () => {
    expect(classifySilence({ ...base, contextState: 'suspended' })).toBe('suspended');
  });

  it('reports a hidden tab once audio has played', () => {
    expect(classifySilence({ ...base, visibility: 'hidden' })).toBe('hidden');
  });

  it('lets an iOS interruption outrank a context that still claims to run', () => {
    expect(classifySilence({ ...base, sessionState: 'interrupted' })).toBe('interrupted');
  });

  it('reports an interruption even before the first playback', () => {
    expect(classifySilence({
      ...base, sessionState: 'interrupted', playedOnce: false,
    })).toBe('interrupted');
  });

  it('prefers a suspension over a hidden tab', () => {
    expect(classifySilence({ ...base, contextState: 'suspended', visibility: 'hidden' }))
      .toBe('suspended');
  });

  it('treats a missing context as nothing to report', () => {
    expect(classifySilence({ ...base, contextState: null, playedOnce: false })).toBeNull();
  });
});

describe('hasPlayed', () => {
  it('counts a running context as proof of playback', () => {
    expect(hasPlayed('running')).toBe(true);
  });

  it('does not count suspended or missing contexts', () => {
    expect(hasPlayed('suspended')).toBe(false);
    expect(hasPlayed(null)).toBe(false);
  });
});
