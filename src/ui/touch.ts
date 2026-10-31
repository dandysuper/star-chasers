import Phaser from 'phaser';
import { t } from '../core/i18n';
import { COL, TXT } from './widgets';
import { V2, UI_V2_ART, hasV2 } from './theme';

export interface TouchControlsOpts {
  /** Initial label on the right-hand action button (defaults to `E`). */
  actionLabel?: string;
}

/**
 * On-screen smartphone / tablet controls:
 *   • Left thumb: floating/anchored virtual joystick (outer ring + thumb knob)
 *     returning a normalized (-1..1, -1..1) vector.
 *   • Right thumb: chunky round action button (`E` / interact / drill / transmit)
 *     with a `consumeAction()` one-shot pulse and contextual label.
 *   • Multi-touch safe: tracks each control's active pointer ID independently
 *     so the player can walk and press the action button at the same time.
 */
export class TouchControls {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly scene: Phaser.Scene;
  private readonly baseGfx: Phaser.GameObjects.Graphics;
  private readonly knobGfx: Phaser.GameObjects.Graphics;
  private readonly actionContainer: Phaser.GameObjects.Container;
  private readonly actionBg: Phaser.GameObjects.Graphics;
  private readonly actionLabel: Phaser.GameObjects.Text;
  private readonly joyX: number;
  private readonly joyY: number;
  private readonly joyRadius = 56;
  private readonly knobRadius = 24;
  private readonly actionX: number;
  private readonly actionY: number;
  private readonly actionRadius = 42;

  private joyPointerId: number | null = null;
  private _dx = 0;
  private _dy = 0;
  private actionJustPressed = false;
  private actionPulse = false;

