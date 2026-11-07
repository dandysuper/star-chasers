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
import { TouchControls } from '../ui/touch';
import { addSampleIcon } from '../ui/sampleArt';
import { isTouchMode, onInputModeChange } from '../core/device';
import { MINION_HEIGHT, attachMinionFit } from '../core/minionArt';
import {
  playAnyMinionVoice, playMinionSfx, playMinionVoice, stopMinionSound,
} from '../core/minionAudio';

const TILE = 64;
const MAP_W = 40;
const MAP_H = 30;
const SPAWN = { x: 400, y: 400 };
/** Longest edge of a sample icon on the ground, px. */
const SAMPLE_SIZE = 60;

interface Sample {
  def: SampleDef;
  go: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  x: number; y: number;
  collected: boolean;
  /** Ring colour last drawn, so it is only redrawn when the role changes. */
  wanted?: boolean;
}

interface Helper {
  go: Phaser.GameObjects.Image;
  bubble?: Phaser.GameObjects.Container;
  offset: { x: number; y: number };
  kind: string;
}

interface Speck { x: number; y: number; vx: number; vy: number; r: number; a: number }

const MINIMAP_SIZE = 156;
const MINIMAP_RAD = 58;
const RING_WANTED = 0xffd23f;   // a sample one of the tasks still needs
const RING_SPARE = 0x59f7ff;    // any other sample

