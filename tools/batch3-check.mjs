/**
 * batch3-check.mjs — QA strip for the batch3 UI art: lays the named frames out
 * in labelled rows over a dark card so the cut can be eyeballed against the
 * game's background. Writes tools/batch3-check.png.
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';

const atlas = JSON.parse(await fs.readFile('public/assets/v2/v2.json', 'utf8'));
const ROWS = [
  ['ui_dialog', 'ui_minimap_frame'],
  ['ui_portrait_mechanic', 'ui_portrait_driller', 'ui_portrait_radio', 'ui_portrait_chemist', 'ui_portrait_astronaut'],
  ['ui_arrow', 'ui_star_empty', 'ui_star_full', 'ui_cursor_hand'],
  ['ui_icon_wrench', 'ui_icon_fuel', 'ui_icon_gear', 'ui_icon_rocket'],
];
const CELL = 180;
const GAP = 10;

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
  .toFile('tools/batch3-check.png');
console.log(`wrote tools/batch3-check.png ${w}x${h}`);
console.log('row order:', ROWS.map((r) => r.join(' | ')).join('\n           '));
