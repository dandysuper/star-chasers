/**
 * batch2-check.mjs — QA strip for the batch2 art: lays the named frames out in
 * labelled rows over a dark card so the cut can be eyeballed against the game's
 * own background. Writes public/__inspect/batch2.png (temporary, cleaned up).
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';

const atlas = JSON.parse(await fs.readFile('public/assets/v2/v2.json', 'utf8'));
const ROWS = [
  ['bell_spark', 'bell_bull', 'bell_whisper'],
  ['minion_idle_mechanic', 'minion_idle_driller', 'minion_idle_radio', 'minion_idle_chemist'],
  ['astro_wave', 'astro_point'],
  ['fx_cloud_s', 'fx_cloud_m', 'fx_cloud_l', 'fx_cloud_xl'],
  ['fx_blast_burst', 'fx_blast_hit', 'fx_blast_ground'],
  ['fx_sparkle_s', 'fx_sparkle_m', 'fx_sparkle_l'],
];
const CELL = 200;
const GAP = 8;

const cols = Math.max(...ROWS.map((r) => r.length));
const w = cols * (CELL + GAP) + GAP;
const h = ROWS.length * (CELL + GAP) + GAP;

const composites = [];
for (let r = 0; r < ROWS.length; r++) {
  for (let c = 0; c < ROWS[r].length; c++) {
    const fr = atlas.frames[ROWS[r][c]];
    if (!fr) { console.warn('missing', ROWS[r][c]); continue; }
    const { x, y, w: fw, h: fh } = fr.frame;
    const crop = await sharp('public/assets/v2/v2.png')
      .extract({ left: x, top: y, width: fw, height: fh })
      .resize(CELL - 16, CELL - 16, { fit: 'inside' })
      .toBuffer();
    composites.push({
      input: crop,
      left: GAP + c * (CELL + GAP) + 8,
      top: GAP + r * (CELL + GAP) + 8,
    });
  }
}

await sharp({ create: { width: w, height: h, channels: 4, background: { r: 29, g: 29, b: 58, alpha: 1 } } })
  .composite(composites)
  .png()
  .toFile('public/__inspect/batch2.png');
console.log(`wrote public/__inspect/batch2.png ${w}x${h}`);
console.log('row order:', ROWS.map((r) => r.join(' | ')).join('\n           '));
