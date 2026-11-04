/**
 * crew.ts — animated base crew.
 *
 * The v2 drop ships walk cycles for four minions in four directions (the first
 * three are 4 frames wide, the chemist is 6), plus one standing pose each. A
 * crew member walks a waypoint loop, and at some waypoints stops for a breather
 * on its idle frame — a crew that never stops reads as a bug, not as life.
 *
 * Direction comes from the movement vector and the art has real left/right
 * frames, so nothing is flipped.
 */
import Phaser from 'phaser';
import { V2 } from '../ui/theme';
import { MINION_HEIGHT, attachMinionFit, fitMinion } from './minionArt';
import { mumble } from './minionVoice';

export type CrewWho = 'mechanic' | 'driller' | 'radio' | 'chemist';

type Dir = 'front' | 'back' | 'left' | 'right';

export interface CrewSpec {
  who: CrewWho;
  /** Waypoint loop in world px. Two points make a there-and-back patrol. */
  path: { x: number; y: number }[];
  /** World px per second. */
  speed?: number;
  /** Rendered height in world px. Defaults to the shared minion height. */
  height?: number;
}

const DEFAULT_SPEED = 46;
/** Arrive tolerance so the sprite does not jitter on the waypoint. */
const ARRIVE_EPS = 6;
/** How long a breather lasts, and how often one happens. */
const IDLE_MIN_MS = 1400;
const IDLE_MAX_MS = 3200;
const IDLE_CHANCE = 0.55;

export class CrewMember {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly scene: Phaser.Scene;
  private readonly who: CrewWho;
  private readonly path: { x: number; y: number }[];
  private readonly speed: number;
  private readonly height: number;
  private readonly animPrefix: string;
  private readonly walkReady: boolean;
  private readonly idleFrame: string | null;
  private next = 0;
  private dir: Dir = 'front';
  /** Milliseconds left of the current breather (0 = walking). */
  private idleLeft = 0;

  constructor(scene: Phaser.Scene, spec: CrewSpec) {
    this.scene = scene;
    this.who = spec.who;
    this.path = spec.path;
    this.speed = spec.speed ?? DEFAULT_SPEED;
    this.height = spec.height ?? MINION_HEIGHT;
    this.animPrefix = `minion_${spec.who}_walk`;
    this.walkReady = scene.anims.exists(`${this.animPrefix}_front`);

    const idleKey = `minion_idle_${spec.who}`;
    this.idleFrame = scene.textures.exists(V2) && scene.textures.get(V2).has(idleKey) ? idleKey : null;

    const start = this.path[0];
    this.sprite = scene.add.sprite(start.x, start.y, V2, `minion_${spec.who}_front_0`)
      .setDepth(start.y);
    // Height, not scale: the cut frames have no shared anchor, so a fixed scale
    // makes the crew change size as the animation walks through its frames.
    attachMinionFit(this.sprite, spec.height ?? MINION_HEIGHT);
    this.next = this.path.length > 1 ? 1 : 0;
    this.play();
  }

  /** Advance one frame. `delta` is Phaser's frame delta in ms. */
  update(delta: number): void {
    if (this.idleLeft > 0) {
      this.idleLeft -= delta;
      if (this.idleLeft <= 0) {
        this.idleLeft = 0;
        this.next = (this.next + 1) % this.path.length;
        this.resume();
      }
      return;
    }

    if (this.path.length < 2) { this.play(); return; }
    const target = this.path[this.next];
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_EPS) {
      // stop here for a moment, then carry on: the waypoint is only consumed
      // once the breather ends, so nobody drifts off the path mid-idle
      if (this.tryIdle()) return;
      this.next = (this.next + 1) % this.path.length;
      this.play();
      return;
    }
    const step = Math.min(dist, (this.speed * delta) / 1000);
    this.sprite.x += (dx / dist) * step;
    this.sprite.y += (dy / dist) * step;
    this.sprite.setDepth(this.sprite.y);
    this.face(dx, dy);
    this.play();
  }

  /** Vertical travel wins over horizontal so a diagonal reads as walking away
   *  from or toward the camera rather than as a crab-walk. */
  private face(dx: number, dy: number): void {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ay > ax) this.dir = dy > 0 ? 'front' : 'back';
    else this.dir = dx > 0 ? 'right' : 'left';
  }

  /** Start a breather on the idle frame, if this member has one. */
  private tryIdle(): boolean {
    if (!this.idleFrame || Math.random() > IDLE_CHANCE) return false;
    this.idleLeft = Phaser.Math.Between(IDLE_MIN_MS, IDLE_MAX_MS);
    this.sprite.anims.stop();
    this.sprite.setTexture(V2, this.idleFrame);
    // the idle pose is cut taller than any walk frame — re-fit or the minion
    // visibly grows the moment it stops walking
    fitMinion(this.sprite, this.height);
    // stopping for breath is when a minion talks to itself, so the voice comes
    // from the character standing there rather than from a point in the world
    this.speak();
    return true;
  }

  /** Say something. `force` is for a line the player caused — a greeting. */
  speak(force = false): void {
    mumble(this.scene, this.who, { force });
  }

  private resume(): void {
    if (!this.idleFrame) return;
    this.sprite.setTexture(V2, `minion_${this.who}_${this.dir}_0`);
    fitMinion(this.sprite, this.height);
    if (!this.walkReady) return;
    this.sprite.play(`${this.animPrefix}_${this.dir}`, true);
  }

  private play(): void {
    if (!this.walkReady) return;
    const key = `${this.animPrefix}_${this.dir}`;
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    this.sprite.play(key);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.destroy();
  }
}
