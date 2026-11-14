import Phaser from 'phaser';
import { foundationRects } from './opaqueRuns';

/** Match the visible footprint at one world pixel per cell. */
const CELL = 1;

export function addPixelFootprint(
  scene: Phaser.Scene,
  image: Phaser.GameObjects.Image,
  solids: Phaser.Physics.Arcade.StaticGroup,
): void {
  const thickness = Math.round(Phaser.Math.Clamp(image.displayHeight * 0.16, 20, 44));
  const width = Math.ceil(image.displayWidth / CELL);
  const height = Math.ceil(image.displayHeight / CELL);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Building collision mask requires a 2D canvas');
  ctx.imageSmoothingEnabled = false;
  const frame = image.frame;
  ctx.drawImage(
    frame.source.image as CanvasImageSource,
    frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
    0, 0,
    image.displayWidth / CELL, image.displayHeight / CELL,
  );
  const rgba = ctx.getImageData(0, 0, width, height).data;
  for (const rect of foundationRects(rgba, width, height, thickness)) {
    const left = image.x - image.displayWidth / 2 + rect.x * CELL;
    const top = image.y - image.displayHeight / 2 + rect.y * CELL;
    const w = Math.min(rect.width * CELL, image.displayWidth - rect.x * CELL);
    const h = Math.min(rect.height * CELL, image.displayHeight - rect.y * CELL);
    if (w <= 0 || h <= 0) continue;
    const zone = scene.add.zone(left + w / 2, top + h / 2, w, h);
    scene.physics.add.existing(zone, true);
    solids.add(zone);
  }
}
