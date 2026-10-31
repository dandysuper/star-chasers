/**
 * cut-v2.mjs — cutter for the star_chasers v2 wishlist drops (v2_src/*.png).
 *
 * The v2 art covers several source formats and each gets its own treatment:
 *   • single-object renders (2048² or 1376×768, near-white studio background)
 *     → flood-fill key, trim to content, downscale (`ui_minimap_frame` also
 *       keys from its centre so the circular viewport stays transparent)
 *   • grid sheets (2752×1536: minion walks, crates, flames)
 *     → deterministic grid slice, trim each cell
 *   • irregular multi-object sheets (minion_idle, engine_bells, fx_misc,
 *     ui_portraits, ui_icons)
 *     → 8-connected component detection + proximity box merging, scaled with
 *       one uniform scale factor per sheet
 * Ground/pad tiles are full-bleed and only get downscaled.
 *
 * Output: public/assets/v2/v2.png + v2.json   (one packed atlas, named frames)
 *         public/assets/anims/crew_walk_anims.json
 *         tools/v2-report.html                (visual QA sheet)
 *
 * Usage:  node tools/cut-v2.mjs
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = 'v2_src';
const OUT = 'public/assets/v2';
const ANIM_DIR = 'public/assets/anims';
const REPORT = 'tools/v2-report.html';
const ATLAS_W = 2048;

/** Background keying: a pixel joins the background flood when it is close to
 *  its parent pixel (follows studio gradients) and not far from the global
 *  background colour (stops the flood creeping into soft shadows). */
const STEP_TOL = 16;
const MAX_TOL = 74;
/** Transparent pixels inherit the nearest opaque colour for N passes so the
 *  downscale cannot blend the light background into the dark outlines. */
const BLEED_PASSES = 3;

// ---------------------------------------------------------------- keying

/** Average colour of the four corner blocks → the sheet's studio background. */
function cornerBackground(data, w, h, ch, block = 6) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [bx, by] of [[0, 0], [w - block, 0], [0, h - block], [w - block, h - block]]) {
    for (let y = by; y < by + block; y++) {
      for (let x = bx; x < bx + block; x++) {
        const i = (y * w + x) * ch;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

/** Flood-fill the studio background inward from the border (and optionally
 *  from interior seed points for hollow frames like `ui_minimap_frame.png`,
 *  `ui_star_empty`, or `ui_icon_gear`).
 *  Returns a Uint8Array mask where 1 = background. */
function keyBackground(data, w, h, ch, { keyCenter = false, extraSeeds = [] } = {}) {
  const bg = cornerBackground(data, w, h, ch);
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;

  const accept = (idx, pr, pg, pb, refR = bg.r, refG = bg.g, refB = bg.b) => {
    if (mask[idx]) return;
    const i = idx * ch;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const stepDist = Math.hypot(r - pr, g - pg, b - pb);
    if (stepDist > STEP_TOL) return;
    const bgDist = Math.hypot(r - refR, g - refG, b - refB);
    if (bgDist > MAX_TOL) return;
    mask[idx] = 1;
    stack[sp++] = idx;
  };

  for (let x = 0; x < w; x++) {
    accept(x, bg.r, bg.g, bg.b);
    accept((h - 1) * w + x, bg.r, bg.g, bg.b);
  }
  for (let y = 0; y < h; y++) {
    accept(y * w, bg.r, bg.g, bg.b);
    accept(y * w + w - 1, bg.r, bg.g, bg.b);
  }

  while (sp > 0) {
    const idx = stack[--sp];
    const i = idx * ch;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) accept(idx - 1, r, g, b);
    if (x < w - 1) accept(idx + 1, r, g, b);
    if (y > 0) accept(idx - w, r, g, b);
    if (y < h - 1) accept(idx + w, r, g, b);
  }

  const seeds = keyCenter ? [[Math.floor(w / 2), Math.floor(h / 2)], ...extraSeeds] : extraSeeds;
  for (const [sx, sy] of seeds) {
    const cIdx = Math.round(sy) * w + Math.round(sx);
    const ci = cIdx * ch;
    const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];
    accept(cIdx, cr, cg, cb, cr, cg, cb);
    while (sp > 0) {
      const idx = stack[--sp];
      const i = idx * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) accept(idx - 1, r, g, b, cr, cg, cb);
      if (x < w - 1) accept(idx + 1, r, g, b, cr, cg, cb);
      if (y > 0) accept(idx - w, r, g, b, cr, cg, cb);
      if (y < h - 1) accept(idx + w, r, g, b, cr, cg, cb);
    }
  }

  return mask;
}

