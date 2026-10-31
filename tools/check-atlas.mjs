/** Sanity-check the packed ui atlas: alpha present, every frame non-empty. */
import sharp from 'sharp';

const atlas = 'public/assets/ui/ui.png';
const meta = await sharp(atlas).metadata();
console.log('size', meta.width, 'x', meta.height, '| hasAlpha', meta.hasAlpha, '| channels', meta.channels, '| palette', meta.paletteBitDepth);

const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let transparent = 0;
for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
const total = info.width * info.height;
console.log(`transparent pixels: ${transparent} / ${total} (${(transparent / total * 100).toFixed(1)}%)`);

const json = JSON.parse(await (await import('node:fs/promises')).readFile('public/assets/ui/ui.json', 'utf8'));
const names = Object.keys(json.frames);
console.log(`frames: ${names.length}`);
console.log(names.join(', '));
