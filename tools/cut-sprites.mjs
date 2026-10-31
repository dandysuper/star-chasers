/**
 * cut-sprites.mjs — one-time sprite cutter for the Star Chasers ui_v1 art pack.
 *
 * The ui_v1 sheets are irregular collages (no uniform grid, no frames JSON), so we
 * segment them: flood-fill the background inward from the border, treat everything
 * unreachable as sprite pixels, label 8-connected components, crop each one and
 * repack them into a single Phaser JSON-Hash atlas.
 *
 * Usage:  node tools/cut-sprites.mjs
 * Writes: public/assets/ui/frames/<sheet>/<id>.png  (individual crops)
 *         public/assets/ui/ui.png + ui.json         (packed atlas)
 *         public/assets/bg/*.webp                   (downscaled backdrops)
 *         tools/sprites-report.html                 (visual QA sheet)
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR = 'ui_v1';
const UI_DIR = 'public/assets/ui';
const FRAME_DIR = 'tools/cut-frames';   // working crops — not shipped
const BG_DIR = 'public/assets/bg';

/** Sheets that get segmented (sprite collages). */
const SHEETS = [
  'A1_v2_nose_tanks',
  'A2_v2_engines_decouplers_fins',
  'A3_v2_misc',
  'A4_effects',
  'C1_buttons',
  'C2_panels',
  'C3_stars',
  'C4_icons',
  'C5_block_palette',
  'C6_logo',
];

/** Full-bleed backdrops: no segmentation, just downscale. */
const BACKDROPS = {
  'B1_v2_splash': 'splash',
  'B2_main_menu': 'menu',
  'B3_builder': 'builder',
  'B4_code': 'code',
  'B5_flight_earth': 'flight_earth',
  'B6_flight_space': 'flight_space',
  'B7_flight_moon': 'flight_moon',
  'B8_result_win': 'result_win',
  'B9_result_fail': 'result_fail',
};

const BG_TOLERANCE = 46;   // euclidean RGB distance still considered background
const MIN_AREA = 900;      // px² — anything smaller is noise / stray AA
const CROP_PAD = 3;        // px of transparent margin around each frame
const ATLAS_W = 2048;

/** Longest-side cap per sheet, in px. Keeps the shipped atlas light while
 *  staying ≥2× the on-screen size of every sprite. */
const MAX_EDGE_BY_SHEET = {
  A1_v2_nose_tanks: 320,
  A2_v2_engines_decouplers_fins: 320,
  A3_v2_misc: 256,
  A4_effects: 256,
  C1_buttons: 320,
  C2_panels: 512,
  C3_stars: 320,
  C4_icons: 160,
  C5_block_palette: 256,
  C6_logo: 768,
};
const DEFAULT_MAX_EDGE = 320;

// ---------------------------------------------------------------- helpers

const dist2 = (r1, g1, b1, r2, g2, b2) => {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

/** Most frequent colour along the 1px border ring → the sheet background. */
function detectBackground(data, w, h, ch) {
  const tally = new Map();
  const push = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // quantise to 8 levels so gradients still cluster
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = tally.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    tally.set(key, e);
  };
  for (let x = 0; x < w; x++) {
    push(x * ch);
    push(((h - 1) * w + x) * ch);
  }
  for (let y = 0; y < h; y++) {
    push((y * w) * ch);
    push((y * w + w - 1) * ch);
  }
  let best = null;
  for (const e of tally.values()) if (!best || e.n > best.n) best = e;
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

/** Flood-fill background from the border. Returns a Uint8Array mask (1 = background). */
function backgroundMask(data, w, h, ch, bg) {
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const tryPush = (idx) => {
    if (mask[idx]) return;
    const i = idx * ch;
    if (dist2(data[i], data[i + 1], data[i + 2], bg.r, bg.g, bg.b) > BG_TOLERANCE) return;
    mask[idx] = 1;
    stack[sp++] = idx;
  };
  for (let x = 0; x < w; x++) { tryPush(x); tryPush((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { tryPush(y * w); tryPush(y * w + w - 1); }
  while (sp > 0) {
    const idx = stack[--sp];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) tryPush(idx - 1);
    if (x < w - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - w);
    if (y < h - 1) tryPush(idx + w);
  }
  return mask;
}

/** 8-connected component labelling of the non-background pixels. */
function components(bgMask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || bgMask[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || bgMask[ni]) continue;
          seen[ni] = 1;
          stack[sp++] = ni;
        }
      }
    }
    if (area >= MIN_AREA) out.push({ area, minX, minY, maxX, maxY });
  }
  return out;
}