export class ExploreScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyWASD!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
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
  private dust: Speck[] = [];
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private inGameMenu!: InGameMenu;
  private pauseStart = 0;

  constructor() { super('explore'); }

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
    this.drilling = false;
    this.drill = undefined;
    this.factBox = undefined;
    this.scoutArrow = undefined;
    this.inventory = [];
    this.samples = [];
    this.helpers = [];
    this.dust = [];
    this.hintTimer = 0;
    this.idleT = 0;
    this.cameras.main.setBackgroundColor(this.planet.sky);
    this.startT = this.time.now;

    const rng = new Phaser.Math.RandomDataGenerator([`${Date.now() % 9973}`]);
    this.buildTerrain(rng);
    this.buildLander();

    // --- player astronaut ---
    const g = state.astronaut;
    this.player = this.physics.add.sprite(SPAWN.x + 90, SPAWN.y + 40, `astro_${g}_walk`, `astro_${g}_walk_front_0`);
    this.player.setCollideWorldBounds(true);
    this.player.setSize(50, 60);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.physics.add.collider(this.player, this.rockGroup);

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.setZoom(1.4);

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
    this.refreshHUD();

    this.buildMinimap();
    if (this.planet.dust) this.buildDust();

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
    this.hudObjects = [this.taskText, this.invText, this.promptText, menuBtn, ...this.touch.objects];
    if (this.minimapContainer) this.hudObjects.push(this.minimapContainer);
    if (this.dustGfx) this.hudObjects.push(this.dustGfx);
    const hudSet = new Set<Phaser.GameObjects.GameObject>(this.hudObjects);
    this.hudCam.ignore(this.children.list.filter((o) => !hudSet.has(o)));
    this.cameras.main.ignore(this.hudObjects);

    this.inGameMenu = new InGameMenu(this, {
      onOpen: () => {
        this.player.setVelocity(0, 0);
        this.pauseStart = this.time.now;
        if (this.drill) this.drill.timer.paused = true;
        this.drillLoop?.pause();
      },
      onClose: () => {
        if (this.pauseStart) {
          this.startT += this.time.now - this.pauseStart;
          this.pauseStart = 0;
        }
        if (this.drill) this.drill.timer.paused = false;
        this.drillLoop?.resume();
      },
      onHub: () => this.scene.start('hub'),
      onQuit: () => this.scene.start('menu'),
    });

    // the sound manager is global, so a loop outlives the scene unless it is
    // explicitly stopped — leaving the drill running in the menu is the sort of
    // bug nobody reports, they just hear it
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => stopMinionSound(this.drillLoop));

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyWASD = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keyE = this.input.keyboard!.addKey('E');

    // the first line of the walk says where you are and what the job is
    this.time.delayedCall(600, () => {
      const radio = this.helpers.find((h) => h.kind === 'minions_radio_scout') ?? this.helpers[0];
      if (radio && !this.ended) this.bubble(radio, t(`explore.arrive.${this.planet.id}`));
    });
  }

  // ------------------------------------------------------------- terrain ---

  /** A tile image: the dedicated planet art when it is loaded, otherwise the
   *  atlas frame under the planet's tint. */
  private tile(x: number, y: number, art: TileArt): Phaser.GameObjects.Image {
    if (art.art && this.textures.exists(art.art)) {
      return this.add.image(x, y, art.art).setDisplaySize(TILE + 1, TILE + 1);
    }
    const img = this.add.image(x, y, 'terrain_v2', art.frame);
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
    const groundPainted = painted(p.ground);
    const patchChance = groundPainted ? 0 : p.patchChance;
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const art = rng.frac() < patchChance ? p.patch : p.ground;
        this.tile(tx * TILE + TILE / 2, ty * TILE + TILE / 2, art);
      }
    }
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
      rock.setScale(0.8).refreshBody();
      if (p.rockTint !== undefined) rock.setTint(p.rockTint);
    }
    for (let i = 0; i < (groundPainted ? 0 : 80); i++) {
      const x = rng.between(0, MAP_W * TILE);
      const y = rng.between(0, MAP_H * TILE);
      const d = this.add.image(x, y, 'terrain', rng.pick(p.decor)).setScale(0.6).setAlpha(0.8).setDepth(-1);
      if (p.decorTint !== undefined) d.setTint(p.decorTint);
    }
  }

  /** A drawn cartoon boulder with a solid foot. The terrain atlas rocks are
   *  opaque squares, which read as holes on the painted ground. */
  private addBoulder(x: number, y: number, rng: Phaser.Math.RandomDataGenerator): void {
    const mars = this.planet.id === 'mars';
    const body = mars ? 0x8a4128 : 0x7d7f86;
    const light = mars ? 0xb8613f : 0xa9abb2;
    const dark = mars ? 0x5e2a1a : 0x55575e;
    const w = rng.between(38, 64);
    const h = Math.round(w * rng.realInRange(0.6, 0.8));
    const g = this.add.graphics().setPosition(x, y);
    g.fillStyle(0x000000, 0.22).fillEllipse(4, h * 0.42, w * 1.05, h * 0.42);
    g.fillStyle(body, 1).fillEllipse(0, 0, w, h);
    g.fillStyle(light, 1).fillEllipse(-w * 0.14, -h * 0.18, w * 0.5, h * 0.36);
    g.fillStyle(dark, 1).fillEllipse(w * 0.2, h * 0.16, w * 0.22, h * 0.18);
    g.lineStyle(3, 0x1d1b2e, 1).strokeEllipse(0, 0, w, h);
    const foot = this.add.zone(x, y + h * 0.1, w * 0.8, h * 0.6);
    this.physics.add.existing(foot, true);
    this.rockGroup.add(foot);
  }

  private buildLander(): void {
    const p = this.planet;
    if (p.landerArt && this.textures.exists(p.landerArt)) {
      this.lander = this.add.image(SPAWN.x, SPAWN.y, p.landerArt);
      const s = 200 / Math.max(this.lander.width, this.lander.height);
      this.lander.setScale(s);
    } else {
      this.lander = this.add.image(SPAWN.x, SPAWN.y, 'machines', 'machines_rocket_launchpad').setScale(0.8);
    }
    // Mars has company: a parked rover beside the lander, a nod to the real
    // rovers that do this job there today
    if (p.id === 'mars') {
      this.add.image(SPAWN.x - 170, SPAWN.y + 70, 'machines', 'machines_rover').setScale(0.5).setTint(0xf0c8b0);
    }
    // Tap the lander directly on smartphones to transmit once the tasks are done
    this.lander.setInteractive();
    if (this.lander.input) this.lander.input.cursor = 'pointer';
    this.lander.on('pointerup', () => {
      if (this.inGameMenu?.isOpen || this.drilling || this.ended) return;
      const near = Math.hypot(this.player.x - this.lander.x, this.player.y - this.lander.y) < 110;
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
        const ring = this.add.graphics().setPosition(x, y);
        const go = addSampleIcon(this, x, y, def, SAMPLE_SIZE);
        const sample: Sample = { def, go, ring, x, y, collected: false };
        // Tap a sample directly on touch screens when within reach
        go.setInteractive();
        if (go.input) go.input.cursor = 'pointer';
        go.on('pointerup', () => {
          if (this.inGameMenu?.isOpen || this.drilling || this.ended || sample.collected) return;
          if (Math.hypot(sample.x - this.player.x, sample.y - this.player.y) < 84) this.startDrill(sample);
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
    this.dustGfx = this.add.graphics().setScrollFactor(0).setDepth(40);
  }

  private updateDust(delta: number): void {
    const g = this.dustGfx;
    if (!g) return;
    const { width, height } = this.scale;
    const dt = delta / 1000;
    g.clear();
    // a faint haze keeps the whole frame a little dusty
    g.fillStyle(0xd2875a, 0.07).fillRect(0, 0, width, height);
    for (const s of this.dust) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -4) { s.x = width + 4; s.y = Phaser.Math.Between(0, height); }
      if (s.y < -4) s.y = height + 4; else if (s.y > height + 4) s.y = -4;
      g.fillStyle(0xf0b088, s.a).fillCircle(s.x, s.y, s.r);
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

  override update(_t: number, delta: number): void {
    this.updateDust(delta);
    if (this.ended) return;
    if (this.inGameMenu?.isOpen) {
      this.player.setVelocity(0, 0);
      return;
    }
    const speed = this.planet.walkSpeed;
    let vx = (this.cursors.left.isDown || this.keyWASD.A.isDown ? -speed : 0) + (this.cursors.right.isDown || this.keyWASD.D.isDown ? speed : 0);
    let vy = (this.cursors.up.isDown || this.keyWASD.W.isDown ? -speed : 0) + (this.cursors.down.isDown || this.keyWASD.S.isDown ? speed : 0);
    if (vx === 0 && vy === 0 && (this.touch.dx !== 0 || this.touch.dy !== 0)) {
      vx = this.touch.dx * speed;
      vy = this.touch.dy * speed;
    }
    if (this.drilling) { vx = 0; vy = 0; }
    this.player.setVelocity(vx, vy);

    const g = state.astronaut;
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      this.idleT = 0;
      const dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'side_right' : 'side_left') : (vy > 0 ? 'front' : 'back');
      this.player.play(`astro_${g}_walk_${dir}`, true);
    } else {
      this.idleT += delta;
      const cur = this.player.anims.currentAnim?.key ?? `astro_${g}_walk_front`;
      const dir = cur.replace(`astro_${g}_walk_`, '').replace(`astro_${g}_idle_`, '');
      this.player.play(`astro_${g}_idle_${dir}`, true);
    }

    // helpers follow with lag
    for (const h of this.helpers) {
      const tx = this.player.x + h.offset.x;
      const ty = this.player.y + h.offset.y;
      h.go.x = Phaser.Math.Linear(h.go.x, tx, 0.05);
      h.go.y = Phaser.Math.Linear(h.go.y, ty, 0.05);
      h.go.setFlipX(this.player.x < h.go.x);
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
    const h = this.helpers[Math.floor(Math.random() * this.helpers.length)];
    const hints = this.planet.hintKeys;
    const key = hints[Math.floor(Math.random() * hints.length)];
    this.bubble(h, t(key, { act: this.actionLabel() }));
  }

  private bubble(h: Helper, text: string): void {
    h.bubble?.destroy();
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
    const s = this.nearestSample(px, py);
    const nearSample = s && Math.hypot(s.x - px, s.y - py) < 64;
    const nearLander = Math.hypot(px - this.lander.x, py - this.lander.y) < 96;
    const pressed = Phaser.Input.Keyboard.JustDown(this.keyE) || this.touch.consumeAction();
    // On a phone the "E" in the prompt is meaningless — name the button the
    // player actually presses instead.
    const act = this.actionLabel();

    if (this.drilling) {
      this.promptText.setText(t('explore.drilling'));
      this.touch.setActionState(false, '…');
      return;
    }
    if (nearSample && s) {
      this.promptText.setText(t('explore.prompt_drill', { act, sample: t(`sample.${s.def.id}`) }));
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
        this.touch.setActionState(false, this.touchLabel());
      }
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
    // the driller wakes up: a line, the drill spinning up, then the loop
    playMinionVoice(this, 'driller_v02');
    playMinionSfx(this, 'driller_fx01');
    this.drillLoop = playMinionSfx(this, 'driller_fx02', { loop: true });
    const bar = this.add.graphics().setDepth(70);
    const icon = this.add.image(s.x, s.y - 60, 'tools_v2', 'tools_v2_power_drill').setScale(0.8).setDepth(70);
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
