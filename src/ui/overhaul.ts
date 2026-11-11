/**
 * Art overhaul (artoverhaul.md): optional replacement art that lands through
 * `public/assets/overhaul/manifest.json`, like the planet and rover packs.
 *
 * Most keys name an existing atlas frame (`ui/btn_blue`, `v2/tower`,
 * `atlases/minions_chemist`). Those files do not get keys of their own: at
 * boot they are packed into power-of-two pages and *replace the frame inside
 * its atlas*, so every `add.image(x, y, 'ui', 'btn_blue')` in the game picks
 * up the new art without being touched. The pages are power-of-two so the
 * renderer can build mipmaps for them; the rocket parts are drawn 6x smaller
 * than delivered, and without mipmaps they would shimmer.
 *
 * A replaced frame remembers how big the old one was (`nativeRatio`), for the
 * few call sites that size art by its pixel size rather than by a display size.
 * New keys with no frame to replace (explore rocks and craters, the planet
 * ground tiles) go into an `overhaul` texture of their own. Backdrops are
 * loaded straight under the existing `bg_*` keys.
 */
import Phaser from 'phaser';

export const OVERHAUL = 'overhaul';
export const OVERHAUL_MANIFEST = 'overhaul_manifest';
const PREFIX = 'ov:';
const DIR = 'assets/overhaul/';

export interface OverhaulManifest {
  images?: { key: string; file: string }[];
}

/** Keys whose frame has a different name in today's atlases. */
const RENAME: Record<string, { tex: string; frame: string }> = {
  'parts/fins': { tex: 'ui', frame: 'fins_red' },
  'parts/parachute': { tex: 'ui', frame: 'fx_chute' },
  'parts/bell_spark': { tex: 'v2', frame: 'bell_spark' },
  'parts/bell_bull': { tex: 'v2', frame: 'bell_bull' },
  'parts/bell_whisper': { tex: 'v2', frame: 'bell_whisper' },
  'ui/logo_en': { tex: 'ui', frame: 'logo' },
};

/** Atlases an `atlases/<frame>` key may replace a frame in. */
const ATLASES = ['machines', 'minions', 'resources', 'tools_v2', 'terrain', 'terrain_v2'];

/** Where a delivered key lands, or null when nothing in the game can use it. */
function target(textures: Phaser.Textures.TextureManager, key: string): { tex: string; frame: string } | null {
  if (RENAME[key]) return RENAME[key];
  const slash = key.indexOf('/');
  if (slash < 0) return null;
  const group = key.slice(0, slash);
  const name = key.slice(slash + 1);
  const has = (tex: string) => textures.exists(tex) && textures.get(tex).has(name);
  switch (group) {
    case 'parts':
    case 'ui':
      return { tex: 'ui', frame: name };
    case 'v2':
      return { tex: 'v2', frame: name };
    case 'ground':
      return has('v2') ? { tex: 'v2', frame: name } : { tex: OVERHAUL, frame: name };
    case 'atlases': {
      const atlas = ATLASES.find(has);
      return atlas ? { tex: atlas, frame: name } : null;
    }
    case 'explore':
      return { tex: OVERHAUL, frame: name };
    default:
      return null;
  }
}

/**
 * Queue the overhaul manifest. Backdrops are loaded from the overhaul folder
 * when it has them and from `assets/bg/` otherwise, so they are queued only
 * once the manifest is known (or known to be missing).
 */
export function queueOverhaul(scene: Phaser.Scene, backdrops: Record<string, string>): void {
  const load = scene.load;
  const queueOldBackdrops = (skip: Set<string>) => {
    for (const [key, stem] of Object.entries(backdrops)) {
      if (!skip.has(key)) load.image(key, `assets/bg/${stem}.webp`);
    }
  };
  load.on('filecomplete-json-' + OVERHAUL_MANIFEST, (_k: string, _t: string, data: OverhaulManifest) => {
    const fromOverhaul = new Set<string>();
    for (const img of data?.images ?? []) {
      if (!img?.key || !img?.file) continue;
      if (img.key.startsWith('bg/')) {
        const key = `bg_${img.key.slice(3)}`;
        if (!(key in backdrops)) continue;
        fromOverhaul.add(key);
        load.image(key, DIR + img.file);
      } else {
        load.image(PREFIX + img.key, DIR + img.file);
      }
    }
    queueOldBackdrops(fromOverhaul);
  });
  load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
    // no overhaul at all: today's backdrops
    if (file.key === OVERHAUL_MANIFEST) queueOldBackdrops(new Set());
    // a listed backdrop that failed: fall back to today's file for that one
    else if (file.key in backdrops && file.url.toString().includes(DIR)) {
      load.image(file.key, `assets/bg/${backdrops[file.key]}.webp`);
    }
  });
  load.json(OVERHAUL_MANIFEST, DIR + 'manifest.json');
}

