import { describe, it, expect } from 'vitest';
import {
  classifyMinionFile, compareClips, findIdClashes, whoFromFileName,
} from '../src/core/minionNaming';

describe('recognising a minion from a file name', () => {
  it('accepts both the working names and the in-game ids', () => {
    expect(whoFromFileName('grubb_drill_2.wav')).toBe('driller');
    expect(whoFromFileName('driller_v02.mp3')).toBe('driller');
    expect(whoFromFileName('fizz pour.wav')).toBe('chemist');
    expect(whoFromFileName('chemist_fx01.mp3')).toBe('chemist');
  });

  it('accepts the words a batch is likely to come back with', () => {
    expect(whoFromFileName('elixir minion babbling.wav')).toBe('chemist');
    expect(whoFromFileName('miner digging take 3.wav')).toBe('driller');
    expect(whoFromFileName('flask bubble.mp3')).toBe('chemist');
  });

  it('gives up on a file that names nobody', () => {
    expect(whoFromFileName('take_01.wav')).toBeNull();
    expect(whoFromFileName('mixdown.wav')).toBeNull();
  });
});

describe('classifying a file into a clip id', () => {
  it('reads an explicit v/fx marker', () => {
    expect(classifyMinionFile('driller_v02.mp3')?.id).toBe('driller_v02');
    expect(classifyMinionFile('driller_v2.wav')?.id).toBe('driller_v02');
    expect(classifyMinionFile('chemist_fx01.wav')?.id).toBe('chemist_fx01');
  });

  it('falls back to words when there is no marker', () => {
    expect(classifyMinionFile('grubb voice 3.wav')?.id).toBe('driller_v03');
    expect(classifyMinionFile('fizz sfx 2.wav')?.id).toBe('chemist_fx02');
  });

  it('treats an unmarked file as a voice line, numbered by its first digit', () => {
    const clip = classifyMinionFile('Grubb 4.wav');
    expect(clip?.kind).toBe('voice');
    expect(clip?.id).toBe('driller_v04');
  });

  it('never invents an index below one', () => {
    expect(classifyMinionFile('driller voice.wav')?.index).toBe(1);
  });

  it('rejects a file that is not audio', () => {
    expect(classifyMinionFile('driller_v02.txt')).toBeNull();
    expect(classifyMinionFile('driller_v02')).toBeNull();
  });

  it('keeps the original file name so the importer can find it again', () => {
    expect(classifyMinionFile('Grubb Drill 2.WAV')?.file).toBe('Grubb Drill 2.WAV');
  });
});

describe('keeping a batch honest', () => {
  it('sorts driller → chemist, voice → sfx, by index', () => {
    const clips = [
      classifyMinionFile('chemist_fx01.wav')!,
      classifyMinionFile('driller_v02.wav')!,
      classifyMinionFile('driller_v01.wav')!,
      classifyMinionFile('chemist_v01.wav')!,
    ].sort(compareClips);
    expect(clips.map((c) => c.id)).toEqual([
      'driller_v01', 'driller_v02', 'chemist_v01', 'chemist_fx01',
    ]);
  });

  it('reports two files that would land on the same id', () => {
    const clips = [
      classifyMinionFile('driller_v02.wav')!,
      classifyMinionFile('driller v2.wav')!,
    ];
    expect(findIdClashes(clips)).toHaveLength(1);
  });

  it('says nothing when every id is unique', () => {
    const clips = [
      classifyMinionFile('driller_v01.wav')!,
      classifyMinionFile('driller_fx01.wav')!,
    ];
    expect(findIdClashes(clips)).toEqual([]);
  });
});
