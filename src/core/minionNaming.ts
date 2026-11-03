/**
 * minionNaming.ts — turn a generated audio file into an id the game can use.
 *
 * Sound models hand back files with whatever name they like ("Grubb drill 2
 * FINAL.wav", "fizz_pour.mp3"). The game wants a stable id from the prompt
 * sheet: `driller_v02`, `chemist_fx01`. This is the whole translation, kept
 * pure so the importer and the tests can both use it without Phaser.
 */

export type MinionWho = 'driller' | 'chemist';
export type MinionKind = 'voice' | 'sfx';

export interface MinionClipRef {
  /** `driller_v02`, `chemist_fx01` — the id from MINION_SOUND_PROMPTS.md. */
  id: string;
  who: MinionWho;
  kind: MinionKind;
  /** 1-based index within its kind, for ordering the manifest. */
  index: number;
  /** File name including extension, as it arrived from the batch. */
  file: string;
}

const VOICE_HINTS = /(voice|say|talk|mumble|speak|line)/;
const SFX_HINTS = /(sfx|fx|sound|noise|effect)/;
/** A `v2`-style marker is a voice take; `fx2` is an effect. */
const VOICE_NUMBER = /(?:^|[_\-\s])v(\d{1,2})(?![0-9])/;
const SFX_NUMBER = /(?:^|[_\-\s])(?:fx|s)(\d{1,2})(?![0-9])/;
const ANY_NUMBER = /(\d{1,2})/;

/**
 * Guess which minion a file belongs to from its name.
 *
 * Both the working names from the prompt sheet (Grubb / Fizz) and the in-game
 * ids (driller / chemist) are accepted, plus the obvious synonyms, so a file
 * exported as "elixir minion pour.wav" still lands on the chemist.
 */
export function whoFromFileName(fileName: string): MinionWho | null {
  const name = fileName.toLowerCase();
  // the driller test runs first: "drill" appears in the driller's effect names,
  // and no chemist file is ever called that
  if (/(driller|grubb|miner|dig|drill)/.test(name)) return 'driller';
  if (/(chemist|fizz|elixir|brew|flask|potion)/.test(name)) return 'chemist';
  return null;
}

/**
 * Classify a file into a clip reference, or null when it cannot be placed.
 *
 * The kind is decided by the strongest signal available: an explicit `_vNN` /
 * `_fxNN` marker, then a word like "voice" or "sfx", then, failing both, the
 * file is treated as a voice line — voices are most of a batch.
 */
export function classifyMinionFile(fileName: string): MinionClipRef | null {
  const who = whoFromFileName(fileName);
  if (!who) return null;

  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext || !['mp3', 'wav', 'ogg', 'm4a', 'webm'].includes(ext)) return null;

  const stem = fileName.slice(0, fileName.length - ext.length - 1).toLowerCase();

  let kind: MinionKind;
  let index: number;

  const voiceHit = stem.match(VOICE_NUMBER);
  const sfxHit = stem.match(SFX_NUMBER);
  if (voiceHit) {
    kind = 'voice';
    index = Number(voiceHit[1]);
  } else if (sfxHit) {
    kind = 'sfx';
    index = Number(sfxHit[1]);
  } else if (SFX_HINTS.test(stem) && !VOICE_HINTS.test(stem)) {
    kind = 'sfx';
    index = Number(stem.match(ANY_NUMBER)?.[1] ?? 1);
  } else {
    kind = 'voice';
    index = Number(stem.match(ANY_NUMBER)?.[1] ?? 1);
  }

  if (!Number.isFinite(index) || index < 1) index = 1;
  const tag = kind === 'voice' ? 'v' : 'fx';
  return { id: `${who}_${tag}${String(index).padStart(2, '0')}`, who, kind, index, file: fileName };
}

/** Sort key so the generated manifest is stable between runs. */
export function compareClips(a: MinionClipRef, b: MinionClipRef): number {
  if (a.who !== b.who) return a.who === 'driller' ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'voice' ? -1 : 1;
  return a.index - b.index;
}

/**
 * Two files mapping to the same id (a re-export, or "drill 1" and "drill 01")
 * must not silently overwrite each other — the caller reports a clash instead.
 */
export function findIdClashes(clips: MinionClipRef[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const clip of clips) {
    const previous = seen.get(clip.id);
    if (previous) clashes.push(`${clip.id}: ${previous} vs ${clip.file}`);
    else seen.set(clip.id, clip.file);
  }
  return clashes;
}