/** Copy a rectangle out of the sheet as RGBA, alpha = 0 on background pixels. */
function extract(data, w, ch, mask, x0, y0, cw, chh) {
  const out = Buffer.alloc(cw * chh * 4);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y + y0) * w + (x + x0)) * ch;
      const di = (y * cw + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = mask[(y + y0) * w + (x + x0)] ? 0 : 255;
    }
  }
  return out;
}

/** Push opaque colours outward into transparent pixels so resampling blends
 *  from the sprite's own colour, never from the keyed-out studio background. */
function bleedEdges(buf, w, h, passes) {
  const has = (x, y) => buf[(y * w + x) * 4 + 3] > 0;
  for (let p = 0; p < passes; p++) {
    const todo = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (has(x, y)) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (!has(nx, ny)) continue;
            const i = (ny * w + nx) * 4;
            r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
          }
        }
        if (n) todo.push([x, y, r / n, g / n, b / n]);
      }
    }
    for (const [x, y, r, g, b] of todo) {
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
    }
  }
}

function bbox(mask, w, h, x0, y0, cw, chh) {
  let minX = cw, minY = chh, maxX = -1, maxY = -1;
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      if (mask[(y + y0) * w + (x + x0)]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------- cutting

async function readSheet(file) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/** Cut one object out of a studio-background render, trim, downscale. */
async function cutObject(file, maxEdge, opts = {}) {
  const { data, w, h, ch } = await readSheet(file);
  const mask = keyBackground(data, w, h, ch, opts);
  const box = bbox(mask, w, h, 0, 0, w, h);
  if (!box) throw new Error(`${file}: nothing left after keying`);
  const x0 = box.minX, y0 = box.minY;
  const cw = box.maxX - box.minX + 1;
  const chh = box.maxY - box.minY + 1;
  const raw = extract(data, w, ch, mask, x0, y0, cw, chh);
  bleedEdges(raw, cw, chh, BLEED_PASSES);
  const scale = Math.min(1, maxEdge / Math.max(cw, chh));
  const tw = Math.max(1, Math.round(cw * scale));
  const th = Math.max(1, Math.round(chh * scale));
  const png = await sharp(raw, { raw: { width: cw, height: chh, channels: 4 } })
    .resize(tw, th, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, w: tw, h: th };
}

/** Slice a regular cols×rows sheet and key each cell independently. */
async function cutGrid(file, cols, rows, perFrameEdge) {
  const { data, w, h, ch } = await readSheet(file);
  const mask = keyBackground(data, w, h, ch);
  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * cellW, cy = r * cellH;
      const box = bbox(mask, w, h, cx, cy, cellW, cellH);
      if (!box) { out.push(null); continue; }
      const x0 = cx + box.minX, y0 = cy + box.minY;
      const cw = box.maxX - box.minX + 1;
      const chh = box.maxY - box.minY + 1;
      const raw = extract(data, w, ch, mask, x0, y0, cw, chh);
      bleedEdges(raw, cw, chh, BLEED_PASSES);
      const scale = Math.min(1, perFrameEdge / Math.max(cw, chh));
      const tw = Math.max(1, Math.round(cw * scale));
      const th = Math.max(1, Math.round(chh * scale));
      const png = await sharp(raw, { raw: { width: cw, height: chh, channels: 4 } })
        .resize(tw, th, { kernel: 'lanczos3' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      out.push({ png, w: tw, h: th });
    }
  }
  return out;
}

/** Slice a 1×N row of objects off a studio sheet, keying each one separately. */
async function cutRow(file, count, perFrameEdge) {
  const { data, w, h, ch } = await readSheet(file);
  const mask = keyBackground(data, w, h, ch);
  const band = Math.floor(w / count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const cx = i * band;
    const box = bbox(mask, w, h, cx, 0, band, h);
    if (!box) { out.push(null); continue; }
    const x0 = cx + box.minX, y0 = box.minY;
    const cw = box.maxX - box.minX + 1;
    const chh = box.maxY - box.minY + 1;
    const raw = extract(data, w, ch, mask, x0, y0, cw, chh);
    bleedEdges(raw, cw, chh, BLEED_PASSES);
    const scale = Math.min(1, perFrameEdge / Math.max(cw, chh));
    const tw = Math.max(1, Math.round(cw * scale));
    const th = Math.max(1, Math.round(chh * scale));
    const png = await sharp(raw, { raw: { width: cw, height: chh, channels: 4 } })
      .resize(tw, th, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    out.push({ png, w: tw, h: th });
  }
  return out;
}

/** Split the flame sheet by column band, trim to non-black, keep black.
 *  The art is additive-friendly, so it is drawn with BlendModes.ADD and black
 *  is the transparent value — no keying at all. */
async function cutFlames(file, count, maxEdge) {
  const { data, w, h, ch } = await readSheet(file);
  const band = Math.floor(w / count);
  const out = [];
  for (let i = 0; i < count; i++) {
    const cx = i * band;
    let minX = band, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < band; x++) {
        const si = (y * w + (x + cx)) * ch;
        const lum = (data[si] + data[si + 1] + data[si + 2]) / 3;
        if (lum < 18) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) { out.push(null); continue; }
    const cw = maxX - minX + 1;
    const chh = maxY - minY + 1;
    const png = await sharp(path.join(SRC, file))
      .extract({ left: cx + minX, top: minY, width: cw, height: chh })
      .resize(Math.round(cw * Math.min(1, maxEdge / chh)), Math.round(chh * Math.min(1, maxEdge / chh)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(png).metadata();
    out.push({ png, w: meta.width, h: meta.height });
  }
  return out;
}

/** Full-bleed tile: just downscale, keep the whole canvas. */
async function scaleTile(file, size) {
  const png = await sharp(path.join(SRC, file))
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, w: size, h: size };
}

// ------------------------------------------------- component detection

/** Label 8-connected foreground (non-background) regions. */
function components(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || mask[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
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
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (seen[ni] || mask[ni]) continue;
          seen[ni] = 1;
          stack[sp++] = ni;
        }
      }
    }
    out.push({ minX, minY, maxX, maxY, area });
  }
  return out;
}

