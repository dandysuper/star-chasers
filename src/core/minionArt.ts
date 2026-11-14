/**
 * minionArt.ts — one size for every minion on screen.
 *
 * The v2 crew sheets were cut per component, so every frame is a tight box
 * around the character and no shared anchor survived: the idle pose is 220 px
 * tall, while walk frames run anywhere from 101 to 192 px. Drawn at one fixed
 * scale the crew visibly pops between standing and walking, and a chemist
 * standing next to a mechanic is a different size for no reason.
 *
 * So the render is driven by height rather than by a scale constant: every
 * frame is scaled until the character is MINION_HEIGHT tall and anchored by its
 * feet, which is also what depth sorting wants.
 */
import Phaser from 'phaser';

/** Rendered height of any minion, in world px. The astronaut stands ~90, so
 *  the crew reads as slightly smaller than the player. */
export const MINION_HEIGHT = 88;
/** A stable foot-sized body; animated frames have very different dimensions. */
export const MINION_BODY_FOOT_OFFSET = 14;

export function addMinionCollider(scene: Phaser.Scene, x: number, footY: number): {
  zone: Phaser.GameObjects.Zone;
  body: Phaser.Physics.Arcade.Body;
} {
  const zone = scene.add.zone(x, footY - MINION_BODY_FOOT_OFFSET, 34, 28);
  scene.physics.add.existing(zone);
  const body = zone.body as Phaser.Physics.Arcade.Body;
  body.setCollideWorldBounds(true);
  body.setAllowGravity(false);
  return { zone, body };
}

type Sized = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

/** Scale one sprite so its current frame is exactly `height` px tall, feet at
 *  the sprite's y. Cheap enough to run on every animation frame. */
export function fitMinion(go: Sized, height = MINION_HEIGHT): void {
  const frame = go.frame;
  if (!frame || frame.height <= 0) return;
  go.setScale(height / frame.height);
  go.setOrigin(0.5, 1);
}

/** Keep a sprite at a constant rendered height for its whole walk cycle, and
 *  re-fit it whenever the animation swaps frames or a pose is set by hand. */
export function attachMinionFit(go: Sized, height = MINION_HEIGHT): void {
  const fit = () => fitMinion(go, height);
  go.on(Phaser.Animations.Events.ANIMATION_UPDATE, fit);
  go.on(Phaser.Animations.Events.ANIMATION_START, fit);
  fitMinion(go, height);
}
