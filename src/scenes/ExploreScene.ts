import Phaser from 'phaser';
import { state } from '../core/state';
import { t, fmtTime } from '../core/i18n';
import { missionById } from '../data/missions';
import { makePanel, ensureMusic, TXT } from '../ui/widgets';
import { V2, FX_ART, UI_V2_ART, hasV2, makeSpeechBubble } from '../ui/theme';
import { TouchControls } from '../ui/touch';

const TILE = 64;
const MAP_W = 40;
const MAP_H = 30;
const SAMPLE_IDS = ['purple_crystal', 'iron_ore', 'ice_cube_bug', 'magma_rock', 'gold_nugget'] as const;
const SAMPLE_FRAMES: Record<string, string> = {
  purple_crystal: 'resources_purple_crystal',
  iron_ore: 'resources_iron_ore',
  ice_cube_bug: 'resources_ice_cube_bug',
  magma_rock: 'resources_magma_rock',
  gold_nugget: 'resources_gold_nugget',
};

interface Sample {
  id: string;
  go: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  x: number; y: number;
  collected: boolean;
}

interface Helper {
  go: Phaser.GameObjects.Image;
  bubble?: Phaser.GameObjects.Container;
  offset: { x: number; y: number };
  kind: string;
}

const MINIMAP_SIZE = 156;
const MINIMAP_RAD = 58;

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
  private collected = 0;
  private invText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private factBox?: Phaser.GameObjects.Container;
  private drill?: { sample: Sample; bar: Phaser.GameObjects.Graphics; timer: Phaser.Time.TimerEvent };
  private drilling = false;
  private rockGroup!: Phaser.Physics.Arcade.StaticGroup;
  private mission = null as ReturnType<typeof missionById>;
  private startT = 0;
  private hintTimer = 0;
  private idleT = 0;
  private ended = false;
  private scoutArrow?: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  private minimapContainer?: Phaser.GameObjects.Container;
  private minimapDots?: Phaser.GameObjects.Graphics;
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super('explore'); }

  create(): void {
    ensureMusic(this, state.music);
    const { height } = this.scale;
    this.mission = missionById('moon');
    this.ended = false;
    this.inventory = []; this.collected = 0;
    this.cameras.main.setBackgroundColor(0x1a1a2e);
    this.startT = this.time.now;

    // --- terrain ---
    // solid ground under the tiles: any seam, gap or map edge then reads as
    // lunar soil instead of the camera's background colour
    this.add.rectangle(MAP_W * TILE / 2, MAP_H * TILE / 2, MAP_W * TILE, MAP_H * TILE, 0x3a3040).setDepth(-20);
    const rng = new Phaser.Math.RandomDataGenerator([`${Date.now() % 9973}`]);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const ice = rng.frac() < 0.12;
        const frame = ice ? 'terrain_ice_64' : 'terrain_crater_64';
        this.add.image(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 'terrain_v2', frame);
      }
    }
    // scatter rocks (obstacles) & decor
    this.rockGroup = this.physics.add.staticGroup();
    const rockFrames = ['terrain_crater_rock', 'terrain_crystal_rock', 'terrain_fossil_rock'];
    for (let i = 0; i < 45; i++) {
      const x = rng.between(100, MAP_W * TILE - 100);
      const y = rng.between(100, MAP_H * TILE - 100);
      // keep the spawn area & lander clear
      if (Math.hypot(x - 400, y - 400) < 240) continue;
      const f = rng.pick(rockFrames);
      const rock = this.rockGroup.create(x, y, 'terrain', f) as Phaser.Physics.Arcade.Sprite;
      rock.setScale(0.8).refreshBody();
    }
    const decor = ['terrain_crater_dirt', 'terrain_ice_cracked', 'terrain_alien_grass_eyes', 'terrain_crater_rock'];
    for (let i = 0; i < 80; i++) {
      const x = rng.between(0, MAP_W * TILE);
      const y = rng.between(0, MAP_H * TILE);
      this.add.image(x, y, 'terrain', rng.pick(decor)).setScale(0.6).setAlpha(0.8).setDepth(-1);
    }

    // --- lander (spawn point) ---
    const spawn = { x: 400, y: 400 };
    this.lander = this.add.image(spawn.x, spawn.y, 'machines', 'machines_rocket_launchpad').setScale(0.8);
    // Tap lander directly on smartphones to transmit once 3+ samples are collected
    this.lander.setInteractive();
    if (this.lander.input) this.lander.input.cursor = 'pointer';
    this.lander.on('pointerup', () => {
      if (this.drilling || this.ended) return;
      if (Math.hypot(this.player.x - this.lander.x, this.player.y - this.lander.y) < 110 && this.collected >= 3) {
        this.transmit();
      }
    });

    // --- player astronaut ---
    const g = state.astronaut;
    this.player = this.physics.add.sprite(spawn.x + 90, spawn.y + 40, `astro_${g}_walk`, `astro_${g}_walk_front_0`);
    this.player.setCollideWorldBounds(true);
    this.player.setSize(50, 60);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.physics.add.collider(this.player, this.rockGroup);

    // camera follows
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.setZoom(1.4);

    // --- samples ---
    for (let i = 0; i < 5; i++) {
      const id = SAMPLE_IDS[i];
      let x = 0, y = 0, tries = 0;
      do {
        x = rng.between(160, MAP_W * TILE - 160);
        y = rng.between(160, MAP_H * TILE - 160);
        tries++;
      } while (Math.hypot(x - spawn.x, y - spawn.y) < 400 && tries < 30);
      // ring is drawn at its own origin and positioned — so scaling it pulses
      // around the sample instead of drifting (see PLAN §2.9)
      const ring = this.add.graphics().setPosition(x, y);
      ring.lineStyle(3, 0x59f7ff, 1);
      ring.strokeCircle(0, 0, 30);
      ring.strokeCircle(0, 0, 22);
      const go = this.add.image(x, y, 'resources', SAMPLE_FRAMES[id]);
      const sample: Sample = { id, go, ring, x, y, collected: false };
      // Tap sample directly on touch screens when within reach
      go.setInteractive();
      if (go.input) go.input.cursor = 'pointer';
      go.on('pointerup', () => {
        if (this.drilling || this.ended || sample.collected) return;
        if (Math.hypot(sample.x - this.player.x, sample.y - this.player.y) < 84) {
          this.startDrill(sample);
        }
      });
      this.samples.push(sample);
    }

    // --- helpers (minions follow the player) ---
    const helperFrames = ['minions_mechanic', 'minions_miner_driller', 'minions_radio_scout', 'minions_chemist'];
    for (let i = 0; i < 4; i++) {
      const go = this.add.image(spawn.x + 140 + i * 30, spawn.y + 80 + i * 25, 'minions', helperFrames[i]).setScale(0.55);
      this.helpers.push({
        go,
        offset: { x: -50 - i * 30, y: 20 + i * 30 },
        kind: helperFrames[i],
      });
    }

    // --- HUD ---
    this.goalText = this.add.text(12, 12, '', { ...TXT.small, fontSize: '15px', backgroundColor: '#1d1d3acc', padding: { x: 10, y: 6 } }).setScrollFactor(0).setDepth(50);
    this.invText = this.add.text(12, 56, '', { ...TXT.small, fontSize: '15px' }).setScrollFactor(0).setDepth(50);
    this.promptText = this.add.text(this.scale.width / 2, height - 90, '', { ...TXT.h2, fontSize: '20px', backgroundColor: '#1d1d3acc', padding: { x: 12, y: 6 } }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(50);
    this.refreshHUD();

    // --- radar minimap (top-right, framed by ui_minimap_frame) ---
    this.buildMinimap();

    // --- on-screen touch controls (bottom-left thumbstick + bottom-right action) ---
    this.touch = new TouchControls(this);

    // The world camera is zoomed 1.4, which scales and shifts any
    // scroll-factor-0 text off screen. The overlay gets its own camera.
    this.hudCam = this.cameras.add(0, 0, this.scale.width, height);
    this.hudCam.setName('hud');
    this.hudCam.transparent = true;
    this.hudObjects = [this.goalText, this.invText, this.promptText, ...this.touch.objects];
    if (this.minimapContainer) this.hudObjects.push(this.minimapContainer);
    const hudSet = new Set<Phaser.GameObjects.GameObject>(this.hudObjects);
    this.hudCam.ignore(this.children.list.filter((o) => !hudSet.has(o)));
    this.cameras.main.ignore(this.hudObjects);

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyWASD = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keyE = this.input.keyboard!.addKey('E');
  }

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

    // uncollected samples (cyan blips)
    for (const s of this.samples) {
      if (s.collected) continue;
      const p = toRadar(s.x, s.y);
      g.fillStyle(0x59f7ff, 1);
      g.fillCircle(p.rx, p.ry, 3.5);
    }

    // player (gold dot)
    const pl = toRadar(this.player.x, this.player.y);
    g.fillStyle(0xffd23f, 1);
    g.fillCircle(pl.rx, pl.ry, 4.5);
  }

  private refreshHUD(): void {
    this.goalText.setText(t('explore.goal', { n: Math.min(this.collected, 3) }));
    this.invText.setText(`${t('explore.inventory')}: ${this.inventory.length ? this.inventory.map((s) => t(`sample.${s}`)).join(', ') : '—'}`);
  }

  override update(_t: number, delta: number): void {
    if (this.ended) return;
    const speed = 160;
    let vx = (this.cursors.left.isDown || this.keyWASD.A.isDown ? -speed : 0) + (this.cursors.right.isDown || this.keyWASD.D.isDown ? speed : 0);
    let vy = (this.cursors.up.isDown || this.keyWASD.W.isDown ? -speed : 0) + (this.cursors.down.isDown || this.keyWASD.S.isDown ? speed : 0);
    if (vx === 0 && vy === 0 && (this.touch.dx !== 0 || this.touch.dy !== 0)) {
      vx = this.touch.dx * speed;
      vy = this.touch.dy * speed;
    }
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

    // helpers follow with lag + wander
    for (const h of this.helpers) {
      const tx = this.player.x + h.offset.x;
      const ty = this.player.y + h.offset.y;
      h.go.x = Phaser.Math.Linear(h.go.x, tx, 0.05);
      h.go.y = Phaser.Math.Linear(h.go.y, ty, 0.05);
      h.go.setFlipX(this.player.x < h.go.x);
    }

    // radio scout points to nearest uncollected sample
    const scout = this.helpers.find((h) => h.kind === 'minions_radio_scout');
    const nearest = this.nearestSample(this.player.x, this.player.y);
    if (scout && nearest) {
      const a = Math.atan2(nearest.y - scout.go.y, nearest.x - scout.go.x);
      // the sprite stays upright (it is a front-facing character); it leans a
      // little and turns to face the sample, while an arrow shows the bearing
      scout.go.setFlipX(nearest.x < scout.go.x);
      scout.go.setRotation(Math.sin(a) * 0.12);
      if (!this.scoutArrow) {
        if (hasV2(this, UI_V2_ART.arrow)) {
          const img = this.add.image(0, 0, V2, UI_V2_ART.arrow)
            .setDisplaySize(32, 32).setDepth(58);
          this.hudCam.ignore(img);
          this.scoutArrow = img;
        } else {
          const g = this.add.graphics().setDepth(58);
          g.fillStyle(0x59f7ff, 1).lineStyle(2, 0x1d1b2e);
          g.fillTriangle(0, -13, -9, 7, 9, 7);
          g.strokeTriangle(0, -13, -9, 7, 9, 7);
          this.hudCam.ignore(g);     // world-anchored
          this.scoutArrow = g;
        }
      }
      this.scoutArrow.setVisible(true);
      this.scoutArrow.setPosition(scout.go.x, scout.go.y - 56);
      this.scoutArrow.setRotation(this.scoutArrow instanceof Phaser.GameObjects.Image ? a : a + Math.PI / 2);
    } else if (this.scoutArrow) {
      this.scoutArrow.setVisible(false);
    }

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
    // interact
    this.updateInteract();
  }

  private nearestSample(x: number, y: number): Sample | null {
    let best: Sample | null = null;
    let bd = Infinity;
    for (const s of this.samples) {
      if (s.collected) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private showHint(): void {
    const h = this.helpers[Math.floor(Math.random() * this.helpers.length)];
    const hints = this.mission?.hintKeys ?? ['hint.explore.1'];
    const key = hints[Math.floor(Math.random() * hints.length)];
    this.bubble(h, t(key));
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

    if (this.drilling) {
      this.promptText.setText(t('explore.drilling'));
      this.touch.setActionState(false, '…');
      return;
    }

    if (nearSample) {
      this.promptText.setText(t('explore.prompt_drill'));
      this.touch.setActionState(true, 'E');
      if (pressed) this.startDrill(s);
    } else if (nearLander) {
      if (this.collected >= 3) {
        this.promptText.setText(t('explore.prompt_transmit'));
        this.touch.setActionState(true, 'E');
        if (pressed) this.transmit();
      } else {
        this.promptText.setText(t('explore.need_more', { n: 3 - this.collected }));
        this.touch.setActionState(false, 'E');
      }
    } else {
      this.promptText.setText('');
      this.touch.setActionState(false, 'E');
    }
  }

  private startDrill(s: Sample): void {
    this.drilling = true;
    this.player.setVelocity(0, 0);
    const bar = this.add.graphics().setDepth(70);
    const icon = this.add.image(s.x, s.y - 60, 'tools_v2', 'tools_v2_power_drill').setScale(0.8).setDepth(70);
    this.hudCam.ignore([bar, icon]);   // world-anchored
    const w = 80;
    this.drill = { sample: s, bar, timer: this.time.addEvent({ delay: 1500, callback: () => this.finishDrill(s) }) };
    this.tweens.addCounter({
      from: 0, to: 1, duration: 1500,
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
    s.collected = true;
    s.go.setVisible(false);
    s.ring.setVisible(false);
    this.sparkleBurst(s.x, s.y);
    this.inventory.push(s.id);
    this.collected++;
    this.refreshHUD();
    this.fact(s.id);
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

  private fact(sampleId: string): void {
    this.factBox?.destroy();
    const { width, height } = this.scale;
    const c = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(100);
    c.add(makePanel(this, -260, -110, 520, 220, 0.98));
    c.add(this.add.image(-190, -40, 'resources', SAMPLE_FRAMES[sampleId]).setScale(1.2));
    if (hasV2(this, UI_V2_ART.portraitChemist)) {
      c.add(this.add.image(-190, 38, V2, UI_V2_ART.portraitChemist).setDisplaySize(54, 54));
    }
    c.add(this.add.text(10, -80, t(`sample.${sampleId}`), { ...TXT.h2, fontSize: '22px' }).setOrigin(0, 0.5));
    c.add(this.add.text(10, -30, t(`fact.${sampleId}`), { ...TXT.body, fontSize: '16px', wordWrap: { width: 300 } }).setOrigin(0, 0.5));
    c.add(this.add.text(0, 78, t('explore.collected'), { ...TXT.h2, color: '#7ac74f' }).setOrigin(0.5));
    c.add(this.add.text(0, 96, 'E', { ...TXT.small, color: '#ffd23f' }).setOrigin(0.5));
    this.factBox = c;
    this.cameras.main.ignore(c);     // screen-anchored → HUD camera only
    const close = () => { this.factBox?.destroy(); this.factBox = undefined; this.input.keyboard?.off('keydown-E', close); this.input.off('pointerdown', close); };
    this.input.keyboard?.once('keydown-E', close);
    this.input.once('pointerdown', close);
    this.time.delayedCall(4000, close);
  }

  private transmit(): void {
    if (this.ended) return;
    this.ended = true;
    this.promptText.setText(t('explore.transmitting'));
    const underTime = (this.time.now - this.startT) / 1000 < 120;
    const allSamples = this.inventory.length >= 5;
    const result = {
      success: true,
      maxAltitude: 0,
      fuelPercent: 0,
      time: (this.time.now - this.startT) / 1000,
      blocks: 0,
      samples: this.inventory.length,
    };
    const stars = this.mission!.stars(result, { underTime, allSamples });
    state.recordResult('moon', stars, result.time);
    this.time.delayedCall(1400, () => {
      this.scene.start('result', { result, stars });
    });
  }
}
