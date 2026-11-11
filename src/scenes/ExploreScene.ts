import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { MISSIONS, missionById, type MissionDef } from '../data/missions';
import {
  planetById, sampleDef, taskProgress, taskDone, requiredTasksDone, bonusTasksDone,
  sampleAdvancesTask, type PlanetDef, type SampleDef, type TaskDef, type TileArt,
} from '../data/planets';
import { makeIconButton, makePanel, ensureMusic, TXT } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { V2, FX_ART, UI_V2_ART, hasV2, makeSpeechBubble } from '../ui/theme';
import { OVERHAUL, hasOverhaul, nativeRatio } from '../ui/overhaul';
import { TouchControls } from '../ui/touch';
import { addSampleIcon } from '../ui/sampleArt';
import { isTouchMode, onInputModeChange } from '../core/device';
import { MINION_HEIGHT, attachMinionFit } from '../core/minionArt';
import {
  playAnyMinionVoice, playMinionSfx, playMinionVoice, stopMinionSound,
} from '../core/minionAudio';
import { Rover, ROVER_ICON } from '../core/rover';
import { DecalTrail, decalScale, ensureBootTexture, ensureVignetteTexture } from '../ui/surfaceFx';

const TILE = 64;
const MAP_W = 40;
const MAP_H = 30;
const SPAWN = { x: 400, y: 400 };
/** Where the rover waits, beside the lander. */
const ROVER_PARK = { x: SPAWN.x - 170, y: SPAWN.y + 90 };
/** Reach for drilling and transmitting, px: the rover's arm reaches further. */
const REACH_WALK = { sample: 64, lander: 96 };
const REACH_DRIVE = { sample: 96, lander: 140 };
/** How close the astronaut must stand to climb in. */
const BOARD_DIST = 110;
const ZOOM_WALK = 1.4;
const ZOOM_DRIVE = 1.12;
/** Fastest the helpers move when catching up after a drive, px/s (walking is 150–160). */
const CREW_JOG = 280;
/** Stride between boot prints, px. */
const STRIDE = 24;
/** Rover badge in the driving HUD box, px, and the left padding it sits in. */
const ICON_SIZE = 34;
const ICON_GUTTER = 44;

/** Draw order by where an object touches the ground: lower on screen is nearer. */
const depthAt = (footY: number) => 1 + footY / 1000;
/** Longest edge of a sample icon on the ground, px. */
const SAMPLE_SIZE = 60;
/** World px per pixel of the overhaul ground tile: its 256 px cover 192 px.
 *  Under the 1.4x walking zoom that is about one texel per screen pixel, and
 *  the repeat is wide enough that the tile's darker spots do not line up into
 *  a visible grid (at 128 px they did). */
const GROUND_SCALE = 0.75;
/** Repeats of the ground tile baked into one texture (4 × 256 = 1024, a
 *  power of two, so the texture wraps and gets mipmaps). */
const GROUND_REPS = 4;

interface Sample {
  def: SampleDef;
  go: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  x: number; y: number;
  collected: boolean;
  /** Ring colour last drawn, so it is only redrawn when the role changes. */
  wanted?: boolean;
  shadow?: Phaser.GameObjects.Ellipse;
}

interface Helper {
  go: Phaser.GameObjects.Image;
  bubble?: Phaser.GameObjects.Container;
  offset: { x: number; y: number };
  kind: string;
}

interface Speck { x: number; y: number; vx: number; vy: number; r: number; a: number; img?: Phaser.GameObjects.Image }

const MINIMAP_SIZE = 156;
const MINIMAP_RAD = 58;
const RING_WANTED = 0xffd23f;   // a sample one of the tasks still needs
const RING_SPARE = 0x59f7ff;    // any other sample

