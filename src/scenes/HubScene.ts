import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { Walker } from '../core/walker';
import { MISSIONS, MISSION_ORDER } from '../data/missions';
import { devSpawnOverride } from '../core/devtools';
import { isTouchMode, onInputModeChange } from '../core/device';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, type LabelButton } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { V2, BASE_ART, GROUND_ART, UI_V2_ART, hasV2, addStarRow } from '../ui/theme';
import { CrewMember, type CrewWho } from '../core/crew';
import { playAnyMinionVoice, playMinionSfx, stopMinionSound } from '../core/minionAudio';

const TILE = 64;
const MAP_W = 52;
const MAP_H = 34;
const WORLD_W = MAP_W * TILE;
const WORLD_H = MAP_H * TILE;
const INTERACT_RADIUS = 150;

const SPAWN = { x: 560, y: 1180 };
const PAD = { x: 2360, y: 1210 };
/** The fuel tanks, where the chemist works. */
const FUEL = { x: PAD.x - 380, y: PAD.y + 80 };
/** How close the player has to be before Fizz starts talking to herself. */
const FUEL_EARSHOT = 280;
/** Gap between one Fizz line and the next while the player loiters. */
const CHEMIST_CHATTER_MS = 13000;
/** Standing-still greeting: how long before the wave, and the pose frame. */
const WAVE_AFTER_MS = 4500;
const WAVE_FRAME = 'astro_wave';

/** A place in the base the player can walk up to and use. */
interface Station {
  id: 'pad' | 'board' | 'lab';
  x: number;
  y: number;
  promptKey: string;
}

