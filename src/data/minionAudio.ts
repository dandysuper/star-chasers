/**
 * minionAudio.ts — which minion recordings exist on disk right now.
 *
 * GENERATED FILE. Rewritten by `npx vite-node tools/minion-audio.ts <folder>`,
 * which copies the recordings into `public/assets/audio/minions/` and lists
 * them here. Do not hand-edit: the next import overwrites it.
 *
 * Both lists are empty until a batch is imported. The game treats an empty list
 * as "no voices" — nothing is loaded, nothing 404s, and the scenes play exactly
 * as they did before any of this existed.
 */

export interface MinionClip {
  /** `driller_v02`, `chemist_fx01` — the id the scenes ask for. */
  id: string;
  /** File name inside `public/assets/audio/minions/`. */
  file: string;
}

/** Mumbled speech, one file per line from MINION_SOUND_PROMPTS.md. */
export const MINION_VOICE: MinionClip[] = [];

/** Physical effects: drill, rock, pouring, bubbling. */
export const MINION_SFX: MinionClip[] = [];