/** Merge boxes that come within `dist` px of each other, transitively — the fx
 *  art scatters little debris/dots around each element and they belong to it. */
function mergeBoxes(boxes, dist) {
  const out = boxes.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
        const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
        if (Math.hypot(dx, dy) > dist) continue;
        a.minX = Math.min(a.minX, b.minX);
        a.minY = Math.min(a.minY, b.minY);
        a.maxX = Math.max(a.maxX, b.maxX);
        a.maxY = Math.max(a.maxY, b.maxY);
        a.area += b.area;
        out.splice(j, 1);
        changed = true;
        j--;
      }
    }
  }
  return out;
}

/** Cut every object off a studio sheet, wherever it sits. Used for the sheets
 *  whose layout is not a regular grid (fx_misc has three rows of three or four,
 *  each element a different size). */
async function cutComponents(file, { mergeDist = 60, maxEdge = 240, minArea = 600, extraSeeds = [] } = {}) {
  const { data, w, h, ch } = await readSheet(file);
  const mask = keyBackground(data, w, h, ch, { extraSeeds });
  const comps = components(mask, w, h).filter((c) => c.area >= minArea);
  const merged = mergeBoxes(comps, mergeDist);

  // One scale for the whole sheet: these are ladders of the same effect at
  // growing size, so fitting each element to maxEdge on its own would flatten
  // them all to the same width and throw the ladder away.
  const biggest = Math.max(...merged.map((b) => Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1)));
  const scale = Math.min(1, maxEdge / biggest);

  const out = [];
  for (const box of merged) {
    const cw = box.maxX - box.minX + 1;
    const chh = box.maxY - box.minY + 1;
    const raw = extract(data, w, ch, mask, box.minX, box.minY, cw, chh);
    bleedEdges(raw, cw, chh, BLEED_PASSES);
    const tw = Math.max(1, Math.round(cw * scale));
    const th = Math.max(1, Math.round(chh * scale));
    const png = await sharp(raw, { raw: { width: cw, height: chh, channels: 4 } })
      .resize(tw, th, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    out.push({ png, w: tw, h: th, cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 });
  }
  return out;
}

