/**
 * rover.ts — the drivable surface rover for the Moon and Mars walks.
 *
 * Driving is "point and go", so the same code serves the keyboard and the
 * thumbstick: the stick picks the direction, the rover swings its nose toward
 * it at a fixed turn rate and only accelerates once it is roughly facing that
 * way. Letting go coasts it to a stop, slowly on the Moon (little grip in low
 * gravity), quicker on Mars.
 *
 * The physics body is an invisible Arcade zone the size of the wheelbase; the
 * picture, its shadow, the dust and the tyre tracks follow it. The picture is
 * the eight-way rover art from roverassets.md when it is loaded, otherwise the
 * existing three-quarter `machines_rover` sprite, mirrored to face its heading.
 */
import Phaser from 'phaser';
import { V2, FX_ART, hasV2 } from '../ui/theme';
import { nativeRatio } from '../ui/overhaul';
import { DecalTrail, decalScale, ensureTreadTexture } from '../ui/surfaceFx';

export interface RoverConfig {
  /** Top speed, px/s (walking is 150–160). */
  maxSpeed: number;
  /** Throttle acceleration, px/s². */
  accel: number;
  /** Deceleration with the stick released, px/s². */
  coast: number;
  /** Deceleration while turning to face away from the current heading, px/s². */
  brake: number;
  /** How fast the nose swings toward the stick, rad/s. */
  turnRate: number;
  /** Multiplied over the fallback sprite so it suits the planet. */
  tint?: number;
  /** Dust and track colours. */
  dustTint: number;
  trackTint: number;
  /** How hard the kicked-up dust falls back (low on the Moon: long arcs). */
  dustGravity: number;
  /** Seconds a tyre track stays visible. */
  trackLife: number;
}

/** Dedicated art keys, east-side directions; the west side is mirrored. */
export const ROVER_DIR_ART = {
  s: 'rover_s',
  se: 'rover_se',
  e: 'rover_e',
  ne: 'rover_ne',
  n: 'rover_n',
} as const;

/** Front-view badge for the driving HUD (roverassets.md); a 🚙 stands in without it. */
export const ROVER_ICON = 'rover_icon';

/** Optional sounds (roverassets.md); each one is skipped when not loaded. */
export const ROVER_SFX = {
  motor: 'rover_motor',
  bump: 'rover_bump',
  door: 'rover_door',
  horn: 'rover_horn',
} as const;

const DISPLAY_W = 150;
/** Wheelbase box the physics uses, px. */
const BODY_W = 104;
const BODY_H = 58;
/** Half the distance between the left and right wheel tracks, px. */
const TRACK_HALF = 30;
const TRACK_STEP = 9;
/** Width of one tyre's print across the direction of travel, px. */
const TRACK_W = 14;
/** A jump longer than this in one frame is a reposition, not driving, px. */
const TELEPORT = 120;

/** Astronaut frames for the driver's seat, one per facing. */
export interface DriverArt {
  texture: string;
  front: string;
  back: string;
  right: string;
  left: string;
}

/** Driver height on screen, px (the whole frame; only the top part shows). */
const DRIVER_H = 50;
/** Share of the astronaut frame drawn in the seat: helmet and chest. */
const DRIVER_CROP = 0.62;
/** Where the driver's waist sits in each east-side picture, in art pixels
 *  from its centre (the art is 512 px square), and which way they face.
 *  The west side mirrors x, and a right-facing driver turns left. */
const SEATS: Record<keyof typeof ROVER_DIR_ART, { x: number; y: number; face: 'front' | 'back' | 'right' }> = {
  s: { x: -4, y: 4, face: 'front' },
  se: { x: 18, y: -22, face: 'front' },
  e: { x: 22, y: -16, face: 'right' },
  ne: { x: 16, y: -40, face: 'back' },
  n: { x: 0, y: -30, face: 'back' },
};

/** Octant index → [art key, mirrored]. 0 = east, counting clockwise (y down). */
const OCTANTS: [keyof typeof ROVER_DIR_ART, boolean][] = [
  ['e', false], ['se', false], ['s', false], ['se', true],
  ['e', true], ['ne', true], ['n', false], ['ne', false],
];