export class HubScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private walker!: Walker;
  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private stations: Station[] = [];
  private crew: CrewMember[] = [];
  private promptText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private guide?: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  private toastText?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private overlayButtons: LabelButton[] = [];
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private controlsText?: Phaser.GameObjects.Text;
  private inGameMenu!: InGameMenu;
  private leaving = false;
  /** Time spent standing still, and whether the wave pose is currently up. */
  private waveTimer = 0;
  private waving = false;
  /** The chemist's bubbling flask, while the player is near the fuel tanks. */
  private fizzLoop?: Phaser.Sound.BaseSound;
  /** Milliseconds until Fizz says something else. */
  private chemistQuietFor = 0;

  constructor() { super('hub'); }

  create(): void {
    ensureMusic(this, state.music);
    this.leaving = false;
    this.stations = [];
    this.hudObjects = [];
    this.cameras.main.setBackgroundColor(0x141428);

    this.buildGround();
    this.buildBase();
    this.buildPlayer();
    this.buildCrew();
    this.buildHud();
    this.refreshObjective();

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setZoom(1.35);

    // the world camera is zoomed, so the overlay needs its own camera
    this.hudCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.hudCam.setName('hud');
    this.hudCam.transparent = true;
    const hudSet = new Set<Phaser.GameObjects.GameObject>(this.hudObjects);
    this.hudCam.ignore(this.children.list.filter((o) => !hudSet.has(o)));
    this.cameras.main.ignore(this.hudObjects);

    this.inGameMenu = new InGameMenu(this, {
      onEscapeBeforeOpen: () => {
        if (this.overlay) {
          this.closeOverlay();
          return true;
        }
        return false;
      },
      onOpen: () => {
        this.player.setVelocity(0, 0);
      },
      onQuit: () => this.leave('menu'),
    });

    // plugging a keyboard into a tablet flips the scheme mid-walk; the hint has
    // to follow, or the player is told to press keys that are not there
    const unsubscribe = onInputModeChange(() => this.refreshControlsHint());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    // the fizz is a global sound: it must not follow the player out of the base
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => stopMinionSound(this.fizzLoop));
  }

  private refreshControlsHint(): void {
    this.controlsText?.setText(t(isTouchMode() ? 'hub.controls_touch' : 'hub.controls'));
  }

  // ---------------------------------------------------------------- world ---

  private buildGround(): void {
    // solid regolith under everything so seams read as ground, not as gaps
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x3a3040).setDepth(-30);

    const rng = new Phaser.Math.RandomDataGenerator(['star-chasers-base']);
    // One dominant material keeps the ground readable; the other terrain_v2
    // materials have their own palettes and mix into an obvious checkerboard.
    // Ice only appears out in the open, never on the built-up apron.
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const x = tx * TILE;
        const y = ty * TILE;
        // One material only. The ice frames are a bright blue grid that reads as
        // a tiled wall beside the paved apron rather than as regolith.
        // Drawn slightly oversize so neighbours overlap: at exactly 64 px the
        // frames' own edges line up into a hard lattice of seams.
        this.add.image(x + TILE / 2, y + TILE / 2, 'terrain_v2', 'terrain_crater_64')
          .setDisplaySize(TILE + 3, TILE + 3).setDepth(-20);
      }
    }

    // --- the paved apron the base is built on -------------------------------
    // Real deck tiles instead of a wash: the v2 ground art is seamless, so a
    // TileSprite covers the whole apron without a visible repeat lattice.
    const APRON = { x: 240, y: 800, w: 2920, h: 860 };
    this.add.tileSprite(
      APRON.x + APRON.w / 2, APRON.y + APRON.h / 2, APRON.w, APRON.h, V2, GROUND_ART.plate,
    ).setDepth(-12);

    // A light scatter of scuffed plates only. Mixing the worn tile in at a high
    // rate doubled the rust-yellow plates already inside the base tile and the
    // deck read as a checkerboard of hazard markings.
    for (let y = APRON.y; y < APRON.y + APRON.h; y += 256) {
      for (let x = APRON.x; x < APRON.x + APRON.w; x += 256) {
        if (rng.frac() > 0.16) continue;
        this.add.image(x + 128, y + 128, V2, GROUND_ART.worn).setDepth(-11).setAlpha(0.85);
      }
    }

    // hazard stripping around the apron edge
    const HZ = 26;
    const midX = APRON.x + APRON.w / 2;
    const midY = APRON.y + APRON.h / 2;
    this.add.tileSprite(midX, APRON.y + HZ / 2, APRON.w, HZ, V2, GROUND_ART.hazard).setDepth(-10);
    this.add.tileSprite(midX, APRON.y + APRON.h - HZ / 2, APRON.w, HZ, V2, GROUND_ART.hazard).setDepth(-10);
    this.add.tileSprite(APRON.x + HZ / 2, midY, HZ, APRON.h - HZ * 2, V2, GROUND_ART.hazard).setDepth(-10);
    this.add.tileSprite(APRON.x + APRON.w - HZ / 2, midY, HZ, APRON.h - HZ * 2, V2, GROUND_ART.hazard).setDepth(-10);

    // compacted track running from the habitat out to the pad
    this.add.tileSprite(1500, 1400, 1760, 116, V2, GROUND_ART.road).setDepth(-9);

    // painted landing pad: one slab of the painted-concrete art under the pad,
    // plus a clean ring so the circle reads as closed at a distance
    this.add.image(PAD.x, PAD.y + 40, V2, BASE_ART.padMark)
      .setDisplaySize(760, 760).setDepth(-8).setAlpha(0.92);
    const ring = this.add.graphics().setDepth(-7);
    ring.lineStyle(6, 0xffd23f, 0.42);
    ring.strokeCircle(PAD.x, PAD.y + 40, 300);

    // scattered rocks (obstacles outside the apron)
    this.solids = this.physics.add.staticGroup();
    const rockFrames = ['terrain_crater_rock', 'terrain_crystal_rock', 'terrain_fossil_rock'];
    for (let i = 0; i < 70; i++) {
      const x = rng.between(80, WORLD_W - 80);
      const y = rng.between(80, WORLD_H - 80);
      if (x > 180 && x < 3220 && y > 740 && y < 1720) continue;   // keep the apron clear
      const rock = this.solids.create(x, y, 'terrain', rng.pick(rockFrames)) as Phaser.Physics.Arcade.Sprite;
      rock.setScale(0.8).refreshBody().setDepth(y);
    }
    // decor scatter — only out on the open regolith: these frames are dark, so
    // over the paved apron they read as holes in the ground
    for (let i = 0; i < 90; i++) {
      const x = rng.between(0, WORLD_W);
      const y = rng.between(0, WORLD_H);
      const onApron = x > 180 && x < 3240 && y > 740 && y < 1720;
      if (onApron) continue;
      this.add.image(x, y, 'terrain', rng.pick(['terrain_crater_dirt', 'terrain_alien_grass_eyes']))
        .setScale(0.55).setAlpha(0.7).setDepth(-5);
    }
  }

  /** Place a machine scaled to a target world height, register it as solid,
   *  and label it. The handoff frames are large (a workbench is ~500 px tall),
   *  so a raw scale of 1 leaves furniture towering over the astronaut. */
  private place(key: string, frame: string, x: number, y: number, height: number, signKey?: string): Phaser.GameObjects.Image {
    const src = this.textures.getFrame(key, frame);
    const scale = height / (src?.height || height);
    const img = this.add.image(x, y, key, frame).setScale(scale).setDepth(y);
    // A small foot blocker, not the full sprite bounds: the full bounds shoved
    // the player sideways when they spawned near a machine and stopped them
    // walking up to anything.
    const blocker = this.add.rectangle(x, y + img.displayHeight * 0.38, img.displayWidth * 0.6, 48, 0x000000, 0);
    this.physics.add.existing(blocker, true);
    this.solids.add(blocker);
    if (signKey) {
      // the sign sits at the machine's feet: with the camera zoomed 1.5, a label
      // above a 400 px pad would sit outside the view most of the time
      this.add.text(x, y + img.displayHeight / 2 + 10, t(signKey), {
        ...TXT.small, fontSize: '14px', color: '#ffe8a3', fontStyle: 'bold',
        stroke: '#1d1b2e', strokeThickness: 5,
      }).setOrigin(0.5, 0).setDepth(y - 1);
    }
    return img;
  }

  private buildBase(): void {
    // heights are in world pixels; the astronaut stands ~90 px tall
    // --- launch pad: the goal ---
    this.place('machines', 'machines_rocket_launchpad', PAD.x, PAD.y, 400, 'hub.sign_pad');
    this.stations.push({ id: 'pad', x: PAD.x, y: PAD.y + 120, promptKey: 'hub.prompt_pad' });

    // --- the gantry and its ground equipment ---
    this.place(V2, BASE_ART.tower, PAD.x + 320, PAD.y + 30, 540);
    const clampAngles = [-2.5, -0.7, 0.4, 1.9];
    for (const a of clampAngles) {
      this.place(V2, BASE_ART.padClamp, PAD.x + Math.cos(a) * 240, PAD.y + 60 + Math.sin(a) * 170, 96);
    }
    this.place(V2, BASE_ART.tanks, FUEL.x, FUEL.y, 210, 'hub.sign_fuel');

    // --- mission board: a standing holo-terminal ---
    const board = { x: 1180, y: 1010 };
    this.place(V2, BASE_ART.board, board.x, board.y, 240, 'hub.sign_board');
    this.stations.push({ id: 'board', x: board.x, y: board.y + 110, promptKey: 'hub.prompt_board' });

    // --- flight computer: the control shack with its roof dish ---
    const lab = { x: 700, y: 1010 };
    this.place(V2, BASE_ART.control, lab.x, lab.y, 260, 'hub.sign_lab');
    this.stations.push({ id: 'lab', x: lab.x, y: lab.y + 100, promptKey: 'hub.prompt_lab' });

    // --- crew habitat: the home landmark at the back of the apron ---
    this.place(V2, BASE_ART.habitat, 1780, 940, 320, 'hub.sign_habitat');
    this.place(V2, BASE_ART.airlock, 1440, 1020, 160);
    this.place(V2, BASE_ART.dish, 2680, 1540, 180);

    // --- supply crates stacked by the habitat ---
    this.place(V2, BASE_ART.crateA, 2060, 900, 74);
    this.place(V2, BASE_ART.crateB, 2150, 930, 64);
    this.place(V2, BASE_ART.crateC, 2090, 985, 70);

    // --- machinery that gives the base a sense of scale ---
    this.place('machines', 'machines_solar_array', 520, 1620, 150, 'hub.sign_solar');
    this.place('machines', 'machines_solar_array', 860, 1620, 150);
    this.place('machines', 'machines_generator', 1180, 1620, 160);
    this.place('machines', 'machines_rover', 1900, 1600, 120, 'hub.sign_rover');

    // Stations also answer to a click, so a trackpad player never has to hunt
    // for the E key. The range check keeps the world rules identical.
    for (const s of this.stations) {
      const z = this.add.zone(s.x, s.y - 40, 240, 200).setInteractive();
      if (z.input) z.input.cursor = 'pointer';
      z.on('pointerup', () => {
        if (this.overlay || this.inGameMenu?.isOpen || this.leaving) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
        if (d > INTERACT_RADIUS) { this.showToast(t('hub.too_far')); return; }
        this.useStation(s.id);
      });
    }
  }

  private buildPlayer(): void {
    const g = state.astronaut;
    // ?spawn=board|lab|pad — dev shortcut to start next to a station
    const want = devSpawnOverride();
    const at = want ? this.stations.find((s) => s.id === want) : undefined;
    const spawn = at ? { x: at.x, y: at.y + 40 } : SPAWN;
    this.player = this.physics.add.sprite(spawn.x, spawn.y, `astro_${g}_walk`, `astro_${g}_walk_front_0`);
    this.player.setSize(46, 54).setDepth(spawn.y + 10);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.add.collider(this.player, this.solids);
    this.walker = new Walker(this, this.player, g, 180);
  }

  private buildCrew(): void {
    // the v2 walk sheets are real 4-direction cycles, so the crew patrols short
    // loops between the buildings instead of hopping in place
    const patrols: { who: CrewWho; path: { x: number; y: number }[]; speed?: number }[] = [
      {
        who: 'mechanic',
        path: [
          { x: 900, y: 1250 }, { x: 1380, y: 1250 },
          { x: 1380, y: 1440 }, { x: 900, y: 1440 },
        ],
      },
      {
        who: 'driller',
        path: [
          { x: 2020, y: 1300 }, { x: 2180, y: 1160 },
          { x: 2020, y: 1160 }, { x: 2180, y: 1300 },
        ],
        speed: 38,
      },
      {
        who: 'radio',
        path: [
          { x: 620, y: 1180 }, { x: 1010, y: 1180 },
          { x: 1010, y: 1330 }, { x: 620, y: 1330 },
        ],
        speed: 52,
      },
      {
        // the chemist shuttles between the airlock and the habitat
        who: 'chemist',
        path: [
          { x: 1520, y: 1180 }, { x: 1740, y: 1180 },
          { x: 1740, y: 1320 }, { x: 1520, y: 1320 },
        ],
        speed: 44,
      },
    ];
    this.crew = patrols.map((p) => new CrewMember(this, p));
  }

  // ------------------------------------------------------------------ hud ---

  private buildHud(): void {
    const { width, height } = this.scale;
    this.objectiveText = this.add.text(16, 14, t('hub.objective'), {
      ...TXT.h2, fontSize: '18px', backgroundColor: '#1d1d3acc', padding: { x: 12, y: 7 },
    }).setScrollFactor(0).setDepth(60);

    this.promptText = this.add.text(width / 2, height - 84, '', {
      ...TXT.h2, fontSize: '20px', backgroundColor: '#1d1d3acc', padding: { x: 14, y: 8 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(60);

    const keys = this.add.text(width / 2, height - 34, t('hub.controls'), {
      ...TXT.small, fontSize: '12px', color: '#b9bde0',
      backgroundColor: '#1d1d3acc', padding: { x: 10, y: 5 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(60);
    this.controlsText = keys;
    this.refreshControlsHint();

    const menuBtn = makeIconButton(this, width - 38, 36, 'ico_gear', () => {
      if (this.overlay) this.closeOverlay();
      this.inGameMenu.toggle();
    }, 44);
    menuBtn.setDepth(65);

    this.hudObjects = [this.objectiveText, this.promptText, keys, menuBtn, ...this.walker.touch.objects];
  }

  private showToast(msg: string): void {
    this.toastText?.destroy();
    const { width, height } = this.scale;
    const txt = this.add.text(width / 2, height - 150, msg, {
      ...TXT.body, fontSize: '17px', backgroundColor: '#1d1d3acc', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(70);
    this.cameras.main.ignore(txt);
    this.toastText = txt;
    this.tweens.add({ targets: txt, alpha: 0, delay: 1800, duration: 400, onComplete: () => { txt.destroy(); if (this.toastText === txt) this.toastText = undefined; } });
  }

  // --------------------------------------------------------------- update ---

  override update(_time: number, delta: number): void {
    if (this.leaving) return;
    // the crew keeps walking while the mission picker is open
    for (const c of this.crew) c.update(delta);
    if (this.overlay || this.inGameMenu?.isOpen) { this.player.setVelocity(0, 0); return; }

    const move = this.walker.update();
    this.updateWave(move.moving, delta);
    this.player.setDepth(this.player.y + 10);

    // the keyboard prompt is noise on a phone: there is no E to press there
    const key = isTouchMode() ? '' : '  ·  E';
    const actionLabel = t('touch.action');
    const near = this.nearestStation();
    if (near) {
      this.promptText.setText(`${t(near.promptKey)}${key}`);
      this.walker.touch.setActionState(true, actionLabel);
      if (this.walker.interactJustPressed) this.useStation(near.id);
    } else {
      this.promptText.setText(t('hub.prompt_walk'));
      this.walker.touch.setActionState(false, actionLabel);
    }

    this.drawGuide();
    this.updateFuelFarmAudio(delta);
  }

  /**
   * Fizz works the fuel tanks. Standing near her should sound like standing
   * near a chemist: a flask bubbling continuously, and the occasional line in
   * Fizzle. Both are silent until the recordings are imported, so the base is
   * unchanged for a player without the audio.
   */
  private updateFuelFarmAudio(delta: number): void {
    const near = Phaser.Math.Distance.Between(this.player.x, this.player.y, FUEL.x, FUEL.y) < FUEL_EARSHOT;

    if (!near) {
      if (this.fizzLoop) {
        stopMinionSound(this.fizzLoop);
        this.fizzLoop = undefined;
      }
      this.chemistQuietFor = 0;
      return;
    }

    if (!this.fizzLoop) {
      this.fizzLoop = playMinionSfx(this, 'chemist_fx02', { loop: true, volume: 0.3 });
      // arriving is worth a greeting straight away, not after the first gap
      this.chemistQuietFor = 0;
    }

    this.chemistQuietFor -= delta;
    if (this.chemistQuietFor > 0) return;
    this.chemistQuietFor = CHEMIST_CHATTER_MS + Phaser.Math.Between(0, 5000);
    playAnyMinionVoice(this, [
      'chemist_v01', 'chemist_v05', 'chemist_v07', 'chemist_v10', 'chemist_v06',
    ]);
  }

  /** After a few seconds standing still the astronaut turns to the camera and
   *  waves. Any input drops the pose and the walker takes the sprite back. */
  private updateWave(moving: boolean, delta: number): void {
    if (moving) {
      if (this.waving) this.stopWave();
      this.waveTimer = 0;
      return;
    }
    if (this.waving || !hasV2(this, WAVE_FRAME)) return;
    this.waveTimer += delta;
    if (this.waveTimer >= WAVE_AFTER_MS) this.startWave();
  }

  private startWave(): void {
    const f = this.textures.getFrame(V2, WAVE_FRAME);
    if (!f) return;
    const h = this.player.displayHeight;
    this.player.anims.stop();
    this.player.setTexture(V2, WAVE_FRAME);
    // the wave art is cut taller than a walk frame: match heights, not scales
    this.player.setDisplaySize(Math.round(h * (f.width / f.height)), h);
    this.walker.hold = true;
    this.waving = true;
  }

  private stopWave(): void {
    this.waving = false;
    this.walker.hold = false;
    // back to the walk atlas at its natural scale
    this.player.setScale(1);
    this.player.setTexture(
      `astro_${state.astronaut}_walk`,
      `astro_${state.astronaut}_walk_front_0`,
    );
  }

  private nearestStation(): Station | null {
    let best: Station | null = null;
    let bestD = INTERACT_RADIUS;
    for (const s of this.stations) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Arrow above the player pointing at the pad until you have a rocket. */
  private drawGuide(): void {
    const show = !state.design.parts.length;
    if (!show) { this.guide?.setVisible(false); return; }
    const a = Math.atan2(PAD.y - this.player.y, PAD.x - this.player.x);
    if (!this.guide) {
      if (hasV2(this, UI_V2_ART.arrow)) {
        const img = this.add.image(0, 0, V2, UI_V2_ART.arrow)
          .setDisplaySize(38, 38).setDepth(9000);
        this.hudCam?.ignore(img);
        this.guide = img;
      } else {
        const g = this.add.graphics().setDepth(9000);
        g.fillStyle(0xffd23f, 1).lineStyle(3, 0x1d1b2e);
        g.fillTriangle(0, -16, -11, 8, 11, 8);
        g.strokeTriangle(0, -16, -11, 8, 11, 8);
        this.hudCam?.ignore(g);
        this.guide = g;
      }
    }
    this.guide.setVisible(true);
    this.guide.setPosition(this.player.x, this.player.y - 76);
    // ui_arrow curves to point right (angle 0), while the drawn fallback points up
    this.guide.setRotation(this.guide instanceof Phaser.GameObjects.Image ? a : a + Math.PI / 2);
  }

  // ---------------------------------------------------------- interaction ---

  private useStation(id: Station['id']): void {
    if (id === 'pad') {
      // the Moon mission starts on foot, everything else starts in the builder
      this.leave(state.missionId === 'moon' ? 'explore' : 'builder');
      return;
    }
    if (id === 'lab') {
      if (!state.design.parts.length) { this.showToast(t('hub.need_rocket')); return; }
      this.leave('code');
      return;
    }
    this.openMissionPicker();
  }

  private openMissionPicker(): void {
    if (this.overlay) return;
    const { width, height } = this.scale;
    const rows: { id: string | null; title: string; locked: boolean; stars: number }[] = [
      ...MISSION_ORDER.map((id) => ({
        id,
        title: t(MISSIONS[id].titleKey),
        locked: !state.missionUnlocked(id, MISSION_ORDER),
        stars: state.progress[id]?.stars ?? 0,
      })),
      { id: null, title: t('menu.sandbox'), locked: false, stars: -1 },
    ];

    // the painted panel has a thick ornate rim, so the content starts below it
    const panelH = 150 + rows.length * 74;
    const c = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(100);
    this.overlay = c;
    this.cameras.main.ignore(c);

    c.add(makePanel(this, -320, -panelH / 2, 640, panelH, 0.98));
    c.add(this.add.text(0, -panelH / 2 + 84, t('hub.board_title'), TXT.h2).setOrigin(0.5));

    // buttons are placed at absolute screen coordinates and their hit zones are
    // attached to the HUD camera: a button's Zone is a scene-level sibling, so
    // re-parenting it into the panel would leave the click target behind.
    rows.forEach((r, i) => {
      const y = -panelH / 2 + 132 + i * 74;
      const b = makeButton(this, width / 2, height / 2 + y, r.title, {
        w: 520, h: 58, fontSize: 19,
        variant: r.id === null ? 'green' : r.locked ? 'purple' : 'blue',
        onClick: () => {
          if (r.locked) { this.showToast(t('menu.locked')); return; }
          if (r.id === null) {
            state.mode = 'sandbox';
            state.missionId = null;
          } else {
            state.mode = 'mission';
            state.missionId = r.id;
          }
          saveGame();
          this.closeOverlay();
          this.refreshObjective();
        },
      });
      // the panel container sits at depth 100; buttons must render above it
      b.setDepth(101);
      if (r.locked) b.setAlpha(0.55);
      this.cameras.main.ignore(b);
      if (b.hitZone) this.cameras.main.ignore(b.hitZone);
      this.overlayButtons.push(b);
      if (r.stars >= 0) {
        const sr = addStarRow(this, 270, y, r.stars, 24, 3);
        if (r.locked) sr.setAlpha(0.45);
        c.add(sr);
      }
    });

    const close = makeButton(this, width / 2, height / 2 + panelH / 2 - 40, t('hub.close'), {
      w: 200, h: 46, fontSize: 16, variant: 'red', onClick: () => this.closeOverlay(),
    });
    close.setDepth(101);
    this.cameras.main.ignore(close);
    if (close.hitZone) this.cameras.main.ignore(close.hitZone);
    this.overlayButtons.push(close);
  }

  private closeOverlay(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    for (const b of this.overlayButtons) b.destroy();
    this.overlayButtons = [];
  }

  private refreshObjective(): void {
    const label = state.missionId ? t(MISSIONS[state.missionId].titleKey) : t('menu.sandbox');
    this.objectiveText.setText(`${t('hub.objective')}  ·  ${label}`);
  }

  private leave(scene: string): void {
    if (this.leaving) return;
    this.leaving = true;
    saveGame();
    this.scene.start(scene);
  }
}
