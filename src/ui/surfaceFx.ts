/**
 * Ground decoration for the planet walks: generated decal textures (boot
 * prints, tyre treads, the screen vignette) and a pooled trail that stamps and
 * fades them.
 *
 * The textures are drawn white so one texture serves every planet under a
 * tint; dedicated art from roverassets.md replaces them when it is loaded.
 */
import Phaser from 'phaser';

export const BOOT_KEY = 'fx_boot_print';
export const TREAD_KEY = 'fx_tread';
export const VIGNETTE_KEY = 'fx_vignette';

/** Optional painted replacements (roverassets.md). */
export const BOOT_ART = 'boot_print';
export const TREAD_ART = 'rover_track';

/** Boot print, toe pointing along +x: a sole with cross-ribbed tread. */
export function ensureBootTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(BOOT_ART)) return BOOT_ART;
  if (scene.textures.exists(BOOT_KEY)) return BOOT_KEY;
  // heel at the left, a gap for the arch, the broad sole and toe at the right,
  // with tread bars across the sole: it reads as a boot, not as a dash
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 1, 5, 7, 2);
  g.fillRoundedRect(7, 0, 9, 9, 4);
  g.fillStyle(0x000000, 1);
  for (const x of [9, 12]) g.fillRect(x, 1, 1, 7);
  g.generateTexture(BOOT_KEY, 16, 9);
  g.destroy();
  return BOOT_KEY;
}

/** One stamp of tyre tread, travel along +x: a block with chevron ribs. */
export function ensureTreadTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(TREAD_ART)) return TREAD_ART;
  if (scene.textures.exists(TREAD_KEY)) return TREAD_KEY;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.55);
  g.fillRect(0, 0, 10, 14);
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(1, 0, 6, 7, 1, 14);
  g.fillTriangle(5, 0, 10, 7, 5, 14);
  g.generateTexture(TREAD_KEY, 10, 14);
  g.destroy();
  return TREAD_KEY;
}

/** Transparent centre, dark rim: drawn over the world it frames the view. */
export function ensureVignetteTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(VIGNETTE_KEY)) return VIGNETTE_KEY;
  const w = 320;
  const h = 180;
  const tex = scene.textures.createCanvas(VIGNETTE_KEY, w, h);
  if (!tex) return VIGNETTE_KEY;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  tex.refresh();
  return VIGNETTE_KEY;
}

/** Scale that brings a decal texture to `across` px tall (its height runs
 *  across the line of travel). 1 for the generated fallbacks. */
export function decalScale(scene: Phaser.Scene, key: string, across: number): number {
  const frame = scene.textures.exists(key) ? scene.textures.getFrame(key) : null;
  if (!frame || frame.height <= 0) return 1;
  return across / frame.height;
}

interface Stamp { img: Phaser.GameObjects.Image; age: number }

/**
 * A fixed pool of decal images stamped along a path and faded out over
 * `life` seconds. The pool is allocated up front so every image exists before
 * a scene hands its camera ignore-lists out; the oldest stamp is reused when
 * the pool runs dry.
 */
export class DecalTrail {
  private readonly stamps: Stamp[] = [];
  private next = 0;

  constructor(
    scene: Phaser.Scene,
    texture: string,
    size: number,
    private readonly opts: { tint: number; alpha: number; life: number; depth: number },
  ) {
    for (let i = 0; i < size; i++) {
      const img = scene.add.image(-100, -100, texture)
        .setTint(opts.tint).setAlpha(0).setVisible(false).setDepth(opts.depth);
      this.stamps.push({ img, age: Infinity });
    }
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return this.stamps.map((s) => s.img);
  }

  stamp(x: number, y: number, rotation: number, scale = 1): void {
    const s = this.stamps[this.next];
    this.next = (this.next + 1) % this.stamps.length;
    s.age = 0;
    s.img.setPosition(x, y).setRotation(rotation).setScale(scale).setVisible(true).setAlpha(this.opts.alpha);
  }

  update(dt: number): void {
    for (const s of this.stamps) {
      if (s.age === Infinity) continue;
      s.age += dt;
      // full strength for the first half of its life, then a slow fade
      const k = s.age / this.opts.life;
      if (k >= 1) {
        s.age = Infinity;
        s.img.setVisible(false);
        continue;
      }
      s.img.setAlpha(this.opts.alpha * (k < 0.5 ? 1 : 1 - (k - 0.5) * 2));
    }
  }
}
