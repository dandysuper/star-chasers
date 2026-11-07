import Phaser from 'phaser';
import type { SampleDef } from '../data/planets';

/**
 * A sample icon fitted to `size` on its longest edge: the dedicated art from
 * reqassets.md when it is loaded, otherwise the shared `resources` frame under
 * the sample's tint.
 */
export function addSampleIcon(
  scene: Phaser.Scene, x: number, y: number, def: SampleDef, size: number,
): Phaser.GameObjects.Image {
  const img = def.art && scene.textures.exists(def.art)
    ? scene.add.image(x, y, def.art)
    : scene.add.image(x, y, 'resources', def.frame).setTint(def.tint ?? 0xffffff);
  return img.setScale(size / Math.max(img.width, img.height, 1));
}
