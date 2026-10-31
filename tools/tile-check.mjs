/**
 * tile-check.mjs — proves the deck tile in the packed atlas is the deck art and
 * that it repeats cleanly. Writes public/__inspect/tiles.png (temporary).
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';

const atlas = JSON.parse(await fs.readFile('public/assets/v2/v2.json', 'utf8'));
const NAMES = ['ground_plate', 'ground_plate_worn', 'ground_hazard', 'ground_road'];
const REPEAT = 3;

const cells = [];
for (const name of NAMES) {
  const fr = atlas.frames[name];
  if (!fr) { console.warn('missing', name); continue; }
  const { x, y, w, h } = fr.frame;
  const one = await sharp('public/assets/v2/v2.png')
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
  // tile it, so a seam or a mis-sized frame is obvious
  const tiles = [];
  for (let row = 0; row < REPEAT; row++) {
    for (let col = 0; col < REPEAT; col++) {
      tiles.push({ input: one, left: col * w, top: row * h });
    }
  }
  const tiled = await sharp({
    create: { width: w * REPEAT, height: h * REPEAT, channels: 4, background: { r: 20, g: 20, b: 40, alpha: 1 } },
  }).composite(tiles).png().toBuffer();
  const scaled = await sharp(tiled).resize(192, 192, { fit: 'inside' }).png().toBuffer();
  cells.push({ name, one, scaled });
}

const CARD = 200;
const outW = cells.length * (CARD + 10) + 10;
const outH = CARD + 40;
const composites = [];
cells.forEach((c, i) => {
  composites.push({ input: c.scaled, left: 10 + i * (CARD + 10) + 4, top: 10 });
});
await sharp({ create: { width: outW, height: outH, channels: 4, background: { r: 18, g: 18, b: 38, alpha: 1 } } })
  .composite(composites)
  .png()
  .toFile('public/__inspect/tiles.png');

console.log('order:', cells.map((c) => c.name).join(' | '));
for (const c of cells) {
  const { info } = await sharp(c.one).toBuffer({ resolveWithObject: true });
  console.log(`${c.name} frame ${info.width}x${info.height}, channels ${info.channels}`);
}