export class ExploreScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyWASD!: Record<string, Phaser.Input.Keyboard.Key>;
  /** E was pressed since the last frame: drill, transmit, or get in. */
  private actionQueued = false;
  private touch!: TouchControls;
  private lander!: Phaser.GameObjects.Image;
  private samples: Sample[] = [];
  private helpers: Helper[] = [];
  private inventory: string[] = [];
  private taskText!: Phaser.GameObjects.Text;
  private invText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private factBox?: Phaser.GameObjects.Container;
  private drill?: { sample: Sample; bar: Phaser.GameObjects.Graphics; timer: Phaser.Time.TimerEvent };
  private drilling = false;
  /** The drill's own engine loop, stopped when the sample breaks free. */
  private drillLoop?: Phaser.Sound.BaseSound;
  private rockGroup!: Phaser.Physics.Arcade.StaticGroup;
  private mission!: MissionDef;
  private planet!: PlanetDef;
  private startT = 0;
  private hintTimer = 0;
  private idleT = 0;
  private ended = false;
  private scoutArrow?: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  private minimapContainer?: Phaser.GameObjects.Container;
  private minimapDots?: Phaser.GameObjects.Graphics;
  private dustGfx?: Phaser.GameObjects.Graphics;
  private dustBox?: Phaser.GameObjects.Container;
  private dust: Speck[] = [];
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private inGameMenu!: InGameMenu;
  private pauseStart = 0;
  private rover!: Rover;
  /** True while the astronaut is at the rover's wheel. */
  private driving = false;
  /** F was pressed since the last frame: get in or out of the rover. */
  private toggleQueued = false;
  private roverText!: Phaser.GameObjects.Text;
  /** Painted rover badge inside the speedometer box (roverassets.md), if loaded. */
  private roverIcon?: Phaser.GameObjects.Image;
  private footprints!: DecalTrail;
  private bootScale = 1;
  private lastStep = { x: 0, y: 0 };
  private footSide = 1;
  private playerShadow!: Phaser.GameObjects.Ellipse;

  constructor() { super('explore'); }

  private get reach(): { sample: number; lander: number } {
    return this.driving ? REACH_DRIVE : REACH_WALK;
  }

  create(): void {
    ensureMusic(this, state.music);
    const { width, height } = this.scale;
    // a dev jump straight into the scene has no explore mission picked yet
    const picked = missionById(state.missionId);
    this.mission = picked?.kind === 'explore' ? picked : MISSIONS.moon;
    if (state.missionId !== this.mission.id) {
      state.mode = 'mission';
      state.missionId = this.mission.id;
    }
    this.planet = planetById(this.mission.planet);
    this.ended = false;
    this.tipShown = false;
    this.drilling = false;
    this.drill = undefined;
    this.factBox = undefined;
    this.scoutArrow = undefined;
    this.inventory = [];
    this.samples = [];
    this.helpers = [];
    this.dust = [];
    this.dustGfx = undefined;
    this.dustBox = undefined;
    this.minimapContainer = undefined;
    this.minimapDots = undefined;
    this.roverIcon = undefined;
    this.hudObjects = [];
    this.hintTimer = 0;
    this.idleT = 0;
    this.driving = false;
    this.footSide = 1;
    this.cameras.main.setBackgroundColor(this.planet.sky);
    this.startT = this.time.now;

    const rng = new Phaser.Math.RandomDataGenerator([`${Date.now() % 9973}`]);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.buildTerrain(rng);
    this.buildLander();

    // boot prints: on the Moon there is no wind, so they stay for ages
    const bootKey = ensureBootTexture(this);
    this.footprints = new DecalTrail(this, bootKey, 140, {
      tint: this.planet.surface.bootTint, alpha: 0.34, life: this.planet.surface.bootLife, depth: -8,
    });
    this.bootScale = decalScale(this, bootKey, 9);

    // --- player astronaut ---
    const g = state.astronaut;
    this.playerShadow = this.add.ellipse(0, 0, 46, 16, 0x000000, 0.26);
    this.player = this.physics.add.sprite(SPAWN.x + 90, SPAWN.y + 40, `astro_${g}_walk`, `astro_${g}_walk_front_0`);
    this.player.setCollideWorldBounds(true);
    this.player.setSize(50, 60);
    this.physics.add.collider(this.player, this.rockGroup);
    this.lastStep = { x: this.player.x, y: this.player.y };

    // --- the rover, parked beside the lander ---
    this.rover = new Rover(this, ROVER_PARK.x, ROVER_PARK.y, this.planet.rover, {
      texture: `astro_${g}_walk`,
      front: `astro_${g}_walk_front_0`,
      back: `astro_${g}_walk_back_0`,
      right: `astro_${g}_walk_side_right_0`,
      left: `astro_${g}_walk_side_left_0`,
    });
    this.physics.add.collider(this.rover.zone, this.rockGroup, () => this.rover.bump());
    this.physics.add.collider(this.player, this.rover.zone);

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.setZoom(ZOOM_WALK);

    this.buildSamples(rng);
    this.buildHelpers();

    // --- HUD: task checklist top-left, inventory under it ---
    this.taskText = this.add.text(12, 12, '', {
      ...TXT.small, fontSize: '15px', lineSpacing: 5,
      backgroundColor: '#1d1d3acc', padding: { x: 12, y: 8 },
    }).setScrollFactor(0).setDepth(50);
    this.invText = this.add.text(12, 0, '', {
      ...TXT.small, fontSize: '14px', backgroundColor: '#1d1d3a99', padding: { x: 10, y: 5 },
      wordWrap: { width: 420 },
    }).setScrollFactor(0).setDepth(50);
    this.promptText = this.add.text(width / 2, height - 90, '', {
      ...TXT.h2, fontSize: '20px', backgroundColor: '#1d1d3acc', padding: { x: 12, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(50);
    // speedometer + controls while driving, under the radar; the painted
    // rover badge, when there is one, sits in a gutter on the box's left
    const hasIcon = this.textures.exists(ROVER_ICON);
    this.roverText = this.add.text(width - MINIMAP_SIZE / 2 - 14, MINIMAP_SIZE + 52, '', {
      ...TXT.small, fontSize: '13px', color: '#ffffff', align: 'center',
      backgroundColor: '#1d1d3acc',
      padding: { left: hasIcon ? ICON_GUTTER : 8, right: 8, top: 4, bottom: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(50).setVisible(false);
    if (hasIcon) {
      this.roverIcon = this.add.image(0, 0, ROVER_ICON)
        .setDisplaySize(ICON_SIZE, ICON_SIZE).setScrollFactor(0).setDepth(51).setVisible(false);
    }
    this.refreshHUD();

    this.buildMinimap();
    if (this.planet.dust) this.buildDust();
    // darkened screen edges: frames the view, and on the Moon reads as the
    // black sky pressing in at the horizon
    const vignette = this.add.image(width / 2, height / 2, ensureVignetteTexture(this))
      .setDisplaySize(width, height).setScrollFactor(0).setDepth(39)
      .setTint(this.planet.surface.vignette).setAlpha(this.planet.surface.vignetteAlpha);

    const menuBtn = makeIconButton(this, width - MINIMAP_SIZE - 44, 36, 'ico_gear', () => this.inGameMenu.toggle(), 44);
    menuBtn.setScrollFactor(0).setDepth(65);

    // --- on-screen touch controls (bottom-left thumbstick + bottom-right action) ---
    // Only a touch device gets them; a desktop keeps the keyboard and the
    // bottom corners of the screen free.
    this.touch = new TouchControls(this);
    this.touch.setEnabled(isTouchMode());
    const unsubscribeMode = onInputModeChange(() => this.touch.setEnabled(isTouchMode()));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribeMode);

    // The world camera is zoomed 1.4, which scales and shifts any
    // scroll-factor-0 text off screen. The overlay gets its own camera.
    this.hudCam = this.cameras.add(0, 0, width, height);
    this.hudCam.setName('hud');
    this.hudCam.transparent = true;
    this.hudObjects = [this.taskText, this.invText, this.promptText, this.roverText, vignette, menuBtn, ...this.touch.objects];
    if (this.roverIcon) this.hudObjects.push(this.roverIcon);
    if (this.minimapContainer) this.hudObjects.push(this.minimapContainer);
    if (this.dustGfx) this.hudObjects.push(this.dustGfx);
    if (this.dustBox) this.hudObjects.push(this.dustBox);
    const hudSet = new Set<Phaser.GameObjects.GameObject>(this.hudObjects);
    this.hudCam.ignore(this.children.list.filter((o) => !hudSet.has(o)));
    this.cameras.main.ignore(this.hudObjects);

    this.inGameMenu = new InGameMenu(this, {
      onOpen: () => {
        this.player.setVelocity(0, 0);
        this.rover.halt();
        this.rover.pauseMotor(true);
        this.pauseStart = this.time.now;
        if (this.drill) this.drill.timer.paused = true;
        this.drillLoop?.pause();
      },
      onClose: () => {
        if (this.pauseStart) {
          this.startT += this.time.now - this.pauseStart;
          this.pauseStart = 0;
        }
        this.rover.pauseMotor(false);
        if (this.drill) this.drill.timer.paused = false;
        this.drillLoop?.resume();
      },
      onHub: () => this.scene.start('hub'),
      onQuit: () => this.scene.start('menu'),
    });

    // the sound manager is global, so a loop outlives the scene unless it is
    // explicitly stopped — leaving the drill running in the menu is the sort of
    // bug nobody reports, they just hear it
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      stopMinionSound(this.drillLoop);
      this.rover.stopMotor();
    });

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyWASD = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    // E, F and H are events, not polled: a tap shorter than one frame still
    // counts (a polled key loses it when its up and down land in one frame)
    this.actionQueued = false;
    this.toggleQueued = false;
    this.input.keyboard!.on('keydown-E', (e: KeyboardEvent) => { if (!e.repeat) this.actionQueued = true; });
    this.input.keyboard!.on('keydown-F', () => { this.toggleQueued = true; });
    this.input.keyboard!.on('keydown-H', () => {
      if (this.driving && !this.inGameMenu?.isOpen) this.rover.honk();
    });

    // the first line of the walk says where you are and what the job is, the
    // second points out the ride
    this.time.delayedCall(600, () => {
      const radio = this.helpers.find((h) => h.kind === 'minions_radio_scout') ?? this.helpers[0];
      if (radio && !this.ended) this.bubble(radio, t(`explore.arrive.${this.planet.id}`));
    });
    this.time.delayedCall(4800, () => {
      const mech = this.helpers.find((h) => h.kind === 'minions_mechanic') ?? this.helpers[0];
      if (mech && !this.ended && !this.driving) this.bubble(mech, t('explore.rover_ready', { act: this.actionLabel() }));
    });
  }

  // ------------------------------------------------------------- terrain ---

  /** A tile image: the dedicated planet art when it is loaded, otherwise the
   *  atlas frame under the planet's tint. */
  private tile(x: number, y: number, art: TileArt): Phaser.GameObjects.Image {
    if (art.art && this.textures.exists(art.art)) {
      return this.add.image(x, y, art.art).setDisplaySize(TILE + 1, TILE + 1).setDepth(-10);
    }
    const img = this.add.image(x, y, 'terrain_v2', art.frame).setDepth(-10);
    if (art.tint !== undefined) img.setTint(art.tint);
    return img;
  }

  private buildTerrain(rng: Phaser.Math.RandomDataGenerator): void {
    const p = this.planet;
    // solid ground under the tiles: any seam, gap or map edge then reads as
    // soil instead of the camera's background colour
    this.add.rectangle(MAP_W * TILE / 2, MAP_H * TILE / 2, MAP_W * TILE, MAP_H * TILE, p.soil).setDepth(-20);
    // Painted ground is drawn on its own: any second 64 px tile mixed in (even
    // the painted bedrock) shows as a hard square, and the decor frames are
    // opaque squares too.
    const painted = (t: TileArt) => !!t.art && this.textures.exists(t.art);
    const overhaulGround = this.buildOverhaulGround(rng);
    const groundPainted = overhaulGround || painted(p.ground);
    const patchChance = groundPainted ? 0 : p.patchChance;
    for (let ty = 0; ty < MAP_H && !overhaulGround; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const art = rng.frac() < patchChance ? p.patch : p.ground;
        this.tile(tx * TILE + TILE / 2, ty * TILE + TILE / 2, art);
      }
    }
    this.buildSurfaceDetail(rng, overhaulGround);
    // scatter rocks (obstacles) & decor
    this.rockGroup = this.physics.add.staticGroup();
    for (let i = 0; i < 45; i++) {
      const x = rng.between(100, MAP_W * TILE - 100);
      const y = rng.between(100, MAP_H * TILE - 100);
      // keep the spawn area & lander clear
      if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 240) continue;
      if (groundPainted) {
        this.addBoulder(x, y, rng);
        continue;
      }
      const rock = this.rockGroup.create(x, y, 'terrain', rng.pick(p.rocks)) as Phaser.Physics.Arcade.Sprite;
      rock.setScale(0.8).refreshBody().setDepth(depthAt(y + rock.displayHeight * 0.4));
      if (p.rockTint !== undefined) rock.setTint(p.rockTint);
    }
    for (let i = 0; i < (groundPainted ? 0 : 80); i++) {
      const x = rng.between(0, MAP_W * TILE);
      const y = rng.between(0, MAP_H * TILE);
      const d = this.add.image(x, y, 'terrain', rng.pick(p.decor)).setScale(0.6).setAlpha(0.8).setDepth(-1);
      if (p.decorTint !== undefined) d.setTint(p.decorTint);
    }
  }

  /**
   * The overhaul ground (`ground_<planet>`), when delivered: the tile baked
   * 4×4 into one power-of-two texture and laid in a grid of plain images.
   * A TileSprite would allocate a canvas the size of the whole map; a
   * wrapping texture repeats exactly, so neighbouring images meet with no seam.
   * Mars also gets a few soft patches of its bedrock tile. Returns false when
   * there is no overhaul ground for this planet.
   */
  private buildOverhaulGround(rng: Phaser.Math.RandomDataGenerator): boolean {
    const id = this.planet.id;
    const fill = this.repeatTexture(`ground_${id}`, GROUND_REPS, false);
    if (!fill) return false;
    const W = MAP_W * TILE;
    const H = MAP_H * TILE;
    const step = this.textures.get(fill).getSourceImage().width * GROUND_SCALE;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        this.add.image(x, y, fill).setOrigin(0, 0).setScale(GROUND_SCALE).setDepth(-10);
      }
    }
    const patch = this.repeatTexture(`ground_${id}_rock`, GROUND_REPS, true);
    if (patch) {
      for (let i = 0; i < 9; i++) {
        const x = rng.between(0, W);
        const y = rng.between(0, H);
        this.add.image(x, y, patch).setDepth(-9.5).setFlipX(rng.frac() < 0.5)
          .setScale(GROUND_SCALE * rng.realInRange(0.6, 1.1));
      }
    }
    return true;
  }

  /**
   * Bake `reps × reps` copies of an overhaul ground tile into one canvas
   * texture (cached across visits). `soft` cuts it to an irregular blob that
   * fades out at the edge, for patches laid over another ground.
   */
  private repeatTexture(frame: string, reps: number, soft: boolean): string | null {
    if (!hasOverhaul(this, frame)) return null;
    const key = `ov_fill_${frame}${soft ? '_soft' : ''}`;
    if (this.textures.exists(key)) return key;
    const f = this.textures.getFrame(OVERHAUL, frame);
    const src = f.source.image as CanvasImageSource;
    const tw = f.cutWidth;
    const th = f.cutHeight;
    const tex = this.textures.createCanvas(key, tw * reps, th * reps);
    if (!tex) return null;
    const ctx = tex.context;
    for (let j = 0; j < reps; j++) {
      for (let i = 0; i < reps; i++) ctx.drawImage(src, f.cutX, f.cutY, tw, th, i * tw, j * th, tw, th);
    }
    if (soft) {
      // a union of soft round blobs, not one ellipse, so the patch has an
      // uneven outline like a real outcrop
      const S = tw * reps;
      const mask = document.createElement('canvas');
      mask.width = S;
      mask.height = S;
      const m = mask.getContext('2d');
      const rng = new Phaser.Math.RandomDataGenerator([frame]);
      for (let k = 0; k < 7 && m; k++) {
        const cx = S * rng.realInRange(0.3, 0.7);
        const cy = S * rng.realInRange(0.3, 0.7);
        const r = S * rng.realInRange(0.16, 0.28);
        const g = m.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = g;
        m.fillRect(0, 0, S, S);
      }
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    tex.refresh();
    return key;
  }

  /** A boulder with a solid foot: the overhaul rock art when delivered, a drawn
   *  cartoon one otherwise. The terrain atlas rocks are opaque squares, which
   *  read as holes on the painted ground. */
  private addBoulder(x: number, y: number, rng: Phaser.Math.RandomDataGenerator): void {
    const frame = `rock_${this.planet.id}_${rng.between(1, 4)}`;
    if (hasOverhaul(this, frame)) {
      const img = this.add.image(0, 0, OVERHAUL, frame).setOrigin(0.5, 1);
      img.setScale(rng.between(42, 70) / img.frame.width);
      const w = img.displayWidth;
      const h = img.displayHeight;
      // the art's base sits on the bottom edge of its canvas: that is the foot
      const footY = y + h * 0.35;
      img.setPosition(x, footY).setDepth(depthAt(footY));
      this.add.ellipse(x + 5, footY - h * 0.08, w * 0.82, h * 0.26, 0x000000, 0.22).setDepth(-7);
      const foot = this.add.zone(x, footY - h * 0.22, w * 0.7, h * 0.4);
      this.physics.add.existing(foot, true);
      this.rockGroup.add(foot);
      return;
    }
    const mars = this.planet.id === 'mars';
    const body = mars ? 0x8a4128 : 0x7d7f86;
    const light = mars ? 0xb8613f : 0xa9abb2;
    const dark = mars ? 0x5e2a1a : 0x55575e;
    const w = rng.between(38, 64);
    const h = Math.round(w * rng.realInRange(0.6, 0.8));
    const g = this.add.graphics().setPosition(x, y).setDepth(depthAt(y + h * 0.4));
    g.fillStyle(0x000000, 0.22).fillEllipse(6, h * 0.42, w * 1.15, h * 0.46);
    g.fillStyle(body, 1).fillEllipse(0, 0, w, h);
    g.fillStyle(dark, 0.55).fillEllipse(w * 0.08, h * 0.2, w * 0.86, h * 0.5);
    g.fillStyle(body, 1).fillEllipse(-w * 0.04, -h * 0.06, w * 0.84, h * 0.7);
    g.fillStyle(light, 1).fillEllipse(-w * 0.14, -h * 0.18, w * 0.5, h * 0.36);
    g.fillStyle(0xffffff, 0.35).fillEllipse(-w * 0.2, -h * 0.25, w * 0.16, h * 0.1);
    g.fillStyle(dark, 1).fillEllipse(w * 0.2, h * 0.16, w * 0.22, h * 0.18);
    g.lineStyle(3, 0x1d1b2e, 1).strokeEllipse(0, 0, w, h);
    const foot = this.add.zone(x, y + h * 0.1, w * 0.8, h * 0.6);
    this.physics.add.existing(foot, true);
    this.rockGroup.add(foot);
  }

  /**
   * Ground detail over the painted tiles. One 64 px tile repeated 1200 times
   * reads as wallpaper; big soft light and dark patches break the repeat, and
   * each planet gets its own landforms: craters with lit rims on the Moon,
   * wind ripples and a few old craters on Mars. One static Graphics, drawn once.
   */
  private buildSurfaceDetail(rng: Phaser.Math.RandomDataGenerator, paintedRipples = false): void {
    const s = this.planet.surface;
    const W = MAP_W * TILE;
    const H = MAP_H * TILE;
    const g = this.add.graphics().setDepth(-9);
    const clearOfBase = (x: number, y: number, r: number) =>
      Math.hypot(x - SPAWN.x, y - SPAWN.y) > 260 + r && Math.hypot(x - ROVER_PARK.x, y - ROVER_PARK.y) > 120 + r;

    this.buildBlotches(rng, W, H);

    // the overhaul ground has its wind ripples painted in; drawn ones on top
    // read as scratches
    for (let i = 0; i < (paintedRipples ? 0 : s.ripples); i++) {
      const x = rng.between(60, W - 60);
      const y = rng.between(60, H - 60);
      if (!clearOfBase(x, y, 40)) continue;
      const len = rng.between(60, 150);
      g.lineStyle(3, s.rippleColor, rng.realInRange(0.12, 0.22));
      for (let k = 0; k < 3; k++) {
        const yy = y + k * 11;
        g.beginPath();
        g.moveTo(x - len / 2, yy);
        for (let t = 1; t <= 12; t++) {
          const px = x - len / 2 + (len * t) / 12;
          g.lineTo(px, yy - Math.sin((t / 12) * Math.PI) * 6);
        }
        g.strokePath();
      }
    }

    const craterArt = (big: boolean) => {
      const frame = `crater_${this.planet.id}_${big ? 'l' : 's'}`;
      return hasOverhaul(this, frame) ? frame : null;
    };
    for (let i = 0; i < s.craters; i++) {
      const r = rng.between(26, 96);
      const x = rng.between(r + 40, W - r - 40);
      const y = rng.between(r + 40, H - r - 40);
      if (!clearOfBase(x, y, r)) continue;
      const art = craterArt(r > 52);
      if (art) {
        // the canvas carries the rim and its soft fade, a little wider than
        // the drawn rim (r × 2.3) it replaces
        const img = this.add.image(x, y, OVERHAUL, art).setDepth(-9);
        img.setScale((r * 2.6) / img.frame.width);
        continue;
      }
      const ry = r * 0.62;   // seen at a slant, the bowl is an ellipse
      // ejecta: a ring of pale specks thrown out of the impact
      g.fillStyle(s.craterRim, 0.16);
      for (let k = 0; k < 10; k++) {
        const a = rng.realInRange(0, Math.PI * 2);
        const d = r * rng.realInRange(1.15, 1.6);
        g.fillEllipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.62, rng.between(6, 14), rng.between(4, 9));
      }
      g.fillStyle(s.craterRim, 0.22).fillEllipse(x, y, r * 2.3, ry * 2.3);   // raised rim
      g.fillStyle(s.craterBowl, 0.34).fillEllipse(x, y, r * 2, ry * 2);      // the bowl
      // light from the top-left: the near (upper) wall is in shadow, the far
      // wall catches the sun
      g.fillStyle(s.craterBowl, 0.3).fillEllipse(x - r * 0.12, y - ry * 0.2, r * 1.6, ry * 1.4);
      g.fillStyle(s.craterRim, 0.18).fillEllipse(x + r * 0.3, y + ry * 0.42, r * 1.0, ry * 0.6);
      g.lineStyle(2, s.craterBowl, 0.35).strokeEllipse(x, y, r * 2, ry * 2);
    }
  }

  /**
   * Big soft light and dark patches that break up the ground's repeat,
   * painted once into a quarter-resolution canvas and shown as one image. As
   * Graphics ellipses they were 14,000 drawing commands that Phaser
   * re-triangulated every frame.
   */
  private buildBlotches(rng: Phaser.Math.RandomDataGenerator, W: number, H: number): void {
    const s = this.planet.surface;
    const K = 4;
    const key = 'explore_blotches';
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, Math.ceil(W / K), Math.ceil(H / K));
    if (!tex) return;
    const ctx = tex.context;
    const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
    for (let i = 0; i < 34; i++) {
      const x = rng.between(0, W) / K;
      const y = rng.between(0, H) / K;
      const r = rng.between(240, 620) / 2 / K;
      const squash = rng.realInRange(0.5, 0.8);
      const dark = rng.frac() < 0.55;
      const alpha = dark ? rng.realInRange(0.06, 0.12) : rng.realInRange(0.04, 0.08);
      const color = dark ? s.blotchDark : s.blotchLight;
      // a soft radial edge, so a patch reads as a change in the soil rather
      // than a cut-out disc
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, squash);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, rgba(color, alpha * 1.4));
      grad.addColorStop(0.6, rgba(color, alpha));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    tex.refresh();
    this.add.image(0, 0, key).setOrigin(0, 0).setScale(K).setDepth(-9);
  }

  private buildLander(): void {
    const p = this.planet;
    if (p.landerArt && this.textures.exists(p.landerArt)) {
      this.lander = this.add.image(SPAWN.x, SPAWN.y, p.landerArt);
      const s = 200 / Math.max(this.lander.width, this.lander.height);
      this.lander.setScale(s);
    } else {
      this.lander = this.add.image(SPAWN.x, SPAWN.y, 'machines', 'machines_rocket_launchpad')
        .setScale(0.8 * nativeRatio(this, 'machines', 'machines_rocket_launchpad'));
    }
    const footY = this.lander.y + this.lander.displayHeight * 0.4;
    this.lander.setDepth(depthAt(footY));
    // a soft shadow under the legs, and a solid footprint so neither the
    // astronaut nor the rover passes through the lander
    this.add.ellipse(this.lander.x + 6, footY - 6, this.lander.displayWidth * 0.8, 34, 0x000000, 0.24).setDepth(-7);
    const base = this.add.zone(this.lander.x, footY - 34, 80, 24);
    this.physics.add.existing(base, true);
    this.rockGroup.add(base);
    // Tap the lander directly on smartphones to transmit once the tasks are done
    this.lander.setInteractive();
    if (this.lander.input) this.lander.input.cursor = 'pointer';
    this.lander.on('pointerup', () => {
      if (this.inGameMenu?.isOpen || this.drilling || this.ended) return;
      const near = Math.hypot(this.player.x - this.lander.x, this.player.y - this.lander.y) < this.reach.lander + 14;
      if (near && requiredTasksDone(this.planet, this.inventory)) this.transmit();
    });
  }

  // ------------------------------------------------------------- samples ---

  private buildSamples(rng: Phaser.Math.RandomDataGenerator): void {
    const placed: { x: number; y: number }[] = [];
    for (const [id, count] of Object.entries(this.planet.spawns)) {
      const def = sampleDef(this.planet, id);
      if (!def) continue;
      for (let i = 0; i < count; i++) {
        let x = 0, y = 0, tries = 0;
        do {
          x = rng.between(160, MAP_W * TILE - 160);
          y = rng.between(160, MAP_H * TILE - 160);
          tries++;
        } while (tries < 40 && (
          Math.hypot(x - SPAWN.x, y - SPAWN.y) < 380
          || placed.some((q) => Math.hypot(q.x - x, q.y - y) < 180)
        ));
        placed.push({ x, y });
        // ring is drawn at its own origin and positioned — so scaling it pulses
        // around the sample instead of drifting (see PLAN §2.9)
        const ring = this.add.graphics().setPosition(x, y).setDepth(-6);
        const shadow = this.add.ellipse(x + 3, y + SAMPLE_SIZE * 0.32, SAMPLE_SIZE * 0.8, 14, 0x000000, 0.24).setDepth(-7);
        const go = addSampleIcon(this, x, y, def, SAMPLE_SIZE).setDepth(depthAt(y + SAMPLE_SIZE * 0.3));
        const sample: Sample = { def, go, ring, x, y, collected: false, shadow };
        // Tap a sample directly on touch screens when within reach
        go.setInteractive();
        if (go.input) go.input.cursor = 'pointer';
        go.on('pointerup', () => {
          if (this.inGameMenu?.isOpen || this.drilling || this.ended || sample.collected) return;
          if (Math.hypot(sample.x - this.player.x, sample.y - this.player.y) < this.reach.sample + 20) this.startDrill(sample);
        });
        this.samples.push(sample);
      }
    }
    this.refreshRings();
  }

  /** Gold rings mark what the tasks still need; the rest stay cyan. */
  private refreshRings(): void {
    for (const s of this.samples) {
      if (s.collected) continue;
      const wanted = sampleAdvancesTask(this.planet, this.inventory, s.def.id);
      if (s.wanted === wanted) continue;
      s.wanted = wanted;
      s.ring.clear();
      s.ring.lineStyle(3, wanted ? RING_WANTED : RING_SPARE, 1);
      s.ring.strokeCircle(0, 0, 30);
      s.ring.strokeCircle(0, 0, 22);
    }
  }

  private buildHelpers(): void {
    const helperFrames = ['minions_mechanic', 'minions_miner_driller', 'minions_radio_scout', 'minions_chemist'];
    for (let i = 0; i < 4; i++) {
      const go = this.add.image(SPAWN.x + 140 + i * 30, SPAWN.y + 80 + i * 25, 'minions', helperFrames[i]);
      // same rendered height as the hub crew, so the helpers do not change
      // size between the base and the planet
      attachMinionFit(go, MINION_HEIGHT);
      // a 2×2 escort behind the astronaut
      this.helpers.push({
        go,
        offset: { x: -70 - (i % 2) * 84, y: 36 + Math.floor(i / 2) * 58 },
        kind: helperFrames[i],
      });
    }
  }

  // ----------------------------------------------------------------- hud ---

  private buildMinimap(): void {
    const mx = this.scale.width - MINIMAP_SIZE / 2 - 14;
    const my = MINIMAP_SIZE / 2 + 14;
    const c = this.add.container(mx, my).setScrollFactor(0).setDepth(55);

    const disc = this.add.graphics();
    disc.fillStyle(0x0d1b2a, 0.86);
    disc.fillCircle(0, 0, MINIMAP_RAD + 4);
    disc.lineStyle(1, 0x3b6e8c, 0.45);
    disc.strokeCircle(0, 0, MINIMAP_RAD * 0.55);
    disc.lineBetween(-MINIMAP_RAD, 0, MINIMAP_RAD, 0);
    disc.lineBetween(0, -MINIMAP_RAD, 0, MINIMAP_RAD);
    c.add(disc);

    this.minimapDots = this.add.graphics();
    c.add(this.minimapDots);

    if (hasV2(this, UI_V2_ART.minimapFrame)) {
      const bezel = this.add.image(0, 0, V2, UI_V2_ART.minimapFrame)
        .setDisplaySize(MINIMAP_SIZE, MINIMAP_SIZE);
      c.add(bezel);
    } else {
      const rim = this.add.graphics();
      rim.lineStyle(4, 0x3a6bb5, 1);
      rim.strokeCircle(0, 0, MINIMAP_RAD + 4);
      c.add(rim);
    }

    // planet name + gravity under the radar
    c.add(this.add.text(0, MINIMAP_SIZE / 2 + 4, `${t(this.planet.nameKey)} · ${t('explore.gravity', { g: this.planet.gravity })}`, {
      ...TXT.small, fontSize: '12px', color: '#ffe8a3',
      backgroundColor: '#1d1d3acc', padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 0));

    this.minimapContainer = c;
  }

  private updateMinimap(): void {
    const g = this.minimapDots;
    if (!g) return;
    g.clear();
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    const toRadar = (wx: number, wy: number) => ({
      rx: ((wx / worldW) - 0.5) * (MINIMAP_RAD * 1.72),
      ry: ((wy / worldH) - 0.5) * (MINIMAP_RAD * 1.72),
    });

    // lander (green square)
    const l = toRadar(this.lander.x, this.lander.y);
    g.fillStyle(0x7ac74f, 1);
    g.fillRect(l.rx - 4, l.ry - 4, 8, 8);

    // the parked rover (orange); while driving, the player dot is the rover
    if (!this.driving) {
      const r = toRadar(this.rover.x, this.rover.y);
      g.fillStyle(0xff9a3d, 1);
      g.fillRoundedRect(r.rx - 5, r.ry - 3.5, 10, 7, 2);
    }

    // uncollected samples: gold if a task needs it, cyan otherwise
    for (const s of this.samples) {
      if (s.collected) continue;
      const p = toRadar(s.x, s.y);
      g.fillStyle(s.wanted ? RING_WANTED : RING_SPARE, 1);
      g.fillCircle(p.rx, p.ry, 3.5);
    }

    // player (white dot)
    const pl = toRadar(this.player.x, this.player.y);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(pl.rx, pl.ry, 4.5);
  }

  /** Screen-space dust drifting across the view (Mars). */
  private buildDust(): void {
    const { width, height } = this.scale;
    const rng = new Phaser.Math.RandomDataGenerator(['dust']);
    for (let i = 0; i < 70; i++) {
      this.dust.push({
        x: rng.between(0, width), y: rng.between(0, height),
        vx: -rng.realInRange(20, 60), vy: rng.realInRange(-6, 6),
        r: rng.realInRange(1, 2.6), a: rng.realInRange(0.15, 0.45),
      });
    }
    // The haze is drawn once; the specks are images moved each frame. Redrawn
    // as Graphics circles, the storm was ~900 commands re-triangulated every
    // frame.
    this.dustGfx = this.add.graphics().setScrollFactor(0).setDepth(40);
    this.dustGfx.fillStyle(0xd2875a, 0.07).fillRect(0, 0, width, height);
    const key = 'explore_speck';
    if (!this.textures.exists(key)) {
      const dot = this.make.graphics({ x: 0, y: 0 }, false);
      dot.fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
      dot.generateTexture(key, 16, 16);
      dot.destroy();
    }
    this.dustBox = this.add.container(0, 0).setScrollFactor(0).setDepth(40);
    for (const s of this.dust) {
      s.img = this.add.image(s.x, s.y, key).setTint(0xf0b088).setAlpha(s.a).setScale(s.r / 8);
      this.dustBox.add(s.img);
    }
  }

  private updateDust(delta: number): void {
    const g = this.dustGfx;
    if (!g) return;
    const { width, height } = this.scale;
    const dt = delta / 1000;
    for (const s of this.dust) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -4) { s.x = width + 4; s.y = Phaser.Math.Between(0, height); }
      if (s.y < -4) s.y = height + 4; else if (s.y > height + 4) s.y = -4;
      s.img?.setPosition(s.x, s.y);
    }
  }

  private taskLine(task: TaskDef): string {
    const done = taskDone(task, this.inventory);
    const sample = task.sample ? t(`sample.${task.sample}`) : '';
    const label = t(task.labelKey, { n: task.count, sample });
    const mark = done ? '✔' : '◻';
    const bonus = task.required ? '' : ` (${t('explore.bonus')})`;
    return `${mark} ${label}${bonus}  ${taskProgress(task, this.inventory)}/${task.count}`;
  }

  private refreshHUD(): void {
    const lines = [t('explore.tasks_title', { planet: t(this.planet.nameKey) })];
    for (const task of this.planet.tasks) lines.push(this.taskLine(task));
    lines.push(requiredTasksDone(this.planet, this.inventory) ? `➜ ${t('explore.return')}` : '');
    this.taskText.setText(lines.filter(Boolean).join('\n'));
    this.invText.setY(this.taskText.y + this.taskText.height + 8);
    const counts = new Map<string, number>();
    for (const id of this.inventory) counts.set(id, (counts.get(id) ?? 0) + 1);
    const list = [...counts].map(([id, n]) => `${t(`sample.${id}`)}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    this.invText.setText(`${t('explore.inventory')}: ${list || '—'}`);
  }

  // -------------------------------------------------------------- update ---

  /** The stick: arrows / WASD, or the thumbstick when no key is held. -1..1. */
  private stick(): { x: number; y: number } {
    let x = (this.cursors.left.isDown || this.keyWASD.A.isDown ? -1 : 0) + (this.cursors.right.isDown || this.keyWASD.D.isDown ? 1 : 0);
    let y = (this.cursors.up.isDown || this.keyWASD.W.isDown ? -1 : 0) + (this.cursors.down.isDown || this.keyWASD.S.isDown ? 1 : 0);
    if (x === 0 && y === 0 && (this.touch.dx !== 0 || this.touch.dy !== 0)) {
      x = this.touch.dx;
      y = this.touch.dy;
    }
    return { x, y };
  }

  override update(_t: number, delta: number): void {
    this.updateDust(delta);
    const dt = Math.min(delta / 1000, 0.1);
    this.rover.update(this.inGameMenu?.isOpen ? 0 : dt);
    this.footprints.update(dt);
    if (this.ended) {
      this.rover.halt();
      return;
    }
    if (this.inGameMenu?.isOpen) {
      this.player.setVelocity(0, 0);
      this.rover.halt();
      // keys pressed in the menu must not act once it closes
      this.actionQueued = false;
      this.toggleQueued = false;
      return;
    }
    const input = this.stick();
    const g = state.astronaut;

    if (this.driving) {
      if (this.drilling) this.rover.halt();
      else this.rover.drive(input.x, input.y, dt);
      // the astronaut rides along: the rest of the scene keeps reading the
      // player's position, so it simply sits on the rover
      this.player.setPosition(this.rover.x, this.rover.y);
      this.idleT = this.rover.speed > 5 ? 0 : this.idleT + delta;
      const speedLine = t('explore.rover_speed', { v: this.rover.kmh });
      this.roverText.setText(`${this.roverIcon ? '' : '🚙 '}${speedLine}\n${t(isTouchMode() ? 'explore.rover_keys_touch' : 'explore.rover_keys')}`);
      // the box is centred and its width follows the text, so the badge
      // follows the box's left edge
      this.roverIcon?.setPosition(
        this.roverText.x - this.roverText.width / 2 + ICON_GUTTER / 2,
        this.roverText.y + this.roverText.height / 2,
      );
    } else {
      const speed = this.planet.walkSpeed;
      let vx = input.x * speed;
      let vy = input.y * speed;
      if (this.drilling) { vx = 0; vy = 0; }
      this.player.setVelocity(vx, vy);

      const moving = vx !== 0 || vy !== 0;
      if (moving) {
        this.idleT = 0;
        const dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'side_right' : 'side_left') : (vy > 0 ? 'front' : 'back');
        this.player.play(`astro_${g}_walk_${dir}`, true);
        this.stepPrints();
      } else {
        this.idleT += delta;
        const cur = this.player.anims.currentAnim?.key ?? `astro_${g}_walk_front`;
        const dir = cur.replace(`astro_${g}_walk_`, '').replace(`astro_${g}_idle_`, '');
        this.player.play(`astro_${g}_idle_${dir}`, true);
      }
    }
    const footY = this.player.y + 30;
    this.player.setDepth(depthAt(footY));
    this.playerShadow.setPosition(this.player.x + 3, footY - 2).setDepth(depthAt(footY) - 0.0005);

    // helpers follow with lag. While the astronaut drives they stay where
    // they were and watch the rover; afterwards they jog back, never faster
    // than CREW_JOG, so they run over instead of sliding across the map
    for (const h of this.helpers) {
      if (!this.driving) {
        const dx = this.player.x + h.offset.x - h.go.x;
        const dy = this.player.y + h.offset.y - h.go.y;
        const d = Math.hypot(dx, dy);
        const step = Math.min(d * 0.05, CREW_JOG * dt);
        if (d > 0.01) {
          h.go.x += (dx / d) * step;
          h.go.y += (dy / d) * step;
        }
      }
      h.go.setFlipX(this.player.x < h.go.x);
      h.go.setDepth(depthAt(h.go.y + h.go.displayHeight * 0.45));
      // the speech bubble rides along, or it would be left behind by the rover
      if (h.bubble?.active) h.bubble.setPosition(h.go.x, h.go.y - 68);
    }

    this.updateScout();

    // pulsing rings
    const phase = Math.sin(this.time.now / 200);
    for (const s of this.samples) {
      if (s.collected) continue;
      s.ring.setScale(1 + phase * 0.12);
      s.ring.setAlpha(0.55 + 0.45 * (phase * 0.5 + 0.5));
    }

    // hint bubbles
    this.hintTimer += delta;
    if (this.hintTimer > 20000 || this.idleT > 10000) {
      this.hintTimer = 0; this.idleT = 0;
      this.showHint();
    }

    this.updateMinimap();
    this.updateInteract();
    // an empty prompt would still draw its background box
    this.promptText.setVisible(this.promptText.text !== '');
  }

  /** Leave a boot print every stride, alternating feet either side of the
   *  line of travel. */
  private stepPrints(): void {
    const dx = this.player.x - this.lastStep.x;
    const dy = this.player.y - this.lastStep.y;
    const d = Math.hypot(dx, dy);
    if (d < STRIDE) return;
    const a = Math.atan2(dy, dx);
    this.footSide = -this.footSide;
    const off = 9 * this.footSide;
    this.footprints.stamp(
      this.player.x - Math.sin(a) * off,
      this.player.y + 26 + Math.cos(a) * off * 0.6,
      a,
      this.bootScale,
    );
    this.lastStep = { x: this.player.x, y: this.player.y };
  }

  /** Climb into the parked rover: the walking astronaut is swapped for the
   *  rover's seated driver, the crew stays behind, and the camera pulls back
   *  for the faster view. */
  private boardRover(): void {
    if (this.driving || this.drilling || this.ended) return;
    this.driving = true;
    this.player.setVelocity(0, 0);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    this.player.setVisible(false);
    this.playerShadow.setVisible(false);
    this.rover.setOccupied(true);
    this.roverText.setVisible(true);
    this.roverIcon?.setVisible(true);
    this.cameras.main.zoomTo(ZOOM_DRIVE, 600, 'Sine.easeInOut');
    if (!this.tipShown) {
      this.tipShown = true;
      const mech = this.helpers.find((h) => h.kind === 'minions_mechanic') ?? this.helpers[0];
      if (mech) this.bubble(mech, t(`explore.rover_fact.${this.planet.id}`));
    }
  }

  /** Step out beside the rover, on whichever side has room. */
  private leaveRover(): void {
    if (!this.driving || this.drilling) return;
    this.rover.halt();
    this.rover.setOccupied(false);
    this.driving = false;
    const a = this.rover.heading + Math.PI / 2;
    const spots = [a, a + Math.PI, this.rover.heading + Math.PI, this.rover.heading].map((ang) => ({
      x: this.rover.x + Math.cos(ang) * 92,
      y: this.rover.y + Math.sin(ang) * 70,
    }));
    const W = MAP_W * TILE;
    const H = MAP_H * TILE;
    const free = spots.find((p) => p.x > 40 && p.x < W - 40 && p.y > 40 && p.y < H - 40
      && this.physics.overlapRect(p.x - 25, p.y - 30, 50, 60, true, true)
        .every((b) => b === this.rover.body || b === this.player.body)) ?? spots[0];
    this.player.setPosition(free.x, free.y);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.reset(free.x, free.y);
    body.enable = true;
    this.player.setVisible(true);
    this.playerShadow.setVisible(true);
    this.lastStep = { x: free.x, y: free.y };
    this.roverText.setVisible(false);
    this.roverIcon?.setVisible(false);
    this.cameras.main.zoomTo(ZOOM_WALK, 600, 'Sine.easeInOut');
  }

  private tipShown = false;

  /** The radio scout points at the nearest sample a task still needs — or,
   *  once the tasks are done, back at the lander. */
  private updateScout(): void {
    const scout = this.helpers.find((h) => h.kind === 'minions_radio_scout');
    const tasksDone = requiredTasksDone(this.planet, this.inventory) && bonusTasksDone(this.planet, this.inventory);
    const target = tasksDone
      ? { x: this.lander.x, y: this.lander.y }
      : this.nearestSample(this.player.x, this.player.y, true) ?? this.nearestSample(this.player.x, this.player.y, false);
    if (!scout || !target) {
      this.scoutArrow?.setVisible(false);
      return;
    }
    const a = Math.atan2(target.y - scout.go.y, target.x - scout.go.x);
    // the sprite stays upright (it is a front-facing character); it leans a
    // little and turns to face the target, while an arrow shows the bearing
    scout.go.setFlipX(target.x < scout.go.x);
    scout.go.setRotation(Math.sin(a) * 0.12);
    if (!this.scoutArrow) {
      if (hasV2(this, UI_V2_ART.arrow)) {
        const img = this.add.image(0, 0, V2, UI_V2_ART.arrow).setDisplaySize(32, 32).setDepth(58);
        this.hudCam.ignore(img);
        this.scoutArrow = img;
      } else {
        const gfx = this.add.graphics().setDepth(58);
        gfx.fillStyle(0x59f7ff, 1).lineStyle(2, 0x1d1b2e);
        gfx.fillTriangle(0, -13, -9, 7, 9, 7);
        gfx.strokeTriangle(0, -13, -9, 7, 9, 7);
        this.hudCam.ignore(gfx);     // world-anchored
        this.scoutArrow = gfx;
      }
    }
    this.scoutArrow.setVisible(true);
    this.scoutArrow.setPosition(scout.go.x, scout.go.y - 56);
    this.scoutArrow.setRotation(this.scoutArrow instanceof Phaser.GameObjects.Image ? a : a + Math.PI / 2);
  }

  /** Nearest uncollected sample; `wantedOnly` limits it to ones a task needs. */
  private nearestSample(x: number, y: number, wantedOnly = false): Sample | null {
    let best: Sample | null = null;
    let bd = Infinity;
    for (const s of this.samples) {
      if (s.collected) continue;
      if (wantedOnly && !s.wanted) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private showHint(): void {
    // the crew waits behind while the astronaut drives, too far to talk
    if (this.driving) return;
    const h = this.helpers[Math.floor(Math.random() * this.helpers.length)];
    const hints = this.planet.hintKeys;
    const key = hints[Math.floor(Math.random() * hints.length)];
    this.bubble(h, t(key, { act: this.actionLabel() }));
  }

  private bubble(h: Helper, text: string): void {
    // one speaker at a time: the helpers stand close together, so two bubbles
    // would stack on top of each other
    for (const o of this.helpers) {
      o.bubble?.destroy();
      o.bubble = undefined;
    }
    const { container: c } = makeSpeechBubble(this, 240, 88, text, {
      fontSize: 12,
      portrait: h.kind,
    });
    c.setPosition(h.go.x, h.go.y - 68).setDepth(60);
    h.bubble = c;
    this.hudCam.ignore(c);          // world-anchored → main camera only
    this.tweens.add({ targets: c, alpha: 0, delay: 3500, duration: 400, onComplete: () => c.destroy() });
  }

  private updateInteract(): void {
    const px = this.player.x, py = this.player.y;
    const reach = this.reach;
    const s = this.nearestSample(px, py);
    const nearSample = s && Math.hypot(s.x - px, s.y - py) < reach.sample;
    const nearLander = Math.hypot(px - this.lander.x, py - this.lander.y) < reach.lander;
    const nearRover = !this.driving && Math.hypot(px - this.rover.x, py - this.rover.y) < BOARD_DIST;
    const pressed = this.touch.consumeAction() || this.actionQueued;
    this.actionQueued = false;
    // F is the keyboard's dedicated in/out of the rover, wherever you are
    const toggle = this.toggleQueued;
    this.toggleQueued = false;
    // On a phone the "E" in the prompt is meaningless — name the button the
    // player actually presses instead.
    const act = this.actionLabel();

    if (this.drilling) {
      this.promptText.setText(t('explore.drilling'));
      this.touch.setActionState(false, '…');
      return;
    }
    if (toggle && (this.driving || nearRover)) {
      if (this.driving) this.leaveRover(); else this.boardRover();
      return;
    }
    if (nearSample && s) {
      const key = this.driving ? 'explore.prompt_drill_rover' : 'explore.prompt_drill';
      this.promptText.setText(t(key, { act, sample: t(`sample.${s.def.id}`) }));
      this.touch.setActionState(true, this.touchLabel());
      if (pressed) this.startDrill(s);
    } else if (nearLander) {
      if (requiredTasksDone(this.planet, this.inventory)) {
        this.promptText.setText(t('explore.prompt_transmit', { act }));
        this.touch.setActionState(true, this.touchLabel());
        if (pressed) this.transmit();
      } else {
        const left = this.planet.tasks.filter((task) => task.required && !taskDone(task, this.inventory)).length;
        this.promptText.setText(t('explore.need_tasks', { n: left }));
        // in the rover the button still gets you out
        this.touch.setActionState(this.driving, this.touchLabel());
        if (pressed && this.driving) this.leaveRover();
      }
    } else if (nearRover) {
      this.promptText.setText(t('explore.prompt_board', { act }));
      this.touch.setActionState(true, this.touchLabel());
      if (pressed) this.boardRover();
    } else if (this.driving) {
      this.promptText.setText('');
      this.touch.setActionState(true, t('explore.rover_out_short'));
      if (pressed) this.leaveRover();
    } else {
      this.promptText.setText('');
      this.touch.setActionState(false, this.touchLabel());
    }
  }

  /** What the player should press, phrased for the current input scheme. */
  private actionLabel(): string {
    return isTouchMode() ? t('touch.tap') : 'E';
  }

  /** Caption on the round on-screen button itself. */
  private touchLabel(): string {
    return t('touch.action');
  }

  // ---------------------------------------------------------------- drill ---

  private startDrill(s: Sample): void {
    this.drilling = true;
    this.player.setVelocity(0, 0);
    this.rover.halt();
    // the driller wakes up: a line, the drill spinning up, then the loop
    playMinionVoice(this, 'driller_v02');
    playMinionSfx(this, 'driller_fx01');
    this.drillLoop = playMinionSfx(this, 'driller_fx02', { loop: true });
    const bar = this.add.graphics().setDepth(70);
    const icon = this.add.image(s.x, s.y - 60, 'tools_v2', 'tools_v2_power_drill')
      .setScale(0.8 * nativeRatio(this, 'tools_v2', 'tools_v2_power_drill')).setDepth(70);
    this.hudCam.ignore([bar, icon]);   // world-anchored
    const w = 80;
    const ms = s.def.drillMs;
    this.drill = { sample: s, bar, timer: this.time.addEvent({ delay: ms, callback: () => this.finishDrill(s) }) };
    this.tweens.addCounter({
      from: 0, to: 1, duration: ms,
      onUpdate: (tw) => {
        const v = tw.getValue() as number;
        bar.clear();
        bar.fillStyle(0x1d1b2e, 1).fillRoundedRect(s.x - w / 2, s.y - 50, w, 12, 6);
        bar.fillStyle(0x7ac74f, 1).fillRoundedRect(s.x - w / 2, s.y - 50, w * v, 12, 6);
      },
      onComplete: () => { icon.destroy(); },
    });
  }

  private finishDrill(s: Sample): void {
    this.drill?.bar.destroy();
    this.drill = undefined;
    this.drilling = false;
    stopMinionSound(this.drillLoop);
    this.drillLoop = undefined;
    // the rock breaks, then Grubb celebrates in Dug-Tongue
    playMinionSfx(this, 'driller_fx03');
    playAnyMinionVoice(this, ['driller_v04', 'driller_v08', 'driller_v01']);
    const before = this.planet.tasks.filter((task) => taskDone(task, this.inventory)).length;
    s.collected = true;
    s.go.setVisible(false);
    s.ring.setVisible(false);
    s.shadow?.setVisible(false);
    this.sparkleBurst(s.x, s.y);
    this.inventory.push(s.def.id);
    const after = this.planet.tasks.filter((task) => taskDone(task, this.inventory)).length;
    this.refreshRings();
    this.refreshHUD();
    this.fact(s.def, after > before);
  }

  /** Gold sparkle where the sample was: the reward needs a beat, otherwise the
   *  crystal just blinks out of existence. */
  private sparkleBurst(x: number, y: number): void {
    if (!this.textures.exists(V2) || !this.textures.get(V2).has(FX_ART.sparkleL)) return;
    for (let i = 0; i < 3; i++) {
      const img = this.add.image(
        x + Phaser.Math.Between(-18, 18),
        y + Phaser.Math.Between(-18, 18),
        V2, FX_ART.sparkleL,
      ).setDepth(72).setDisplaySize(18, 18);
      this.hudCam.ignore(img);
      this.tweens.add({
        targets: img,
        displayWidth: 96,
        displayHeight: 96,
        angle: Phaser.Math.Between(-90, 90),
        alpha: 0,
        delay: i * 90,
        duration: 620,
        ease: 'Quad.out',
        onComplete: () => img.destroy(),
      });
    }
  }

  private fact(def: SampleDef, taskFinished: boolean): void {
    this.factBox?.destroy();
    const { width, height } = this.scale;
    const c = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(100);
    c.add(makePanel(this, -260, -110, 520, 220, 0.98));
    c.add(addSampleIcon(this, -190, -40, def, SAMPLE_SIZE * 1.3));
    if (hasV2(this, UI_V2_ART.portraitChemist)) {
      c.add(this.add.image(-190, 38, V2, UI_V2_ART.portraitChemist).setDisplaySize(54, 54));
    }
    c.add(this.add.text(-120, -80, t(`sample.${def.id}`), { ...TXT.h2, fontSize: '22px' }).setOrigin(0, 0.5));
    c.add(this.add.text(-120, -58, t(`fact.${def.id}`), {
      ...TXT.body, fontSize: '15px', wordWrap: { width: 360 },
    }).setOrigin(0, 0));
    const headline = taskFinished ? t('explore.task_done') : t('explore.collected');
    c.add(this.add.text(0, 72, headline, { ...TXT.h2, color: taskFinished ? '#ffd23f' : '#7ac74f' }).setOrigin(0.5));
    this.factBox = c;
    this.cameras.main.ignore(c);     // screen-anchored → HUD camera only
    const close = () => {
      if (this.factBox !== c) return;
      c.destroy();
      this.factBox = undefined;
      this.input.keyboard?.off('keydown-E', close);
      this.input.off('pointerdown', close);
    };
    // the E that finished the drill must not also close the card
    this.time.delayedCall(250, () => {
      this.input.keyboard?.once('keydown-E', close);
      this.input.once('pointerdown', close);
    });
    this.time.delayedCall(4000, close);
  }

  private transmit(): void {
    if (this.ended) return;
    this.ended = true;
    this.player.setVelocity(0, 0);
    this.rover.halt();
    this.rover.stopMotor();
    this.promptText.setText(t('explore.transmitting'));
    const time = (this.time.now - this.startT) / 1000;
    const underTime = time < this.planet.timeLimit;
    const bonusDone = bonusTasksDone(this.planet, this.inventory);
    const result = {
      success: true,
      maxAltitude: 0,
      fuelPercent: 0,
      time,
      samples: this.inventory.length,
      tasksDone: this.planet.tasks.filter((task) => taskDone(task, this.inventory)).length,
      tasksTotal: this.planet.tasks.length,
    };
    const stars = this.mission.stars(result, { underTime, bonusDone });
    state.recordResult(this.mission.id, stars, result.time);
    state.addToCollection(this.inventory);
    saveGame();
    this.time.delayedCall(1400, () => {
      this.scene.start('result', { result, stars });
    });
  }
}
