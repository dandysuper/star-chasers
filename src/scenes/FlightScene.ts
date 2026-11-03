import Phaser from 'phaser';
import { state } from '../core/state';
import { t, fmtDist, fmtSpeed, fmtTime } from '../core/i18n';
import { EARTH, MOON } from '../data/bodies';
import { missionById } from '../data/missions';
import { FlightSim, defaultControl, DT, type RocketControl, type SimEvent, type Telemetry } from '../physics/sim';
import { computeStats } from '../physics/rocket';
import { assemblyFromDesign } from '../data/assembly';
import { compileBlocklyJSON } from '../rocketscript/compile';
import { Interpreter, type InterpEvent } from '../rocketscript/interp';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { isTouchMode, onInputModeChange } from '../core/device';
import { addPart, partMetrics, UI, V2, FLAME_ART, FX_ART, UI_V2_ART, BG, hasFrame, hasV2, bellDrop, makeSpeechBubble } from '../ui/theme';

const M2PX_MIN = 1;        // px per metre near the ground
const M2PX_MAX = 0.0016;   // px per metre in space
const ZOOM_FLOOR = 0.02;   // the rocket never shrinks past this

export class FlightScene extends Phaser.Scene {
  private sim!: FlightSim;
  private control!: RocketControl;
  private interp?: Interpreter;
  private mission = null as ReturnType<typeof missionById>;

  private rocket!: Phaser.GameObjects.Container;
  private rocketH = 0;
  /** How far the engine bell reaches below the hull, in px (0 when no bell). */
  private nozzleDrop = 0;
  private flame?: Phaser.GameObjects.Image;
  /** True when the plume art is black-background and drawn additively. */
  private flameAdditive = false;
  private chute?: Phaser.GameObjects.Image;
  private smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
  private skyGfx!: Phaser.GameObjects.Graphics;
  private earthGfx!: Phaser.GameObjects.Graphics;
  private trajGfx!: Phaser.GameObjects.Graphics;
  private backdrop?: Phaser.GameObjects.Image;
  private bgRoot!: Phaser.GameObjects.Container;

  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private worldObjects: Phaser.GameObjects.GameObject[] = [];
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  private hudText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private watchText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private fuelBar!: Phaser.GameObjects.Graphics;
  private pauseIcon!: Phaser.GameObjects.Image | Phaser.GameObjects.Container;
  private hintText?: Phaser.GameObjects.Text;

  private warp = 1;
  private paused = false;
  private wasPausedBeforeMenu = false;
  private inGameMenu!: InGameMenu;
  private simAcc = 0;
  private logLines: string[] = [];
  private engineOffByProgram = false;
  private ended = false;
  private sayQueue: { text: string; until: number }[] = [];
  private sayBubble?: Phaser.GameObjects.Container;
  private saySetter?: (s: string) => void;
  private previewPts: { x: number; y: number }[] = [];
  private previewTimer = 0;
  private chuteOpen = false;

  constructor() { super('flight'); }

  create(): void {
    this.resetState();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x05050f);
    this.mission = missionById(state.missionId);
    ensureMusic(this, state.music, true);   // ducked under flight

    this.sim = new FlightSim(state.design.parts);
    const stats = computeStats(state.design.parts);
    this.control = defaultControl();
    const programJson = state.program ?? (this.mission?.starterProgram);
    const compiled = compileBlocklyJSON(programJson ?? {});
    // a run started by the dev shortcut never visited the Code scene, so take
    // the count from what we just compiled
    state.blockCount = compiled.blockCount;
    this.interp = new Interpreter(compiled, {
      hasAltSensor: stats.hasAltSensor,
      hasSpeedSensor: stats.hasSpeedSensor,
      hasParachute: stats.hasParachute,
      hasControl: stats.hasControl,
      debug: state.dev,
    });

    this.spawnProgramButtons();

    // ---- HUD camera: fixed, never zooms, transparent so the world shows ----
    this.uiCam = this.cameras.add(0, 0, width, height);
    this.uiCam.setName('ui');
    this.uiCam.transparent = true;