export class Rover {
  readonly zone: Phaser.GameObjects.Zone;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly view: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly dust?: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly tracks: DecalTrail;
  private readonly directional: boolean;
  /** The astronaut in the seat, shown while occupied (directional art only). */
  private readonly driver?: Phaser.GameObjects.Image;
  private driverFrame = '';
  private motor?: Phaser.Sound.BaseSound;

  /** Radians, 0 = east, y down. Starts facing the way the fallback art does. */
  heading = Math.PI * 0.75;
  speed = 0;
  occupied = false;
  private readonly trackScale: number;
  private turnVel = 0;
  private travelled = 0;
  private sinceTrack = 0;
  /** Body position at the last update, for the distance actually driven. */
  private lastX: number;
  private lastY: number;
  private bumpCooldown = 0;
  private faceLeft = true;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly cfg: RoverConfig,
    private readonly driverArt?: DriverArt,
  ) {
    this.directional = Object.values(ROVER_DIR_ART).every((k) => scene.textures.exists(k));

    const treadKey = ensureTreadTexture(scene);
    this.tracks = new DecalTrail(scene, treadKey, 360, {
      tint: cfg.trackTint, alpha: 0.42, life: cfg.trackLife, depth: -8,
    });
    // painted tread art is drawn at a comfortable size; stamp it at the width
    // of the drawn fallback so the tracks match the wheels
    this.trackScale = decalScale(scene, treadKey, TRACK_W);

    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x000000, 0.28).fillEllipse(0, 0, DISPLAY_W * 0.86, 40);

    this.view = this.directional
      ? scene.add.image(x, y, ROVER_DIR_ART.se)
      : scene.add.image(x, y, 'machines', 'machines_rover');
    this.view.setScale(DISPLAY_W / Math.max(1, this.view.width));
    if (!this.directional && cfg.tint !== undefined) this.view.setTint(cfg.tint);
    // the seat positions are measured on the directional art; the fallback
    // sprite keeps the driver hidden, as before
    if (this.directional && driverArt && scene.textures.exists(driverArt.texture)) {
      this.driver = scene.add.image(x, y, driverArt.texture, driverArt.front).setVisible(false);
    }

    if (hasV2(scene, FX_ART.cloudS)) {
      // tuned on today's puff; the overhaul one is drawn at 2x
      const k = nativeRatio(scene, V2, FX_ART.cloudS);
      // outlined overhaul puffs stay upright (see the flight smoke)
      const spin = k !== 1 ? { min: -12, max: 12 } : { min: 0, max: 360 };
      this.dust = scene.add.particles(0, 0, V2, {
        frame: FX_ART.cloudS,
        lifespan: { min: 600, max: 1100 },
        speed: { min: 40, max: 110 },
        scale: { start: 0.22 * k, end: 0.62 * k },
        alpha: { start: 0.55, end: 0 },
        rotate: spin,
        gravityY: cfg.dustGravity,
        tint: cfg.dustTint,
        emitting: false,
      });
    }

    this.zone = scene.add.zone(x, y, BODY_W, BODY_H);
    scene.physics.add.existing(this.zone);
    this.body = this.zone.body as Phaser.Physics.Arcade.Body;
    this.body.setCollideWorldBounds(true);
    this.body.setImmovable(true);   // parked, the astronaut walks around it
    this.lastX = x;
    this.lastY = y;
    this.syncView(0);
  }

  get x(): number { return this.zone.x; }
  get y(): number { return this.zone.y; }

  /** Everything the rover draws, for camera ignore-lists. */
  get objects(): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [this.shadow, this.view, this.zone, ...this.tracks.objects];
    if (this.dust) out.push(this.dust);
    if (this.driver) out.push(this.driver);
    return out;
  }

  /** km/h for the HUD, at the game's scale of about 1 px ≈ 2.5 cm. */
  get kmh(): number {
    return Math.round(this.speed * 0.05);
  }

  setOccupied(on: boolean): void {
    this.occupied = on;
    this.body.setImmovable(!on);
    this.driver?.setVisible(on);
    if (on) this.syncView(0);
    if (!on) {
      this.speed = 0;
      this.body.setVelocity(0, 0);
      this.stopMotor();
    } else {
      this.startMotor();
    }
    this.play(ROVER_SFX.door, 0.6);
  }

  /** The collider fired: a hard knock stops the rover and shakes the view. */
  bump(): void {
    if (this.bumpCooldown > 0 || !this.occupied) return;
    this.bumpCooldown = 0.4;
    if (this.speed > 130) {
      this.scene.cameras.main.shake(180, 0.004);
      this.play(ROVER_SFX.bump, 0.7);
      this.scene.tweens.add({ targets: this.view, scaleY: this.view.scaleY * 0.9, duration: 70, yoyo: true });
    }
    this.speed *= 0.3;
  }

  honk(): void {
    this.play(ROVER_SFX.horn, 0.8);
  }

  /** Halt on the spot (drilling, transmitting, the pause menu). */
  halt(): void {
    this.speed = 0;
    this.body.setVelocity(0, 0);
  }

  /**
   * One frame of driving. `ix, iy` is the stick, -1..1 per axis; pass zeros
   * to coast. `dt` in seconds.
   */
  drive(ix: number, iy: number, dt: number): void {
    const c = this.cfg;
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    const m = Math.min(1, Math.hypot(ix, iy));
    if (m > 0.15) {
      const target = Math.atan2(iy, ix);
      const diff = Phaser.Math.Angle.Wrap(target - this.heading);
      // a stopped rover turns on the spot a little quicker, so a fresh press
      // never feels unresponsive
      const rate = c.turnRate * (this.speed < 40 ? 1.35 : 1);
      const step = Phaser.Math.Clamp(diff, -rate * dt, rate * dt);
      this.heading = Phaser.Math.Angle.Wrap(this.heading + step);
      this.turnVel = dt > 0 ? step / dt : 0;
      const align = Math.cos(diff);
      const cap = c.maxSpeed * m;
      if (align > 0.2) {
        this.speed = Math.min(cap, this.speed + c.accel * align * m * dt);
        if (this.speed > cap) this.speed = Math.max(cap, this.speed - c.brake * dt);
      } else {
        this.speed = Math.max(0, this.speed - c.brake * dt);
      }
    } else {
      this.speed = Math.max(0, this.speed - c.coast * dt);
      this.turnVel *= 0.8;
    }
    this.body.setVelocity(Math.cos(this.heading) * this.speed, Math.sin(this.heading) * this.speed);
  }

  /** Move the picture, shadow, dust and tracks onto the body. Call every frame. */
  update(dt: number): void {
    // distance the body really covered: the scene clamps a slow frame's dt,
    // but Arcade physics still moves the body for the whole frame
    let moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    if (moved > TELEPORT) moved = 0;
    this.travelled += moved;
    this.syncView(dt);
    this.tracks.update(dt);
    this.updateMotor();

    if (this.speed < 25) { this.sinceTrack = 0; return; }
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    // tyre tracks: one stamp under each rear wheel every few pixels. A slow
    // frame can carry the rover past several stamp spots at once, so each
    // stamp steps back along the heading to where the wheel was, instead of
    // piling onto the current spot and leaving a dashed track
    this.sinceTrack += moved;
    while (this.sinceTrack >= TRACK_STEP) {
      this.sinceTrack -= TRACK_STEP;
      const back = 26 + this.sinceTrack;
      const bx = this.x - cos * back;
      const by = this.y + 8 - sin * back;
      this.tracks.stamp(bx - sin * TRACK_HALF, by + cos * TRACK_HALF * 0.6, this.heading, this.trackScale);
      this.tracks.stamp(bx + sin * TRACK_HALF, by - cos * TRACK_HALF * 0.6, this.heading, this.trackScale);
    }
    // a rooster tail of dust thrown back and up from the wheels
    if (this.dust && this.speed > 70 && Math.random() < Math.min(1, this.speed / 260)) {
      const back = Phaser.Math.RadToDeg(this.heading + Math.PI);
      // bias the throw toward screen-up, so the dust arcs over and falls back
      const up = -90;
      const mid = back + Phaser.Math.Angle.ShortestBetween(back, up) * 0.35;
      this.dust.setEmitterAngle({ min: mid - 22, max: mid + 22 });
      const side = Math.random() < 0.5 ? -1 : 1;
      this.dust.emitParticleAt(
        this.x - cos * 40 + side * sin * TRACK_HALF,
        this.y + 6 - sin * 30 - side * cos * TRACK_HALF * 0.6,
      );
    }
  }

  private syncView(dt: number): void {
    const x = this.x;
    const y = this.y;
    const moving = this.speed > 5;
    // a little suspension bounce and a lean into turns sell the motion even
    // with a single sprite
    const bounce = moving ? Math.sin(this.travelled * 0.11) * 1.6 * Math.min(1, this.speed / 120) : 0;
    const lean = Phaser.Math.Clamp(-this.turnVel * 0.035, -0.09, 0.09);
    this.view.setPosition(x, y - 22 + bounce);
    if (this.directional) {
      const oct = ((Math.round(this.heading / (Math.PI / 4)) % 8) + 8) % 8;
      const [key, mirror] = OCTANTS[oct];
      if (this.view.texture.key !== ROVER_DIR_ART[key]) {
        this.view.setTexture(ROVER_DIR_ART[key]);
        this.view.setScale(DISPLAY_W / Math.max(1, this.view.width));
      }
      this.view.setFlipX(mirror);
      this.view.setRotation(lean * 0.5);
      if (this.driver?.visible) this.placeDriver(key, mirror);
    } else {
      // the fallback art faces front-left; mirrored, it faces front-right
      const cx = Math.cos(this.heading);
      if (cx > 0.2) this.faceLeft = false;
      else if (cx < -0.2) this.faceLeft = true;
      this.view.setFlipX(!this.faceLeft);
      this.view.setRotation(dt > 0 ? lean : 0);
    }
    this.shadow.setPosition(x + 4, y + 16);
    // drawn in front of whatever stands behind it, behind whatever is in front
    const depth = 1 + (y + BODY_H / 2) / 1000;
    this.view.setDepth(depth);
    this.shadow.setDepth(depth - 0.0005);
    this.dust?.setDepth(depth + 0.0005);
    this.driver?.setDepth(depth + 0.0002);
  }

  /** Sit the astronaut in the seat of the current picture, riding its bounce
   *  and lean; only the helmet and chest show above the cockpit. */
  private placeDriver(key: keyof typeof ROVER_DIR_ART, mirror: boolean): void {
    const d = this.driver!;
    const art = this.driverArt!;
    const seat = SEATS[key];
    const face = seat.face === 'right' && mirror ? 'left' : seat.face;
    const frame = art[face];
    if (frame !== this.driverFrame) {
      this.driverFrame = frame;
      d.setFrame(frame);
      d.setCrop(0, 0, d.frame.width, d.frame.height * DRIVER_CROP);
      d.setOrigin(0.5, DRIVER_CROP);
      d.setScale(DRIVER_H / d.frame.height);
    }
    const k = this.view.scaleX;
    const ox = seat.x * k * (mirror ? -1 : 1);
    const oy = seat.y * k;
    const r = this.view.rotation;
    d.setPosition(
      this.view.x + ox * Math.cos(r) - oy * Math.sin(r),
      this.view.y + ox * Math.sin(r) + oy * Math.cos(r),
    );
    d.setRotation(r);
  }

  private play(key: string, volume: number): void {
    if (!this.scene.cache.audio.exists(key)) return;
    try {
      this.scene.sound.play(key, { volume });
    } catch {
      // a browser that refuses to start a sound must not stop the rover
    }
  }

  private startMotor(): void {
    if (this.motor || !this.scene.cache.audio.exists(ROVER_SFX.motor)) return;
    try {
      this.motor = this.scene.sound.add(ROVER_SFX.motor, { loop: true, volume: 0 });
      this.motor.play();
    } catch {
      this.motor = undefined;
    }
  }

  private updateMotor(): void {
    const m = this.motor as (Phaser.Sound.BaseSound & { setVolume?(v: number): unknown; setRate?(r: number): unknown }) | undefined;
    if (!m) return;
    const k = Math.min(1, this.speed / this.cfg.maxSpeed);
    m.setVolume?.(0.18 + 0.32 * k);
    m.setRate?.(0.8 + 0.5 * k);
  }

  stopMotor(): void {
    if (!this.motor) return;
    try { this.motor.stop(); this.motor.destroy(); } catch { /* already gone */ }
    this.motor = undefined;
  }

  /** Pause or resume the engine loop with the game menu. */
  pauseMotor(paused: boolean): void {
    if (!this.motor) return;
    try {
      if (paused) this.motor.pause(); else this.motor.resume();
    } catch { /* already gone */ }
  }
}