interface Item {
  key: string;
  img: HTMLImageElement | HTMLCanvasElement;
  w: number;
  h: number;
  tex: string;
  frame: string;
  slice: Slice | null;
}

interface Placed { item: Item; x: number; y: number }
interface Page { w: number; h: number; placed: Placed[] }

const PAGE_MAX = 2048;
/** Gap between packed images. Wide enough that the small mip levels do not
 *  bleed one image's edge into its neighbour. */
const GAP = 16;

const pot = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/** Shelf-pack into power-of-two pages. An image too big for a page gets a
 *  page of its own at its own size (no mipmaps, but still drawn). */
function packPages(items: Item[]): Page[] {
  const pages: Page[] = [];
  const fits = items.filter((it) => it.w + GAP <= PAGE_MAX && it.h + GAP <= PAGE_MAX);
  for (const it of items) {
    if (!fits.includes(it)) pages.push({ w: it.w, h: it.h, placed: [{ item: it, x: 0, y: 0 }] });
  }
  if (fits.length === 0) return pages;
  fits.sort((a, b) => b.h - a.h || b.w - a.w);
  const area = fits.reduce((s, it) => s + (it.w + GAP) * (it.h + GAP), 0);
  const widest = fits.reduce((m, it) => Math.max(m, it.w + GAP), 0);
  const pageW = Math.min(PAGE_MAX, Math.max(pot(widest), pot(Math.ceil(Math.sqrt(area * 1.15)))));
  let page: Page = { w: pageW, h: 0, placed: [] };
  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const it of fits) {
    if (x + it.w > pageW) {
      x = 0;
      y += shelfH + GAP;
      shelfH = 0;
    }
    if (y + it.h > PAGE_MAX) {
      pages.push(page);
      page = { w: pageW, h: 0, placed: [] };
      x = 0;
      y = 0;
      shelfH = 0;
    }
    page.placed.push({ item: it, x, y });
    page.h = Math.max(page.h, y + it.h);
    shelfH = Math.max(shelfH, it.h);
    // keep every image on an 8 px grid, so the frame edges stay on texel
    // boundaries for the first three mip levels
    x += Math.ceil((it.w + GAP) / 8) * 8;
  }
  pages.push(page);
  // the packed pages (not the oversize singles) round up to a power of two
  for (const p of pages) if (p.w === pageW && fits.includes(p.placed[0]?.item)) p.h = pot(p.h);
  return pages;
}

export interface OverhaulReport { frames: number; added: number; pages: number; skipped: string[] }

/**
 * Move every loaded overhaul image into its atlas. Run once in the boot
 * scene's create(), before animations are built from frame names.
 */