    // ---- painted backdrop + sky — on the MAIN camera, in a container that is
    //      counter-scaled every frame so the zoom never touches it. A separate
    //      camera would draw the backdrop over the world.
    this.bgRoot = this.add.container(0, 0).setDepth(-100);
    if (this.textures.exists(BG.flightEarth)) {
      this.backdrop = this.add.image(0, 0, BG.flightEarth).setDisplaySize(width, height);
      this.bgRoot.add(this.backdrop);
    }
    this.skyGfx = this.add.graphics();
    this.bgRoot.add(this.skyGfx);   // added after the backdrop → draws on top

    // ---- world layers (zoomed by the main camera) ----
    this.trajGfx = this.add.graphics().setDepth(-8);
    this.earthGfx = this.add.graphics().setDepth(-9);
    this.rocket = this.add.container(0, 0).setDepth(5);
    this.buildRocketArt();
    this.worldObjects.push(this.trajGfx, this.earthGfx, this.rocket);

    // Exhaust smoke: the v2 cloud art when it is there, the ui_v1 puff otherwise.
    // The v2 puffs are cut small (90 px), so they need a bigger scale ramp than
    // the old atlas frame to cover the same ground.
    const useV2Smoke = hasV2(this, FX_ART.cloudM);
    const smokeKey = useV2Smoke ? V2 : UI;
    const smokeFrame = useV2Smoke ? FX_ART.cloudM : 'fx_smoke';
    if (useV2Smoke || hasFrame(this, 'fx_smoke')) {
      this.smoke = this.add.particles(0, 0, smokeKey, {
        frame: smokeFrame,
        lifespan: 800,
        speed: { min: 8, max: 32 },
        // kept light: the additive plume is the bright element, and a dense
        // white puff in front of it swallowed the flame entirely
        scale: useV2Smoke ? { start: 0.5, end: 1.1 } : { start: 0.16, end: 0.42 },
        alpha: { start: useV2Smoke ? 0.45 : 0.34, end: 0 },
        quantity: 1,
        emitting: false,
      }).setDepth(4);
      this.worldObjects.push(this.smoke);
    }

    this.buildHUD(width, height);

