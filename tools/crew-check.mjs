/**
 * crew-check.mjs — QA strip: crop the crew walk frames out of the packed v2
 * atlas so the three minion sheets can be eyeballed side by side.
 * columns: front, left, right, back · rows: mechanic, driller, radio
 *
 * Writes tools/crew-check.png — deliberately NOT under public/, so it never ships.
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';

const atlas = JSON.parse(await fs.readFile('public/assets/v2/v2.json', 'utf8'));
const CREW = ['mechanic', 'driller', 'radio'];
const DIRS = ['front', 'left', 'right', 'back'];
const CELL = 120;
const PAD = 6;

const w = DIRS.length * (CELL + PAD) + PAD;
const h = CREW.length * (CELL + PAD) + PAD;

const composites = [];
for (let r = 0; r < CREW.length; r++) {
  for (let c = 0; c < DIRS.length; c++) {
    const name = `minion_${CREW[r]}_${DIRS[c]}_0`;
    const fr = atlas.frames[name];
    if (!fr) { console.warn('missing', name); continue; }
    const { x, y, w: fw, h: fh } = fr.frame;
    const crop = await sharp('public/assets/v2/v2.png')
      .extract({ left: x, top: y, width: fw, height: fh })
      .resize(CELL - 8, CELL - 8, { fit: 'inside' })
      .toBuffer();
    composites.push({
      input: crop,
      left: PAD + c * (CELL + PAD) + 4,
      top: PAD + r * (CELL + PAD) + 4,
    });
  }
}

await sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 30, b: 60, alpha: 1 } } })
  .composite(composites)
  .png()
  .toFile('tools/crew-check.png');
console.log('wrote tools/crew-check.png');
