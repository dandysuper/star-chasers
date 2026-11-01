import Phaser from 'phaser';
import { TouchControls } from '../ui/touch';
import { isTouchMode, onInputModeChange } from './device';

/** Shared keyboard + smartphone touch movement for the on-foot scenes.
 *
 *  The hub and the Moon walk both need the same thing: WASD, arrows, or virtual
 *  thumbstick, the four walk animations, an idle animation when stopped, and a
 *  single interact trigger (`E` or the on-screen action button). */
export class Walker {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly keyE: Phaser.Input.Keyboard.Key;
  readonly touch: TouchControls;
  private moving = false;
  /** While true the scene owns the sprite's texture and the walker only
   *  reports input — the hub uses it for the greet-by-waving pose. */
  hold = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprite: Phaser.Physics.Arcade.Sprite,
    private readonly astronaut: string,
    private readonly speed = 170,
  ) {
    const kb = scene.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keyE = kb.addKey('E');
    this.touch = new TouchControls(scene);

    // The pads exist for every input scheme but are only shown — and only
    // listen — on a touch device. Flipping a tablet out of its keyboard brings
    // them back without a reload.
    this.touch.setEnabled(isTouchMode());
    const unsubscribe = onInputModeChange(() => this.touch.setEnabled(isTouchMode()));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  /** True on the frame the interact key (`E`) or touch action button was pressed. */
  get interactJustPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keyE) || this.touch.consumeAction();
  }

  /** Apply keyboard or touch joystick input and the matching animation. */
  update(): { vx: number; vy: number; moving: boolean } {
    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    let vx = (left ? -this.speed : 0) + (right ? this.speed : 0);
    let vy = (up ? -this.speed : 0) + (down ? this.speed : 0);

    // Virtual joystick overrides when no keyboard directional key is held
    if (vx === 0 && vy === 0 && (this.touch.dx !== 0 || this.touch.dy !== 0)) {
      vx = this.touch.dx * this.speed;
      vy = this.touch.dy * this.speed;
    }

    this.sprite.setVelocity(vx, vy);

    this.moving = vx !== 0 || vy !== 0;
    if (this.moving) this.hold = false;
    if (this.hold) {
      // the scene is holding its own pose (the hub wave): keep the player
      // planted and leave the texture to whoever put it there
      this.sprite.setVelocity(0, 0);
      return { vx: 0, vy: 0, moving: false };
    }
    if (this.moving) {
      const dir = Math.abs(vx) > Math.abs(vy)
        ? (vx > 0 ? 'side_right' : 'side_left')
        : (vy > 0 ? 'front' : 'back');
      this.sprite.play(`astro_${this.astronaut}_walk_${dir}`, true);
    } else {
      // hold the facing we were last walking in
      const current = this.sprite.anims.currentAnim?.key ?? `astro_${this.astronaut}_walk_front`;
      const dir = current
        .replace(`astro_${this.astronaut}_walk_`, '')
        .replace(`astro_${this.astronaut}_idle_`, '');
      this.sprite.play(`astro_${this.astronaut}_idle_${dir}`, true);
    }
    return { vx, vy, moving: this.moving };
  }
}