  constructor(scene: Phaser.Scene, opts: TouchControlsOpts = {}) {
    this.scene = scene;
    const { width, height } = scene.scale;

    // Ensure at least 2 simultaneous touch pointers are active
    if (scene.input.manager && scene.input.manager.pointersTotal < 3) {
      scene.input.addPointer(2);
    }

    this.joyX = 110;
    this.joyY = height - 118;
    this.actionX = width - 104;
    this.actionY = height - 118;

    // ---- Virtual joystick (bottom-left) ----
    this.baseGfx = scene.add.graphics().setScrollFactor(0).setDepth(85);
    this.drawBase(false);

    this.knobGfx = scene.add.graphics().setScrollFactor(0).setDepth(86);
    this.drawKnob(0, 0, false);

    // ---- Action button (bottom-right) ----
    this.actionContainer = scene.add.container(this.actionX, this.actionY)
      .setScrollFactor(0).setDepth(85);
    this.actionBg = scene.add.graphics();
    this.drawActionBg(false, false);
    this.actionContainer.add(this.actionBg);

    if (hasV2(scene, UI_V2_ART.cursorHand)) {
      const hand = scene.add.image(0, -10, V2, UI_V2_ART.cursorHand)
        .setDisplaySize(26, 30).setAlpha(0.92);
      this.actionContainer.add(hand);
    }

    this.actionLabel = scene.add.text(
      0,
      hasV2(scene, UI_V2_ART.cursorHand) ? 16 : 0,
      opts.actionLabel ?? t('touch.action'),
      {
        ...TXT.body,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#1d1b2e',
        strokeThickness: 4,
      },
    ).setOrigin(0.5);
    this.actionContainer.add(this.actionLabel);

    this.objects.push(this.baseGfx, this.knobGfx, this.actionContainer);

    // ---- Pointer listeners (multi-touch aware) ----
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Horizontal axis in [-1, 1]. */
  get dx(): number {
    return this._dx;
  }

  /** Vertical axis in [-1, 1]. */
  get dy(): number {
    return this._dy;
  }

  /** Consume a single press of the right-hand action button. */
  consumeAction(): boolean {
    if (!this.actionJustPressed) return false;
    this.actionJustPressed = false;
    return true;
  }

  /** Highlight and relabel the action button when near an interactive target. */
  setActionState(active: boolean, label?: string): void {
    if (label !== undefined && this.actionLabel.text !== label) {
      this.actionLabel.setText(label);
    }
    if (this.actionPulse !== active) {
      this.actionPulse = active;
      this.drawActionBg(false, active);
    }
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    // Check action button first (bottom-right)
    const distAction = Math.hypot(p.x - this.actionX, p.y - this.actionY);
    if (distAction <= this.actionRadius + 18) {
      this.actionJustPressed = true;
      this.drawActionBg(true, this.actionPulse);
      this.actionContainer.setScale(0.94);
      return;
    }

    // Check joystick activation zone (generous bottom-left quadrant)
    const distJoy = Math.hypot(p.x - this.joyX, p.y - this.joyY);
    if (this.joyPointerId === null && distJoy <= this.joyRadius + 36) {
      this.joyPointerId = p.id;
      this.drawBase(true);
      this.updateStick(p.x, p.y);
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.joyPointerId !== null && p.id === this.joyPointerId) {
      if (!p.isDown) {
        this.resetStick();
        return;
      }
      this.updateStick(p.x, p.y);
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.joyPointerId !== null && p.id === this.joyPointerId) {
      this.resetStick();
    }
    this.drawActionBg(false, this.actionPulse);
    this.actionContainer.setScale(1);
  }

  private updateStick(px: number, py: number): void {
    const rx = px - this.joyX;
    const ry = py - this.joyY;
    const dist = Math.hypot(rx, ry);
    const deadZone = 7;
    if (dist < deadZone) {
      this._dx = 0;
      this._dy = 0;
      this.drawKnob(0, 0, true);
      return;
    }
    const clamped = Math.min(dist, this.joyRadius);
    const nx = rx / dist;
    const ny = ry / dist;
    const mag = clamped / this.joyRadius;
    this._dx = nx * mag;
    this._dy = ny * mag;
    this.drawKnob(nx * clamped, ny * clamped, true);
  }

  private resetStick(): void {
    this.joyPointerId = null;
    this._dx = 0;
    this._dy = 0;
    this.drawBase(false);
    this.drawKnob(0, 0, false);
  }

  private drawBase(active: boolean): void {
    const g = this.baseGfx;
    g.clear();
    g.fillStyle(COL.panelDark, active ? 0.68 : 0.48);
    g.fillCircle(this.joyX, this.joyY, this.joyRadius);
    g.lineStyle(3, active ? COL.accent : 0x5c6299, active ? 0.9 : 0.65);
    g.strokeCircle(this.joyX, this.joyY, this.joyRadius);
    // subtle directional pips
    g.fillStyle(0xcfd2ff, 0.35);
    for (const [ox, oy] of [[0, -38], [0, 38], [-38, 0], [38, 0]]) {
      g.fillCircle(this.joyX + ox, this.joyY + oy, 3);
    }
  }

  private drawKnob(ox: number, oy: number, active: boolean): void {
    const g = this.knobGfx;
    g.clear();
    const kx = this.joyX + ox;
    const ky = this.joyY + oy;
    g.fillStyle(active ? COL.accent : 0x4b5296, active ? 0.92 : 0.78);
    g.fillCircle(kx, ky, this.knobRadius);
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(kx - 5, ky - 6, this.knobRadius * 0.45);
    g.lineStyle(3, COL.panelDark, 0.95);
    g.strokeCircle(kx, ky, this.knobRadius);
  }

  private drawActionBg(pressed: boolean, ready: boolean): void {
    const g = this.actionBg;
    g.clear();
    const fill = ready ? 0x4f9142 : 0x3a6bb5;
    const rim = ready ? COL.accent : 0x8fa8ff;
    g.fillStyle(fill, pressed ? 0.95 : ready ? 0.88 : 0.62);
    g.fillCircle(0, 0, this.actionRadius);
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(-6, -8, this.actionRadius * 0.5);
    g.lineStyle(3.5, COL.panelDark, 1);
    g.strokeCircle(0, 0, this.actionRadius);
    g.lineStyle(2, rim, ready ? 0.95 : 0.65);
    g.strokeCircle(0, 0, this.actionRadius - 4);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
  }
}