export function installOverhaul(scene: Phaser.Scene): OverhaulReport {
  const textures = scene.textures;
  const data = scene.cache.json.get(OVERHAUL_MANIFEST) as OverhaulManifest | undefined;
  const report: OverhaulReport = { frames: 0, added: 0, pages: 0, skipped: [] };
  const byTex = new Map<string, Item[]>();
  for (const e of data?.images ?? []) {
    if (!e?.key || e.key.startsWith('bg/')) continue;
    const loadedKey = PREFIX + e.key;
    if (!textures.exists(loadedKey)) {
      report.skipped.push(e.key);
      continue;
    }
    const dest = target(textures, e.key);
    const img = textures.get(loadedKey).getSourceImage() as HTMLImageElement;
    if (!dest || !img || !(img.width > 0)) {
      report.skipped.push(e.key);
      textures.remove(loadedKey);
      continue;
    }
    const list = byTex.get(dest.tex) ?? [];
    const item: Item = { key: e.key, img, w: img.width, h: img.height, tex: dest.tex, frame: dest.frame, slice: null };
    if (STRETCH.test(e.key)) {
      const compact = compactStretch(img);
      if (compact) Object.assign(item, compact);
    }
    list.push(item);
    byTex.set(dest.tex, list);
  }

  for (const [texKey, items] of byTex) {
    const pages = packPages(items);
    const canvases = pages.map((p) => {
      const c = document.createElement('canvas');
      c.width = p.w;
      c.height = p.h;
      const ctx = c.getContext('2d');
      for (const pl of p.placed) ctx?.drawImage(pl.item.img, pl.x, pl.y);
      return c;
    });
    report.pages += pages.length;

    let tex: Phaser.Textures.Texture;
    let first: number;
    if (textures.exists(texKey)) {
      tex = textures.get(texKey);
      first = tex.source.length;
      for (const c of canvases) tex.source.push(new Phaser.Textures.TextureSource(tex, c, c.width, c.height));
    } else {
      // a brand-new texture: page 0 is its base source
      tex = textures.create(texKey, canvases[0], canvases[0].width, canvases[0].height) as Phaser.Textures.Texture;
      first = 0;
      for (const c of canvases.slice(1)) tex.source.push(new Phaser.Textures.TextureSource(tex, c, c.width, c.height));
    }

    pages.forEach((p, pi) => {
      for (const { item, x, y } of p.placed) {
        let ratioW = 1;
        let ratioH = 1;
        if (tex.has(item.frame)) {
          const old = tex.get(item.frame);
          ratioW = old.realWidth / item.w;
          ratioH = old.realHeight / item.h;
          tex.remove(item.frame);
          report.frames++;
        } else {
          report.added++;
        }
        const f = tex.add(item.frame, first + pi, x, y, item.w, item.h);
        const info: OverhaulData = { key: item.key, ratioW, ratioH, slice: item.slice };
        if (f) (f.customData as { overhaul?: OverhaulData }).overhaul = info;
        textures.remove(PREFIX + item.key);
      }
    });
  }
  return report;
}

/** Insets of the flat middle of a stretchable frame, in frame pixels, and
 *  the size the delivered image had before its middle was cut down. */
export interface Slice { l: number; r: number; t: number; b: number; w0: number; h0: number }

interface OverhaulData { key: string; ratioW: number; ratioH: number; slice: Slice | null }

/** Delivered art that is drawn stretched (rule 8 of the brief). */
const STRETCH = /^(ui\/btn_\w+|ui\/panel_big|v2\/ui_dialog)$/;

/** Width kept of a stretchable frame's flat middle. */
const MIDDLE = 32;

/**
 * Cut a stretchable image down to its caps plus a `MIDDLE`-wide strip of its
 * flat middle (and the same for rows, where the flat run is long enough).
 * Every middle column is identical, so the stretched result is the same; but
 * the middle is then only ever magnified. Left at 512 px, a small button
 * squeezed it twenty-fold, the GPU picked a tiny mip level for it, and the
 * outline across the middle faded to a translucent band.
 */
function compactStretch(img: HTMLImageElement | HTMLCanvasElement): Pick<Item, 'img' | 'w' | 'h' | 'slice'> | null {
  const w = img.width;
  const h = img.height;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  src.getContext('2d')?.drawImage(img, 0, 0);
  const z = flatZone(src, 0, 0, w, h);
  if (!z) return null;
  const midW = Math.min(MIDDLE, w - z.l - z.r);
  const midH = h - z.t - z.b >= MIDDLE * 2 ? MIDDLE : h - z.t - z.b;
  const out = document.createElement('canvas');
  out.width = z.l + midW + z.r;
  out.height = z.t + midH + z.b;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const xs: [number, number, number][] = [[0, z.l, 0], [z.l, midW, z.l], [w - z.r, z.r, z.l + midW]];
  const ys: [number, number, number][] = [[0, z.t, 0], [z.t, midH, z.t], [h - z.b, z.b, z.t + midH]];
  for (const [sx, sw, dx] of xs) {
    for (const [sy, sh, dy] of ys) {
      if (sw > 0 && sh > 0) ctx.drawImage(src, sx, sy, sw, sh, dx, dy, sw, sh);
    }
  }
  return { img: out, w: out.width, h: out.height, slice: z };
}

