/** Dump the atlas frame name → source crop for the icon sheet, so the name
 *  assigned by the cutter can be checked against the glyph it actually holds. */
import { readFileSync } from 'node:fs';

const atlas = JSON.parse(readFileSync('public/assets/ui/ui.json', 'utf8'));
const names = JSON.parse(readFileSync('tools/frame-names.json', 'utf8'));

const rows = [];
for (const [name, frame] of Object.entries(atlas.frames)) {
  if (name === undefined) continue;
  if (!name.startsWith('ico_')) continue;
  rows.push([name, frame.srcId ?? frame.filename ?? '?']);
}
rows.sort((a, b) => a[1].localeCompare(b[1]));
for (const [name, src] of rows) console.log(`${src.padEnd(22)} ${name}`);

// also show every name we asked the cutter for but did not get
const packed = new Set(Object.keys(atlas.frames));
const missing = Object.values(names).filter((n) => !packed.has(n));
console.log('\nrequested but not packed:', missing.join(', ') || '(none)');