/** Group items into horizontal bands on the gaps between their y centres, then
 *  order each band left → right. */
function bandRows(items, gapPx) {
  const sorted = [...items].sort((a, b) => a.cy - b.cy);
  const rows = [];
  let cur = [];
  for (const it of sorted) {
    if (!cur.length || it.cy - cur[cur.length - 1].cy <= gapPx) cur.push(it);
    else { rows.push(cur); cur = [it]; }
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => r.sort((a, b) => a.cx - b.cx));
}

// ---------------------------------------------------------------- packing

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

/** Walk sheets: the first three are 4 frames wide, the batch2 chemist is 6. */
const CREW = [
  { who: 'mechanic', cols: 4 },
  { who: 'driller', cols: 4 },
  { who: 'radio', cols: 4 },
  { who: 'chemist', cols: 6 },
];
/** Sheet row order, verified on the crops: row 1 faces left, row 2 faces right
 *  (the driller's drill points to the viewer's left on row 1). Getting this
 *  backwards makes every crew member walk in its mirrored direction. */
const DIRS = ['front', 'left', 'right', 'back'];

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(ANIM_DIR, { recursive: true });

  const frames = [];
  const add = async (name, job) => {
    const res = await job;
    if (!res) throw new Error(`frame ${name} produced nothing`);
    frames.push({ name, ...res });
    console.log(`  ${name.padEnd(26)} ${res.w}×${res.h}`);
  };

  console.log('buildings:');
  await add('habitat', cutObject('base_habitat.png', 640));
  await add('control', cutObject('base_control.png', 620));
  await add('tower', cutObject('base_tower.png', 720));
  await add('board', cutObject('base_board.png', 420));
  await add('dish', cutObject('base_dish.png', 380));
  await add('tanks', cutObject('base_tanks.png', 520));
  await add('airlock', cutObject('base_airlock.png', 320));

  console.log('pad + ground:');
  // pad_mark is not a cut-out: it is a full-bleed painted quadrant (hazard ring
  // on cracked concrete) centred on its bottom-left corner, so four rotated
  // copies around the pad centre rebuild the ring.
  await add('pad_mark', scaleTile('pad_mark.png', 512));
  await add('pad_clamp', cutObject('pad_clamp.png', 200));
  await add('ground_plate', scaleTile('ground_plate.png', 128));
  await add('ground_plate_worn', scaleTile('ground_plate_worn.png', 128));
  await add('ground_hazard', scaleTile('ground_hazard.png', 128));
  await add('ground_road', scaleTile('ground_road.png', 128));

  console.log('crates:');
  const crates = await cutRow('base_crates_sheet.png', 3, 220);
  crates.forEach((c, i) => { if (!c) throw new Error(`crate ${i} empty`); frames.push({ name: `crate_${'abc'[i]}`, ...c }); });

  console.log('flames:');
  const flames = await cutFlames('fx_flames_sheet.png', 3, 420);
  ['flame_small', 'flame_medium', 'flame_large'].forEach((n, i) => {
    if (!flames[i]) throw new Error(`${n} empty`);
    frames.push({ name: n, ...flames[i] });
    console.log(`  ${n.padEnd(26)} ${flames[i].w}×${flames[i].h}`);
  });

  console.log('crew walks:');
  for (const { who, cols } of CREW) {
    // the chemist sheet is 6 frames wide, the rest are 4 — slice on the sheet's
    // own column count or every frame after the first clips into its neighbour
    const file = who === 'chemist' ? 'minion_walk_chemist.png' : `minion_walk_${who}_sheet.png`;
    const cells = await cutGrid(file, cols, 4, 192);
    DIRS.forEach((dir, row) => {
      for (let col = 0; col < cols; col++) {
        const cell = cells[row * cols + col];
        if (!cell) throw new Error(`${who} ${dir}_${col} empty`);
        frames.push({ name: `minion_${who}_${dir}_${col}`, ...cell });
      }
    });
    console.log(`  minion_${who}_*        ${4 * cols} frames`);
  }

  // ---- batch2 ----
  console.log('crew idles:');
  {
    const idles = await cutComponents('minion_idle.png', { mergeDist: 40, maxEdge: 220, minArea: 3000 });
    const rows = bandRows(idles, 200);
    const names = ['mechanic', 'driller', 'radio', 'chemist'];
    const row = rows[0] ?? [];
    if (row.length !== names.length) {
      throw new Error(`minion_idle.png: expected ${names.length} poses, found ${row.length}`);
    }
    row.forEach((it, i) => {
      frames.push({ name: `minion_idle_${names[i]}`, png: it.png, w: it.w, h: it.h });
      console.log(`  minion_idle_${names[i]}`.padEnd(28) + `${it.w}×${it.h}`);
    });
  }

  console.log('astronaut poses:');
  await add('astro_wave', cutObject('astro_wave.png', 220));
  await add('astro_point', cutObject('astro_point.png', 220));

  console.log('engine bells:');
  {
    const bells = await cutComponents('engine_bells.png', { mergeDist: 40, maxEdge: 200, minArea: 4000 });
    const rows = bandRows(bells, 300);
    const names = ['bell_spark', 'bell_bull', 'bell_whisper'];
    const row = rows[0] ?? [];
    if (row.length !== names.length) {
      throw new Error(`engine_bells.png: expected ${names.length} bells, found ${row.length}`);
    }
    row.forEach((it, i) => {
      frames.push({ name: names[i], png: it.png, w: it.w, h: it.h });
      console.log(`  ${names[i]}`.padEnd(28) + `${it.w}×${it.h}`);
    });
  }

  console.log('effects:');
  {
    // three rows: clouds (4), blasts (3), sparkles (3) — debris merged into its
    // parent element, then banded by y so naming follows the sheet
    const fx = await cutComponents('fx_misc.png', { mergeDist: 70, maxEdge: 260, minArea: 800 });
    const rows = bandRows(fx, 120);
    const layout = [
      ['fx_cloud_s', 'fx_cloud_m', 'fx_cloud_l', 'fx_cloud_xl'],
      // not a size ladder: a tall radial burst, a wide hit with debris, and a
      // flat ground-level trail
      ['fx_blast_burst', 'fx_blast_hit', 'fx_blast_ground'],
      ['fx_sparkle_s', 'fx_sparkle_m', 'fx_sparkle_l'],
    ];
    if (rows.length !== layout.length) {
      throw new Error(`fx_misc.png: expected ${layout.length} rows, found ${rows.length}`);
    }
    rows.forEach((row, r) => {
      const names = layout[r];
      if (row.length !== names.length) {
        throw new Error(`fx_misc.png row ${r}: expected ${names.length}, found ${row.length}`);
      }
      row.forEach((it, i) => {
        frames.push({ name: names[i], png: it.png, w: it.w, h: it.h });
        console.log(`  ${names[i]}`.padEnd(28) + `${it.w}×${it.h}`);
      });
    });
  }

  // ---- batch3 ----
  console.log('ui batch3:');
  await add('ui_dialog', cutObject('ui_dialog.png', 520));
  // keyCenter hollows out the grey circular interior so the minimap viewport
  // stays transparent underneath the metallic bezel
  await add('ui_minimap_frame', cutObject('ui_minimap_frame.png', 240, { keyCenter: true }));

  {
    // 5 round portraits in a single row, separated by ~6 px of studio background
    // (`mergeDist: 4` keeps each roundel distinct without clipping into neighbours)
    const portraits = await cutComponents('ui_portraits.png', { mergeDist: 4, maxEdge: 128, minArea: 3000 });
    const rows = bandRows(portraits, 150);
    const names = [
      'ui_portrait_mechanic',
      'ui_portrait_driller',
      'ui_portrait_radio',
      'ui_portrait_chemist',
      'ui_portrait_astronaut',
    ];
    const row = rows[0] ?? [];
    if (row.length !== names.length) {
      throw new Error(`ui_portraits.png: expected ${names.length} portraits, found ${row.length}`);
    }
    row.forEach((it, i) => {
      frames.push({ name: names[i], png: it.png, w: it.w, h: it.h });
      console.log(`  ${names[i]}`.padEnd(28) + `${it.w}×${it.h}`);
    });
  }

  {
    // 2 rows × 4 columns: star_full has two detached 4-point sparkles around it
    // that merge into the star box via mergeDist; extraSeeds hollow out the
    // enclosed studio-white interiors of star_empty (530,215) and gear (865,578)
    const icons = await cutComponents('ui_icons.png', {
      mergeDist: 36,
      maxEdge: 64,
      minArea: 400,
      extraSeeds: [[530, 215], [865, 578]],
    });
    const rows = bandRows(icons, 140);
    const layout = [
      ['ui_arrow', 'ui_star_empty', 'ui_star_full', 'ui_cursor_hand'],
      ['ui_icon_wrench', 'ui_icon_fuel', 'ui_icon_gear', 'ui_icon_rocket'],
    ];
    if (rows.length !== layout.length) {
      throw new Error(`ui_icons.png: expected ${layout.length} rows, found ${rows.length}`);
    }
    rows.forEach((row, r) => {
      const names = layout[r];
      if (row.length !== names.length) {
        throw new Error(`ui_icons.png row ${r}: expected ${names.length}, found ${row.length}`);
      }
      row.forEach((it, i) => {
        frames.push({ name: names[i], png: it.png, w: it.w, h: it.h });
        console.log(`  ${names[i]}`.padEnd(28) + `${it.w}×${it.h}`);
      });
    });
  }

  // ---- pack ----
  const { placed, height } = shelfPack(frames, ATLAS_W);
  const atlasW = ATLAS_W;
  await sharp({ create: { width: atlasW, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(placed.map((p) => ({ input: p.png, left: p.px, top: p.py })))
    .png({ compressionLevel: 9, palette: true, colours: 256, quality: 94, effort: 9 })
    .toFile(path.join(OUT, 'v2.png'));

  const json = {
    frames: Object.fromEntries(placed.map((p) => [p.name, {
      frame: { x: p.px, y: p.py, w: p.w, h: p.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.w, h: p.h },
      sourceSize: { w: p.w, h: p.h },
    }])),
    meta: { app: 'cut-v2.mjs', image: 'v2.png', format: 'RGBA8888', size: { w: atlasW, h: height }, scale: '1' },
  };
  await fs.writeFile(path.join(OUT, 'v2.json'), JSON.stringify(json, null, 1));
  console.log(`atlas: ${atlasW}x${height}, ${placed.length} frames`);

  // ---- walk anims ----
  const anims = [];
  for (const { who, cols } of CREW) {
    for (const dir of DIRS) {
      // the chemist cycles on 6 frames, the others on 4 — a fixed count would
      // drop two chemist frames
      anims.push({
        key: `minion_${who}_walk_${dir}`,
        frames: Array.from({ length: cols }, (_, i) => ({ key: 'v2', frame: `minion_${who}_${dir}_${i}` })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }
  await fs.writeFile(path.join(ANIM_DIR, 'crew_walk_anims.json'), JSON.stringify({ anims }, null, 1));
  console.log(`anims: ${anims.length} written`);

  // ---- QA report ----
  let html = `<!doctype html><meta charset="utf-8"><title>v2 cut report</title>
<style>
body{background:#141428;color:#e8e8ff;font:13px/1.3 system-ui;margin:20px}
h1{font-size:18px;color:#ffd23f}
.grid{display:flex;flex-wrap:wrap;gap:10px}
.cell{background:#23234a;border:1px solid #3a3a6e;border-radius:8px;padding:6px;width:170px;text-align:center}
.cell img{max-width:158px;max-height:130px;display:block;margin:0 auto 4px;
background:repeating-conic-gradient(#2c2c52 0 25%,#383866 0 50%) 0 0/12px 12px}
.nm{font-size:11px;color:#7ac74f;font-weight:700;word-break:break-all}
.dim{font-size:10px;color:#8888bb}
</style><h1>v2 wishlist cut report — ${placed.length} frames</h1><div class="grid">`;
  for (const p of placed) {
    const thumb = await sharp(p.png).resize(158, 130, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    html += `<div class="cell"><img src="data:image/png;base64,${thumb.toString('base64')}">
<div class="nm">${p.name}</div><div class="dim">${p.w}×${p.h}</div></div>`;
  }
  html += '</div>';
  await fs.writeFile(REPORT, html);
  console.log(`report: ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