/**
 * Find the flat middle of a stretchable frame: the longest run of identical
 * columns, and of identical rows. Measured from the pixels rather than taken
 * from the delivery notes, so a re-delivered button with a different cap
 * still slices where its own art is flat.
 */
function flatZone(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): Slice | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const px = new Uint32Array(ctx.getImageData(x, y, w, h).data.buffer);
  const longestRun = (n: number, same: (i: number) => boolean): [number, number] => {
    let best: [number, number] = [0, 0];
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (!same(i)) start = i;
      if (i - start > best[1] - best[0]) best = [start, i];
    }
    return best;
  };
  const cols = longestRun(w, (i) => {
    for (let r = 0; r < h; r++) if (px[r * w + i] !== px[r * w + i - 1]) return false;
    return true;
  });
  const rows = longestRun(h, (j) => {
    for (let c = 0; c < w; c++) if (px[j * w + c] !== px[(j - 1) * w + c]) return false;
    return true;
  });
  if (cols[1] - cols[0] < 4) return null;
  return { l: cols[0], r: w - 1 - cols[1], t: rows[0], b: h - 1 - rows[1], w0: w, h0: h };
}

/**
 * Where a stretchable overhaul frame may be cut for a 9-slice, or null when
 * it should be drawn as a plain image (today's art, or the Canvas renderer,
 * which has no NineSlice).
 */
export function sliceOf(scene: Phaser.Scene, tex: string, frame: string): Slice | null {
  if (scene.renderer.type !== Phaser.WEBGL) return null;
  return data(scene, tex, frame)?.slice ?? null;
}

/**
 * Draw a stretchable frame at `w × h`. Only the flat middle stretches; the
 * caps keep their shape, scaled uniformly by `k` (frame px → screen px), and
 * are squeezed only when the box is too small to hold both caps at that scale.
 * `rows` false keeps the frame's own height (a 3-slice) and fits it by scale.
 */
export function addSliced(
  scene: Phaser.Scene, x: number, y: number, tex: string, frame: string,
  w: number, h: number, sl: Slice, k: number, rows: boolean,
): { obj: Phaser.GameObjects.NineSlice; sx: number; sy: number } {
  const innerW = Math.max(w / k, sl.l + sl.r + 2);
  const innerH = rows ? Math.max(h / k, sl.t + sl.b + 2) : scene.textures.getFrame(tex, frame).height;
  const obj = rows
    ? scene.add.nineslice(x, y, tex, frame, innerW, innerH, sl.l, sl.r, sl.t, sl.b)
    : scene.add.nineslice(x, y, tex, frame, innerW, 0, sl.l, sl.r, 0, 0);
  const sx = w / innerW;
  const sy = h / innerH;
  obj.setScale(sx, sy);
  return { obj, sx, sy };
}

function data(scene: Phaser.Scene, tex: string, frame: string): OverhaulData | undefined {
  if (!scene.textures.exists(tex)) return undefined;
  const t = scene.textures.get(tex);
  if (!t.has(frame)) return undefined;
  return (t.get(frame).customData as { overhaul?: OverhaulData } | null)?.overhaul;
}

/** True when this frame is overhaul art. */
export function isOverhaul(scene: Phaser.Scene, tex: string, frame: string): boolean {
  return !!data(scene, tex, frame);
}

/**
 * Old width over new width for a replaced frame (1 for anything else).
 * Multiply a native-size scale by this to keep the size the code was tuned
 * for: a cloud delivered at 2x then still covers the same ground.
 */
export function nativeRatio(scene: Phaser.Scene, tex: string, frame: string): number {
  return data(scene, tex, frame)?.ratioW ?? 1;
}

/** True when the `overhaul` texture carries this new key (rocks, craters, ground). */
export function hasOverhaul(scene: Phaser.Scene, frame: string): boolean {
  return scene.textures.exists(OVERHAUL) && scene.textures.get(OVERHAUL).has(frame);
}

/** Size an image to fit a box without stretching it. The new HUD glyphs are
 *  square; today's call sites pass the old, narrower boxes. */
export function fitInto<T extends Phaser.GameObjects.Image>(img: T, w: number, h: number): T {
  const k = Math.min(w / Math.max(1, img.frame.realWidth), h / Math.max(1, img.frame.realHeight));
  return img.setScale(k);
}
