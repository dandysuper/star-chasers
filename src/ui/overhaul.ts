/**
 * Art overhaul (artoverhaul.md): optional replacement art that lands through
 * `public/assets/overhaul/manifest.json`, like the planet and rover packs.
 *
 * `work/install-overhaul.py` packs the delivered files into a few
 * power-of-two pages (so they get mipmaps: the rocket parts are drawn 6x
 * smaller than delivered and would shimmer without them). Each frame in the
 * manifest names the atlas frame it *replaces* (`ui/btn_blue`, `v2/tower`,
 * `minions/minions_chemist`), so at boot the page is spliced into that atlas
 * and every `add.image(x, y, 'ui', 'btn_blue')` in the game picks up the new
 * art untouched. Keys with no frame today (explore rocks and craters, the
 * planet ground tiles) live in an `overhaul` texture of their own. Backdrops
 * are loaded straight under the existing `bg_*` keys.
 *
 * A replaced frame remembers how big the old one was (`nativeRatio`), for the
 * few call sites that size art by its pixel size rather than by a display size.
 */
import Phaser from 'phaser';

export const OVERHAUL = 'overhaul';
export const OVERHAUL_MANIFEST = 'overhaul_manifest';
const PAGE_PREFIX = 'ov_page_';
const DIR = 'assets/overhaul/';

/** Insets of the flat middle of a stretchable frame, in frame pixels, and
 *  the size the delivered image had before its middle was cut down. */
export interface Slice { l: number; r: number; t: number; b: number; w0: number; h0: number }

interface PageFrame { key: string; tex: string; frame: string; x: number; y: number; w: number; h: number; slice?: Slice }
interface Page { file: string; tex: string | null; frames: PageFrame[] }

export interface OverhaulManifest {
  images?: { key: string; file: string }[];
  pages?: Page[];
}

interface OverhaulData { key: string; ratioW: number; slice: Slice | null }

/**
 * Queue the overhaul manifest, then its pages. Backdrops come from the
 * overhaul folder when the manifest lists them and from `assets/bg/`
 * otherwise, so they are queued only once the manifest is known (or missing).
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
      const key = img?.key?.startsWith('bg/') ? `bg_${img.key.slice(3)}` : '';
      if (!key || !(key in backdrops) || !img.file) continue;
      fromOverhaul.add(key);
      load.image(key, DIR + img.file);
    }
    (data?.pages ?? []).forEach((p, i) => { if (p?.file) load.image(PAGE_PREFIX + i, DIR + p.file); });
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

export interface OverhaulReport { frames: number; added: number; pages: number; skipped: string[] }

/**
 * Point every overhaul frame at its page. Run once in the boot scene's
 * create(), before animations are built from frame names. No pixels are
 * copied: a page's TextureSource (and its GPU texture) is shared by every
 * atlas it replaces frames in.
 */
export function installOverhaul(scene: Phaser.Scene): OverhaulReport {
  const textures = scene.textures;
  const data = scene.cache.json.get(OVERHAUL_MANIFEST) as OverhaulManifest | undefined;
  const report: OverhaulReport = { frames: 0, added: 0, pages: 0, skipped: [] };
  (data?.pages ?? []).forEach((page, i) => {
    const pageKey = PAGE_PREFIX + i;
    if (!textures.exists(pageKey)) {
      report.skipped.push(...page.frames.map((f) => f.key));
      return;
    }
    report.pages++;
    const source = textures.get(pageKey).source[0];
    // the page of new keys simply becomes the `overhaul` texture
    if (page.tex === OVERHAUL && !textures.exists(OVERHAUL)) textures.renameTexture(pageKey, OVERHAUL);
    for (const f of page.frames) {
      if (!textures.exists(f.tex)) {
        report.skipped.push(f.key);     // the atlas it replaces did not load
        continue;
      }
      const tex = textures.get(f.tex);
      let idx = tex.source.indexOf(source);
      if (idx < 0) {
        idx = tex.source.length;
        tex.source.push(source);
      }
      let ratioW = 1;
      if (tex.has(f.frame)) {
        ratioW = tex.get(f.frame).realWidth / (f.slice?.w0 ?? f.w);
        tex.remove(f.frame);
        report.frames++;
      } else {
        report.added++;
      }
      const frame = tex.add(f.frame, idx, f.x, f.y, f.w, f.h);
      if (frame) (frame.customData as { overhaul?: OverhaulData }).overhaul = { key: f.key, ratioW, slice: f.slice ?? null };
    }
  });
  return report;
}

function data(scene: Phaser.Scene, tex: string, frame: string): OverhaulData | undefined {
  if (!scene.textures.exists(tex)) return undefined;
  const t = scene.textures.get(tex);
  if (!t.has(frame)) return undefined;
  return (t.get(frame).customData as { overhaul?: OverhaulData } | null)?.overhaul;
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