/** Reading order: band rows by vertical overlap, then left→right. */
function readingOrder(list) {
  const rows = [];
  const sorted = [...list].sort((a, b) => a.minY - b.minY);
  for (const c of sorted) {
    const cy = (c.minY + c.maxY) / 2;
    let row = rows.find((r) => cy >= r.top && cy <= r.bottom);
    if (!row) { row = { top: c.minY, bottom: c.maxY, items: [] }; rows.push(row); }
    row.top = Math.min(row.top, c.minY);
    row.bottom = Math.max(row.bottom, c.maxY);
    row.items.push(c);
  }
  rows.sort((a, b) => a.top - b.top);
  const out = [];
  for (const r of rows) { r.items.sort((a, b) => a.minX - b.minX); out.push(...r.items); }
  return out;
}

// ---------------------------------------------------------------- per-sheet work

async function cutSheet(sheet) {
  const file = path.join(SRC_DIR, `${sheet}.png`);
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const ch = info.channels;

  const bg = detectBackground(data, w, h, ch);
  const bgMask = backgroundMask(data, w, h, ch, bg);
  const comps = readingOrder(components(bgMask, w, h));

  await fs.mkdir(path.join(FRAME_DIR, sheet), { recursive: true });
  const frames = [];

  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const x0 = Math.max(0, c.minX - CROP_PAD);
    const y0 = Math.max(0, c.minY - CROP_PAD);
    const x1 = Math.min(w - 1, c.maxX + CROP_PAD);
    const y1 = Math.min(h - 1, c.maxY + CROP_PAD);
    const cw = x1 - x0 + 1;
    const chh = y1 - y0 + 1;

    // copy region, alpha = 0 wherever the sheet's background mask says background
    const out = Buffer.alloc(cw * chh * 4);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const si = ((y + y0) * w + (x + x0)) * ch;
        const di = (y * cw + x) * 4;
        const isBg = bgMask[(y + y0) * w + (x + x0)];
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = isBg ? 0 : 255;
      }
    }

    const id = `${sheet}__${String(i).padStart(2, '0')}`;
    const png = await sharp(out, { raw: { width: cw, height: chh, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await fs.writeFile(path.join(FRAME_DIR, sheet, `${id}.png`), png);
    frames.push({ id, sheet, index: i, w: cw, h: chh, png });
  }

  return { sheet, bg, total: comps.length, frames };
}

// ---------------------------------------------------------------- atlas packing

function shelfPack(items, maxW) {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const placed = [];
  let x = 0, y = 0, rowH = 0;
  for (const it of sorted) {
    if (x + it.w > maxW && x > 0) { x = 0; y += rowH + 2; rowH = 0; }
    placed.push({ ...it, px: x, py: y });
    x += it.w + 2;
    rowH = Math.max(rowH, it.h);
  }
  return { placed, height: y + rowH };
}

// ---------------------------------------------------------------- main

async function main() {
  await fs.rm(UI_DIR, { recursive: true, force: true });
  await fs.mkdir(UI_DIR, { recursive: true });
  await fs.mkdir(FRAME_DIR, { recursive: true });
  await fs.mkdir(BG_DIR, { recursive: true });

  // names map (optional) — tools/frame-names.json { "<sheet>__<nn>": "semantic_name" }
  let names = {};
  try {
    names = JSON.parse(await fs.readFile('tools/frame-names.json', 'utf8'));
  } catch { /* first run: no names yet */ }

  const all = [];
  for (const sheet of SHEETS) {
    const res = await cutSheet(sheet);
    console.log(`${sheet}: bg=rgb(${res.bg.r},${res.bg.g},${res.bg.b}) frames=${res.total}`);
    all.push(...res.frames);
  }

  // downscale every sprite to its sheet's cap so the shipped atlas stays light
  const packed = [];
  for (const f of all) {
    const cap = MAX_EDGE_BY_SHEET[f.sheet] ?? DEFAULT_MAX_EDGE;
    const scale = Math.min(1, cap / Math.max(f.w, f.h));
    if (scale < 1) {
      const buf = await sharp(f.png).resize(Math.round(f.w * scale), Math.round(f.h * scale)).png().toBuffer();
      const meta = await sharp(buf).metadata();
      packed.push({ ...f, png: buf, w: meta.width, h: meta.height });
    } else {
      packed.push(f);
    }
  }

  // Only named frames ship. Everything else (letter stamps, spare art passes,
  // decorative block swatches) is dropped: every atlas frame is deliberate.
  const named = packed
    .filter((f) => typeof names[f.id] === 'string')
    .map((f) => ({ ...f, name: names[f.id] }));
  const seen = new Set();
  for (const f of named) {
    if (seen.has(f.name)) throw new Error(`duplicate frame name: ${f.name} (${f.id})`);
    seen.add(f.name);
  }
  const dropped = packed.length - named.length;
  console.log(`frames: ${named.length} packed, ${dropped} dropped`);

  const { placed, height } = shelfPack(named, ATLAS_W);
  const atlasW = Math.max(...placed.map((p) => p.px + p.w), ATLAS_W);
  const composites = placed.map((p) => ({ input: p.png, left: p.px, top: p.py }));
  await sharp({ create: { width: atlasW, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    // the art is flat cartoon colour with thick outlines: a 256-colour palette
    // is visually lossless here and cuts the atlas by roughly 4×
    .png({ compressionLevel: 9, palette: true, colours: 256, quality: 92, effort: 9 })
    .toFile(path.join(UI_DIR, 'ui.png'));

  const frames = {};
  for (const p of placed) {
    frames[p.name] = {
      frame: { x: p.px, y: p.py, w: p.w, h: p.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.w, h: p.h },
      sourceSize: { w: p.w, h: p.h },
      // extra: where the crop came from, useful for debugging
      sheet: p.sheet,
      srcId: p.id,
    };
  }
  const atlas = {
    frames,
    meta: { app: 'cut-sprites.mjs', image: 'ui.png', format: 'RGBA8888', size: { w: atlasW, h: height }, scale: '1' },
  };
  await fs.writeFile(path.join(UI_DIR, 'ui.json'), JSON.stringify(atlas, null, 1));
  console.log(`atlas: ${atlasW}x${height}, ${placed.length} frames`);

  // ---- backdrops ----
  for (const [sheet, name] of Object.entries(BACKDROPS)) {
    const file = path.join(SRC_DIR, `${sheet}.png`);
    try {
      await sharp(file).resize(1280, 720, { fit: 'cover' }).webp({ quality: 82 }).toFile(path.join(BG_DIR, `${name}.webp`));
    } catch {
      console.warn(`backdrop missing: ${sheet}`);
    }
  }

  // ---- QA report ----
  const groups = new Map();
  for (const p of placed) {
    if (!groups.has(p.sheet)) groups.set(p.sheet, []);
    groups.get(p.sheet).push(p);
  }
  let html = `<!doctype html><meta charset="utf-8"><title>ui_v1 cut report</title>
<style>
body{background:#141428;color:#e8e8ff;font:13px/1.3 system-ui;margin:20px}
h2{margin:26px 0 8px;font-size:16px;color:#ffd23f}
.grid{display:flex;flex-wrap:wrap;gap:10px}
.cell{background:#23234a;border:1px solid #3a3a6e;border-radius:8px;padding:6px;width:150px;text-align:center}
.cell img{max-width:138px;max-height:110px;display:block;margin:0 auto 4px;background:
repeating-conic-gradient(#333 0 25%,#444 0 50%) 0 0/12px 12px}
.id{font-size:10px;color:#9a9aff;word-break:break-all}
.nm{font-size:11px;color:#7ac74f;font-weight:700;word-break:break-all}
.dim{font-size:10px;color:#8888bb}
</style><h1>ui_v1 cut report</h1>`;
  for (const [sheet, list] of groups) {
    html += `<h2>${sheet} — ${list.length} frames</h2><div class="grid">`;
    for (const p of list) {
      const thumb = await sharp(p.png)
        .resize(138, 110, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      html += `<div class="cell"><img src="data:image/webp;base64,${thumb.toString('base64')}">
<div class="nm">${p.name}</div><div class="id">${p.id}</div><div class="dim">${p.w}×${p.h}</div></div>`;
    }
    html += '</div>';
  }
  await fs.writeFile('tools/sprites-report.html', html);
  console.log('report: tools/sprites-report.html');
}

main().catch((e) => { console.error(e); process.exit(1); });
