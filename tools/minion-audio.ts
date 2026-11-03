/**
 * minion-audio.ts — bring a batch of generated minion sounds into the game.
 *
 *   npx vite-node tools/minion-audio.ts <folder-or-zip>
 *
 * What it does:
 *   1. finds every audio file in the folder (or inside the zip),
 *   2. works out which minion and which clip it is (driller_v02, chemist_fx01…),
 *   3. copies it into `public/assets/audio/minions/` under its id,
 *   4. rewrites `src/data/minionAudio.ts` with what is now available.
 *
 * The classification rules come from `src/core/minionNaming.ts` — the same code
 * the tests cover — so a file the tool accepts is a file the game can play.
 * Re-running is safe: the folder is rebuilt from the manifest each time, and a
 * file that cannot be classified is reported, not silently dropped.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyMinionFile, compareClips, findIdClashes, type MinionClipRef,
} from '../src/core/minionNaming';

const TARGET_DIR = resolve('public/assets/audio/minions');
const MANIFEST = resolve('src/data/minionAudio.ts');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.webm']);

/** Every audio file under `dir`, recursively. */
function collectAudio(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectAudio(full));
    else if (AUDIO_EXT.has(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

/** Unpack a zip into a temp dir so the same collector can walk it. */
function expandSource(source: string): { dir: string; cleanup: () => void } {
  if (extname(source).toLowerCase() !== '.zip') {
    return { dir: source, cleanup: () => {} };
  }
  const temp = mkdtempSync(join(tmpdir(), 'minion-audio-'));
  const result = spawnSync('unzip', ['-o', '-q', source, '-d', temp], { encoding: 'utf8' });
  if (result.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`unzip failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return { dir: temp, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}

function writeManifest(clips: MinionClipRef[]): void {
  const rows = (kind: 'voice' | 'sfx') => clips
    .filter((c) => c.kind === kind)
    .map((c) => `  { id: '${c.id}', file: '${c.id}${extname(c.file).toLowerCase()}' },`)
    .join('\n');

  const body = `/**
 * minionAudio.ts — which minion recordings exist on disk right now.
 *
 * GENERATED FILE. Rewritten by \`npx vite-node tools/minion-audio.ts <folder>\`.
 * Do not hand-edit: the next import overwrites it.
 *
 * Imported clips: ${clips.length}.
 */

export interface MinionClip {
  /** \`driller_v02\`, \`chemist_fx01\` — the id the scenes ask for. */
  id: string;
  /** File name inside \`public/assets/audio/minions/\`. */
  file: string;
}

/** Mumbled speech, one file per line from MINION_SOUND_PROMPTS.md. */
export const MINION_VOICE: MinionClip[] = [
${rows('voice')}
];

/** Physical effects: drill, rock, pouring, bubbling. */
export const MINION_SFX: MinionClip[] = [
${rows('sfx')}
];
`;
  writeFileSync(MANIFEST, body, 'utf8');
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npx vite-node tools/minion-audio.ts <folder-or-zip>');
    process.exit(1);
  }
  const source = resolve(arg.replace(/^~/, process.env.HOME ?? '~'));
  if (!existsSync(source)) {
    console.error(`not found: ${source}`);
    process.exit(1);
  }

  let expanded: { dir: string; cleanup: () => void };
  try {
    expanded = expandSource(source);
  } catch (err) {
    // an empty or truncated download is the usual cause — say that, not a stack
    console.error(`${source} could not be opened: ${(err as Error).message.split('\n')[0]}`);
    console.error('if it came from a browser, re-download it; an unzipped folder works too.');
    process.exit(1);
  }
  const { dir, cleanup } = expanded;
  const files = collectAudio(dir);

  if (files.length === 0) {
    cleanup();
    console.error(`no audio files found in ${source} — nothing to import`);
    process.exit(1);
  }

  const clips: MinionClipRef[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const name = file.split('/').pop() ?? file;
    const clip = classifyMinionFile(name);
    if (clip) clips.push(clip);
    else rejected.push(name);
  }

  const clashes = findIdClashes(clips);
  if (clashes.length) {
    cleanup();
    console.error('two files map to the same clip id — rename one and re-run:');
    for (const c of clashes) console.error(`  ${c}`);
    process.exit(1);
  }

  clips.sort(compareClips);

  mkdirSync(TARGET_DIR, { recursive: true });
  // drop anything from a previous import that is no longer in the batch, so the
  // folder always matches the manifest exactly
  for (const existing of readdirSync(TARGET_DIR)) {
    if (AUDIO_EXT.has(extname(existing).toLowerCase())) rmSync(join(TARGET_DIR, existing), { force: true });
  }

  for (const clip of clips) {
    const source_file = files.find((f) => (f.split('/').pop() ?? '') === clip.file);
    if (!source_file) continue;
    const dest = join(TARGET_DIR, `${clip.id}${extname(clip.file).toLowerCase()}`);
    copyFileSync(source_file, dest);
  }

  writeManifest(clips);
  cleanup();

  const voices = clips.filter((c) => c.kind === 'voice').length;
  const sfx = clips.length - voices;
  console.log(`imported ${clips.length} clip(s): ${voices} voice, ${sfx} effect`);
  for (const clip of clips) console.log(`  ${clip.id.padEnd(16)} ← ${clip.file}`);
  if (rejected.length) {
    console.log(`${rejected.length} file(s) could not be classified (name needs a minion and a v/fx number):`);
    for (const r of rejected) console.log(`  ${r}`);
  }
  console.log(`\nnext: npm run typecheck && npm run build`);
}

main();