    // the keyboard hint is dead weight on a phone, where the same actions are
    // four on-screen buttons
    const offInputMode = onInputModeChange(() => this.refreshHintText());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offInputMode);

    // the main camera renders the world + backdrop; the HUD camera only the HUD
    this.uiCam.ignore(this.worldObjects);
    this.uiCam.ignore(this.bgRoot);
    this.cameras.main.ignore(this.uiObjects);

    // ---- controls ----
    this.input.keyboard?.on('keydown-SPACE', () => { if (!this.inGameMenu?.isOpen) this.togglePause(); });
    this.input.keyboard?.on('keydown-OPEN_BRACKET', () => { if (!this.inGameMenu?.isOpen) this.setWarp(-1); });
    this.input.keyboard?.on('keydown-CLOSE_BRACKET', () => { if (!this.inGameMenu?.isOpen) this.setWarp(1); });
    this.input.keyboard?.on('keydown-R', () => { if (!this.inGameMenu?.isOpen) this.restart(); });
    this.inGameMenu = new InGameMenu(this, {
      musicDucked: true,
      extraAction: { labelKey: 'result.edit', variant: 'blue', onClick: () => this.leave('code') },
      onHub: () => this.leave('hub'),
      onQuit: () => this.leave('menu'),
      onOpen: () => {
        this.wasPausedBeforeMenu = this.paused;
        this.paused = true;
        this.setOverlayVisible(false);
      },
      onClose: () => {
        this.paused = this.wasPausedBeforeMenu;
        this.setOverlayVisible(true);
      },
    });

    this.cameras.main.startFollow(this.rocket, true, 0.12, 0.12);
    this.cameras.main.setZoom(M2PX_MIN);
  }

  private resetState(): void {
    this.ended = false;
    this.warp = 1;
    this.paused = false;
    this.simAcc = 0;
    this.logLines = [];
    this.sayQueue = [];
    this.sayBubble = undefined;
    this.saySetter = undefined;
    this.engineOffByProgram = false;
    this.previewTimer = 0;
    this.previewPts = [];
    this.worldObjects = [];
    this.uiObjects = [];
    this.chuteOpen = false;
  }

  // ---------------- HUD ----------------

  private buildHUD(width: number, height: number): void {
    const panel = makePanel(this, 8, 8, 300, 236, 0.82);
    this.uiObjects.push(panel);

    this.hudText = this.add.text(20, 18, '', { ...TXT.small, fontSize: '14px', lineSpacing: 4 })
      .setDepth(50);
    this.watchText = this.add.text(width - 320, 12, '', {
      ...TXT.small, fontSize: '14px', lineSpacing: 4, align: 'right',
      backgroundColor: '#0b0b2acc', padding: { x: 8, y: 6 },
    }).setDepth(50);
    this.logText = this.add.text(12, height - 150, '', {
      ...TXT.small, fontSize: '14px', lineSpacing: 4,
      backgroundColor: '#0b0b2acc', padding: { x: 8, y: 6 },
    }).setDepth(50);
    this.statusText = this.add.text(width / 2, 54, '', {
      ...TXT.h2, color: '#ffd23f', stroke: '#1d1b2e', strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(50);
    this.fuelBar = this.add.graphics().setDepth(50);
    this.uiObjects.push(this.hudText, this.watchText, this.logText, this.statusText, this.fuelBar);
    if (hasV2(this, UI_V2_ART.iconFuel)) {
      const fuelIcon = this.add.image(28, 204, V2, UI_V2_ART.iconFuel)
        .setDisplaySize(22, 26).setDepth(51);
      this.uiObjects.push(fuelIcon);
    }

    // icon controls, bottom-right
    this.pauseIcon = makeIconButton(this, width - 250, height - 40, 'ico_pause', () => this.togglePause(), 46);
    const warpIcon = makeIconButton(this, width - 190, height - 40, 'ico_x2', () => this.setWarp(1), 46);
    const restartIcon = makeIconButton(this, width - 130, height - 40, 'ico_reset', () => this.restart(), 46);
    const backIcon = makeIconButton(this, width - 70, height - 40, 'ico_back', () => this.leave('code'), 46);
    this.uiObjects.push(this.pauseIcon, warpIcon, restartIcon, backIcon);

    const giveUp = makeButton(this, width / 2 + 250, height - 40, t('flight.give_up'), {
      w: 150, h: 44, variant: 'red', onClick: () => this.finish('fail.give_up'),
    });
    this.uiObjects.push(giveUp);

    this.hintText = this.add.text(14, height - 26, '', {
      ...TXT.small, fontSize: '12px', color: '#9a9ad0',
      backgroundColor: '#0b0b2acc', padding: { x: 8, y: 4 },
    }).setOrigin(0, 0.5).setDepth(50);
    this.uiObjects.push(this.hintText);
    this.refreshHintText();
  }

  /** Name the controls the player actually has in front of them. */
  private refreshHintText(): void {
    this.hintText?.setText(t(isTouchMode() ? 'flight.hint_keys_touch' : 'flight.hint_keys'));
  }

  private togglePause(): void {
    this.paused = !this.paused;
    const tex = this.paused ? 'ico_play' : 'ico_pause';
    if (this.pauseIcon instanceof Phaser.GameObjects.Image && hasFrame(this, tex)) {
      this.pauseIcon.setTexture(UI, tex);
    }
  }

  private setWarp(dir: 1 | -1): void {
    const steps = [1, 2, 5, 10];
    let i = steps.indexOf(this.warp) + dir;
    if (dir === 1 && i >= steps.length) i = 0; // wrap around on tap so mobile players can return to 1×
    i = Phaser.Math.Clamp(i, 0, steps.length - 1);
    const want = steps[i];
    // warp > 2 is disabled in the atmosphere with the engine burning
    const tel = this.sim.telemetry(this.control);
    const inAtmo = tel.bodyName === 'earth' && tel.altitude < EARTH.atmHeight;
    if (want > 2 && inAtmo && this.control.engineOn && this.sim.stage && this.sim.stage.fuel > 0) {
      this.warp = 1;
      return;
    }
    this.warp = want;
  }

  // ---------------- program buttons (DOM) ----------------

  private spawnProgramButtons(): void {
    const container = document.getElementById('ui-overlay');
    if (!container || !this.interp) return;
    container.innerHTML = '';
    const game = this.game as Phaser.Game & { __programButtons?: HTMLButtonElement[] };
    game.__programButtons = [];
    for (const btn of this.interp.buttons) {
      const el = document.createElement('button');
      el.className = 'rs-button';
      el.textContent = btn.name;
      el.style.position = 'absolute';
      el.style.right = '24px';
      el.style.top = `${90 + this.interp.buttons.indexOf(btn) * 60}px`;
      el.onclick = () => this.interp?.pressButton(btn.name);
      container.appendChild(el);
      game.__programButtons.push(el);
    }
  }

  // ---------------- rocket art ----------------

  private buildRocketArt(): void {
    const asm = assemblyFromDesign(state.design);
    const metrics = asm.spine.map((n) => partMetrics(this, n.id));
    const total = metrics.reduce((s, m) => s + m.h, 0);
    let y = -total / 2;

    const hostRects = new Map<number, { x: number; y: number; w: number; h: number }>();
    asm.spine.forEach((node, i) => {
      const m = metrics[i];
      const rect = { x: 0, y: y + m.h / 2, w: m.w, h: m.h };
      hostRects.set(node.uid, rect);
      this.rocket.add(addPart(this, node.id, rect.x, rect.y));
      y += m.h;
    });

    // Strap-on boosters keep their own column beside the core, so a rocket that
    // was built three abreast flies three abreast instead of being pulled into
    // one straight line.
    for (const col of asm.sides) {
      const host = hostRects.get(col.hostUid);
      if (!host) continue;
      const colMetrics = col.nodes.map((n) => partMetrics(this, n.id));
      const colW = colMetrics.reduce((mx, m) => Math.max(mx, m.w), host.w);
      const x = (col.side === 'left' ? -1 : 1) * (host.w / 2 + colW / 2 - 8);
      let cy = host.y - host.h / 2;
      col.nodes.forEach((node, i) => {
        const m = colMetrics[i];
        this.rocket.add(addPart(this, node.id, x, cy + m.h / 2));
        cy += m.h;
      });
    }
    this.rocketH = total;

    // An engine bell hangs below the hull, so the plume has to start at the
    // bell's mouth — anchored to the hull it would burn inside the nozzle.
    const lastPart = asm.spine[asm.spine.length - 1];
    this.nozzleDrop = lastPart && metrics.length
      ? bellDrop(this, lastPart.id, metrics[metrics.length - 1].w)
      : 0;
    const nozzleY = total / 2 - 2 + this.nozzleDrop;

    // exhaust: the v2 plumes are painted on black, so they are drawn additively
    // and the black drops out against the sky instead of fringing the sprite.
    if (this.textures.exists(V2) && this.textures.get(V2).has(FLAME_ART.large)) {
      this.flame = this.add.image(0, nozzleY, V2, FLAME_ART.large)
        .setOrigin(0.5, 0).setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.flameAdditive = true;
      this.rocket.add(this.flame);
    } else if (hasFrame(this, 'fx_flame_m')) {
      this.flame = this.add.image(0, nozzleY, UI, 'fx_flame_m')
        .setOrigin(0.5, 0).setVisible(false);
      this.rocket.add(this.flame);
    }
    if (hasFrame(this, 'fx_chute')) {
      this.chute = this.add.image(0, -total / 2 + 4, UI, 'fx_chute')
        .setOrigin(0.5, 1).setVisible(false);
      this.rocket.add(this.chute);
    }
  }

  // ---------------- frame ----------------

  override update(_time: number, delta: number): void {
    if (this.ended) return;
    const frameSec = Math.min(delta / 1000, 0.1);

    if (!this.paused && this.sim.phase !== 'crashed' && this.sim.phase !== 'landed') {
      this.simAcc += frameSec * this.warp;
      let steps = 0;
      while (this.simAcc >= DT && steps < 10 * this.warp) {
        this.simAcc -= DT;
        steps++;
        const events: SimEvent[] = [];
        const uiEvents: InterpEvent[] = [];
        this.interp?.tick(this.control, this.sim.telemetry(this.control), uiEvents);
        for (const e of uiEvents) this.onInterpEvent(e);
        this.sim.step(this.control, events);
        for (const e of events) this.onSimEvent(e);
      }
    }

    const tel = this.sim.telemetry(this.control);
    const zoom = this.zoomFor(tel.altitude);
    this.cameras.main.setZoom(zoom);

    // the backdrop rides the camera centre at 1/zoom so it always fills the
    // frame exactly once, no matter how far the camera pulls out
    const camMid = this.cameras.main.midPoint;
    this.bgRoot.setPosition(camMid.x, camMid.y).setScale(1 / zoom);

    // ---- rocket transform ----
    const px = this.sim.x;
    const py = -(this.sim.y - EARTH.R);
    this.rocket.setPosition(px, py);
    const localUp = Math.atan2(this.sim.y, this.sim.x);
    this.rocket.setRotation(localUp - Math.PI / 2 + this.sim.angle);
    // keep the rocket readable when the camera pulls far out
    const visScale = zoom < 0.15 ? Phaser.Math.Clamp(0.15 / zoom, 1, 24) : 1;
    this.rocket.setScale(visScale);

    this.drawFlame(tel);
    this.drawChute();
    this.emitSmoke(tel);

    this.drawBackdrop(tel);
    this.drawEarth(tel, zoom);
    this.previewTimer += frameSec;
    if (this.previewTimer > 0.5) {
      this.previewTimer = 0;
      this.previewPts = this.sim.launched && tel.altitude > 200 ? this.sim.previewTrajectory(300) : [];
    }
    this.drawTrajectory(zoom);

    this.updateHUD(tel);
    this.updateSay();

    if (this.mission) {
      const res = this.mission.check(this.sim, { engineOffByProgram: this.engineOffByProgram });
      if (res === 'success') this.finish('success');
      else if (res !== 'running') this.finish(res.fail, res.vars);
    } else if (this.sim.phase === 'crashed') {
      this.statusText.setText(t('flight.crashed'));
    }
  }

  private zoomFor(alt: number): number {
    if (alt < 200) return M2PX_MIN;
    const k = Math.min(1, (alt - 200) / 60000);
    return Math.max(ZOOM_FLOOR, Phaser.Math.Linear(M2PX_MIN, M2PX_MAX, k));
  }

  // ---------------- effects ----------------

  private drawFlame(tel: Telemetry): void {
    if (!this.flame) return;
    const st = this.sim.stage;
    const on = tel.engineOn && tel.throttle > 0 && !!st && st.fuel > 0
      && this.sim.phase !== 'crashed' && this.sim.phase !== 'landed';
    this.flame.setVisible(on);
    if (!on) return;
    const flicker = 0.88 + Math.random() * 0.24;
    // the plume stays a fraction of the hull, otherwise it dwarfs the rocket
    const h = (this.rocketH * 0.26 + this.rocketH * 0.34 * tel.throttle) * flicker;
    if (this.flameAdditive) {
      // additive art keeps its own aspect (219×420) and must not be tinted or
      // dimmed — ADD multiplies by alpha, so any fade kills the bright core
      this.flame.setDisplaySize(h * 0.52, h);
      this.flame.setAlpha(1);
      return;
    }
    this.flame.setDisplaySize(26 + 14 * tel.throttle, h);
    this.flame.setAlpha(0.9);
    this.flame.setTint(this.sim.launched ? 0xffffff : 0xffe9b0);
  }

  private drawChute(): void {
    if (!this.chute) return;
    const open = this.sim.parachuteDeployed;
    this.chute.setVisible(open);
    if (open) {
      const wobble = 1 + Math.sin(this.sim.t * 3) * 0.05;
      const w = this.rocketH * 1.9 * wobble;
      this.chute.setDisplaySize(w, w * 0.7);
    }
  }

  private emitSmoke(tel: Telemetry): void {
    if (!this.smoke) return;
    const inAtmo = tel.bodyName === 'earth' && tel.altitude < EARTH.atmHeight * 0.6;
    const burning = tel.engineOn && tel.throttle > 0;
    if (!inAtmo || !burning) return;
    const baseX = this.rocket.x;
    const baseY = this.rocket.y + this.rocketH * 0.55 + this.nozzleDrop;
    this.smoke.emitParticleAt(baseX + Phaser.Math.Between(-10, 10), baseY + Phaser.Math.Between(0, 16));
  }

  /** One-shot effect sprite: pops in small, expands and fades, then destroys. */
  private fxPop(x: number, y: number, frame: string, size: number, grow: number, ms: number): void {
    if (!hasV2(this, frame)) return;
    const from = 0.55;
    const img = this.add.image(x, y, V2, frame)
      .setDisplaySize(size * from, size * from)
      .setDepth(20);
    this.uiCam.ignore(img);
    this.tweens.add({
      targets: img,
      displayWidth: size * grow,
      displayHeight: size * grow,
      alpha: 0,
      duration: ms,
      ease: 'Quad.out',
      onComplete: () => img.destroy(),
    });
  }

  private explode(worldX: number, worldY: number): void {
    const size = Math.max(80, this.rocketH * 2.6);

    if (hasV2(this, FX_ART.blastBurst)) {
      // three layers: the white-hot flash, the fireball, and the ground-hugging
      // trail, plus a few slow clouds that outlive the fire
      this.fxPop(worldX, worldY, FX_ART.blastBurst, size * 1.2, 2.1, 620);
      this.fxPop(worldX, worldY, FX_ART.blastHit, size * 1.5, 1.8, 900);
      this.fxPop(worldX, worldY + this.rocketH * 0.35, FX_ART.blastGround, size, 1.6, 1200);
      for (let i = 0; i < 3; i++) {
        this.fxPop(
          worldX + Phaser.Math.Between(-size * 0.5, size * 0.5),
          worldY + Phaser.Math.Between(-size * 0.3, size * 0.4),
          FX_ART.cloudXl, size * 0.9, 1.9, 1400,
        );
      }
    } else {
      const frame = hasFrame(this, 'fx_blast') ? 'fx_blast' : 'fx_explosion';
      if (hasFrame(this, frame)) {
        const img = this.add.image(worldX, worldY, UI, frame).setDepth(20);
        this.uiCam.ignore(img);
        img.setDisplaySize(size * 1.7, size * 1.7).setScale(img.scaleX * 0.35, img.scaleY * 0.35);
        this.tweens.add({
          targets: img,
          scaleX: img.scaleX * 2.4,
          scaleY: img.scaleY * 2.4,
          alpha: 0,
          duration: 850,
          ease: 'Quad.out',
          onComplete: () => img.destroy(),
        });
      }
    }
    if (this.smoke) {
      for (let i = 0; i < 16; i++) {
        this.smoke.emitParticleAt(worldX + Phaser.Math.Between(-40, 40), worldY + Phaser.Math.Between(-40, 40));
      }
    }
    this.cameras.main.shake(420, 0.008);
    this.rocket.setVisible(false);
  }

  // ---------------- scenery ----------------

  private drawBackdrop(tel: Telemetry): void {
    const { width, height } = this.scale;
    // painted layers, cross-faded by altitude / body
    const want = tel.bodyName === 'moon'
      ? BG.flightMoon
      : tel.altitude > 45000 ? BG.flightSpace : BG.flightEarth;
    this.crossfade(want);

    // atmosphere tint over the painting — bgRoot's origin is the screen centre
    const g = this.skyGfx;
    g.clear();
    const left = -width / 2;
    const top = -height / 2;
    const frac = Phaser.Math.Clamp(tel.altitude / 70000, 0, 1);
    if (frac > 0.02) {
      g.fillStyle(0x05050f, Phaser.Math.Linear(0.0, 0.62, frac));
      g.fillRect(left, top, width, height);
    }
    if (frac > 0.15) {
      const rng = new Phaser.Math.RandomDataGenerator([`${Math.floor(this.sim.t / 0.7)}`]);
      g.fillStyle(0xffffff, Math.min(0.9, frac));
      for (let i = 0; i < 90; i++) g.fillRect(left + rng.frac() * width, top + rng.frac() * height, 2, 2);
    }
  }

  private crossfade(key: string): void {
    if (!this.backdrop) return;
    if (this.backdrop.texture.key === key) return;
    if (!this.textures.exists(key)) return;
    if (this.fading) return;
    this.fading = true;
    const { width, height } = this.scale;
    // new layer sits inside bgRoot so it inherits the counter-scale
    const next = this.add.image(0, 0, key).setDisplaySize(width, height).setAlpha(0);
    this.bgRoot.add(next);
    this.bgRoot.bringToTop(this.skyGfx);
    this.tweens.add({
      targets: next,
      alpha: 1,
      duration: 500,
      onComplete: () => {
        this.backdrop!.setTexture(key);
        next.destroy();
        this.fading = false;
      },
    });
  }

  private fading = false;

  private drawEarth(tel: Telemetry, zoom: number): void {
    const g = this.earthGfx;
    g.clear();
    // Only draw the live planet once the camera is far enough out that the
    // painted backdrop no longer reads as the ground.
    if (zoom > 0.2) return;

    g.fillStyle(0x4a90e2, 1);
    g.fillCircle(0, EARTH.R, EARTH.R);
    g.fillStyle(0x7ac74f, 0.85);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 1;
      g.fillEllipse(Math.cos(a) * EARTH.R * 0.55, EARTH.R + Math.sin(a) * EARTH.R * 0.55,
        EARTH.R * 0.5, EARTH.R * 0.3);
    }
    g.lineStyle(Math.max(2, 70000 * zoom * 0.4), 0x6ec6ff, 0.3);
    g.strokeCircle(0, EARTH.R, EARTH.R + 35000);

    if (tel.bodyName === 'moon' || tel.altitude > 40000) {
      const my = -(MOON.y - EARTH.R);
      g.fillStyle(0xbfc3c7, 1);
      g.fillCircle(MOON.x, my, MOON.R);
      g.fillStyle(0x8f939a, 1);
      for (let i = 0; i < 6; i++) {
        g.fillCircle(MOON.x + (i - 3) * MOON.R * 0.3, my + ((i % 3) - 1) * MOON.R * 0.3, MOON.R * 0.09);
      }
    }
  }

  private drawTrajectory(zoom: number): void {
    const g = this.trajGfx;
    g.clear();
    if (this.previewPts.length < 2) return;
    g.lineStyle(Math.max(2, 1.5 / zoom), 0xffd23f, 0.8);
    g.beginPath();
    for (let i = 0; i < this.previewPts.length; i++) {
      const p = this.previewPts[i];
      const sy = -(p.y - EARTH.R);
      if (i === 0) g.moveTo(p.x, sy); else g.lineTo(p.x, sy);
    }
    g.strokePath();
  }

  // ---------------- HUD ----------------

  private updateHUD(tel: Telemetry): void {
    const lines = [
      `${t('flight.hud.alt')}: ${fmtDist(tel.altitude)}`,
      `${t('flight.hud.speed')}: ${fmtSpeed(tel.speed)}`,
      `${t('flight.hud.vspeed')}: ${fmtSpeed(tel.vspeed)}`,
      `${t('flight.hud.throttle')}: ${Math.round(tel.throttle * 100)}%`,
      `${t('flight.hud.stage')}: ${tel.stage}`,
      `${t('flight.hud.apo')}: ${tel.apoapsis === Infinity ? t('flight.escape') : fmtDist(tel.apoapsis)}`,
      `${t('flight.hud.time')}: ${fmtTime(tel.time)}`,
    ];
    if (this.warp > 1) lines.push(t('flight.hud.warp', { n: this.warp }));
    if (this.paused) lines.push(`⏸ ${t('flight.hud.paused')}`);
    this.hudText.setText(lines.join('\n'));

    // fuel bar + fuel canister badge
    const g = this.fuelBar;
    g.clear();
    const barX = hasV2(this, UI_V2_ART.iconFuel) ? 44 : 20;
    const barW = hasV2(this, UI_V2_ART.iconFuel) ? 252 : 276;
    g.fillStyle(0x1d1b2e, 1).fillRoundedRect(barX, 196, barW, 16, 8);
    const frac = Phaser.Math.Clamp(tel.fuelPercent, 0, 1);
    if (frac > 0) {
      g.fillStyle(frac > 0.3 ? 0xffd23f : 0xff6b6b, 1)
        .fillRoundedRect(barX, 196, Math.max(16, barW * frac), 16, 8);
    }
    g.fillStyle(0xffffff, 0.85);

    // variable watch
    const vars = this.interp?.variables();
    if (vars && vars.size) {
      const wl = [t('flight.hud.watch') + ':'];
      vars.forEach((v, k) => wl.push(`${k} = ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`));
      this.watchText.setText(wl.join('\n'));
    } else {
      this.watchText.setText('');
    }

    this.logText.setText(this.logLines.slice(-5).join('\n'));
  }

  private updateSay(): void {
    if (this.sayQueue.length === 0) { this.sayBubble?.setVisible(false); return; }
    const top = this.sayQueue[this.sayQueue.length - 1];
    if (this.sim.t > top.until) { this.sayQueue.pop(); return; }

    if (!this.sayBubble) {
      const { width, height } = this.scale;
      const { container, setText } = makeSpeechBubble(this, 290, 96, '', {
        fontSize: 14,
        portrait: 'astronaut',
      });
      container.setPosition(width / 2 + 140, height / 2 - 130).setDepth(60);
      this.sayBubble = container;
      this.saySetter = setText;
      this.cameras.main.ignore(container);
    }
    this.sayBubble.setVisible(true);
    this.saySetter?.(String(top.text));
  }

  // ---------------- events ----------------

  private onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case 'liftoff': this.pushLog(t('flight.liftoff')); break;
      case 'stage': this.pushLog(t('flight.stage_sep')); break;
      case 'fuel_empty': this.pushLog(t('flight.fuel_empty')); break;
      case 'parachute': this.pushLog('⛱ ' + t('part.parachute.name')); break;
      case 'landed': this.pushLog(t('flight.landed')); break;
      case 'crashed':
        this.pushLog(t('flight.crashed'));
        this.explode(this.rocket.x, this.rocket.y);
        break;
    }
  }

  private onInterpEvent(e: InterpEvent): void {
    switch (e.type) {
      case 'say':
        this.pushLog(String(e.text));
        this.sayQueue.push({ text: String(e.text), until: this.sim.t + 3 });
        break;
      case 'warn':
        this.pushLog(`⚠ ${t(e.key!, e.vars)}`);
        break;
      case 'error':
        this.pushLog(`✖ ${t(e.key!, e.vars)}`);
        this.paused = true;
        this.statusText.setText(t(e.key!, e.vars));
        if (e.blockId) state.errorBlockId = e.blockId;
        break;
      case 'engine_off':
        this.engineOffByProgram = true;
        break;
      case 'button': break;
    }
  }

  private pushLog(s: string): void {
    this.logLines.push(s);
    if (this.logLines.length > 8) this.logLines.shift();
  }

  // ---------------- lifecycle ----------------

  private finish(reason: string, vars?: Record<string, string | number>): void {
    if (this.ended) return;
    this.ended = true;
    const tel = this.sim.telemetry(this.control);
    const success = reason === 'success';
    const mass = computeStats(state.design.parts).mass;
    const result = {
      success,
      failKey: success ? undefined : reason,
      failVars: vars,
      maxAltitude: tel.maxAltitude,
      fuelPercent: tel.fuelPercent,
      time: tel.time,
      blocks: state.blockCount,
    };
    const stars = this.mission
      ? this.mission.stars(result, { landedSoftly: this.sim.phase === 'landed', mass })
      : (success ? 1 : 0);
    if (this.mission && success) state.recordResult(this.mission.id, stars, tel.time);
    this.statusText.setText(success ? t('result.success') : t(reason, vars));
    this.time.delayedCall(success ? 900 : 1400, () => {
      this.leave('result', { result, stars });
    });
  }

  private restart(): void {
    this.cleanupOverlay();
    this.scene.restart();
  }

  private leave(scene: string, data?: object): void {
    this.cleanupOverlay();
    this.scene.start(scene, data);
  }

  private setOverlayVisible(visible: boolean): void {
    const container = document.getElementById('ui-overlay');
    if (container) container.style.display = visible ? 'block' : 'none';
  }

  private cleanupOverlay(): void {
    const container = document.getElementById('ui-overlay');
    if (container) {
      container.innerHTML = '';
      container.style.display = 'block';
    }
    const game = this.game as Phaser.Game & { __programButtons?: HTMLButtonElement[] };
    game.__programButtons = [];
  }
}
